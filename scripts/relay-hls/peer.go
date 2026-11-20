package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/webrtc/v4"
	"golang.org/x/time/rate"
)

const frameSize = 16 << 10

type request struct {
	ID uint32 `json:"id"`
	objectKey
}

type peer struct {
	id          string
	server      *relay
	pc          *webrtc.PeerConnection
	ctx         context.Context
	cancel      context.CancelFunc
	stopOnce    sync.Once
	claimed     atomic.Bool
	established atomic.Bool
	bytes       atomic.Uint64
	limiter     *rate.Limiter
	mu          sync.Mutex
	active      map[uint32]bool
}

func (p *peer) stop() {
	p.stopOnce.Do(func() {
		p.cancel()
		p.server.mu.Lock()
		if p.server.peers[p.id] == p {
			delete(p.server.peers, p.id)
		}
		p.server.mu.Unlock()
		// Pion callbacks can run on the same goroutine that Close needs to join.
		go p.pc.Close()
	})
}

func (p *peer) attach() {
	p.pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		switch state {
		case webrtc.PeerConnectionStateDisconnected, webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			p.stop()
		}
	})
	p.pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		if dc.Label() != "frankerz-hls" || !dc.Ordered() || dc.MaxRetransmits() != nil || dc.MaxPacketLifeTime() != nil || !p.claimed.CompareAndSwap(false, true) {
			p.stop()
			return
		}
		dc.OnOpen(func() { p.established.Store(true) })
		dc.OnClose(p.stop)
		dc.OnError(func(error) { p.stop() })
		dc.OnMessage(func(message webrtc.DataChannelMessage) { p.receive(dc, message) })
	})
	time.AfterFunc(20*time.Second, func() {
		if !p.established.Load() {
			p.stop()
		}
	})
}

func (p *peer) sendError(dc *webrtc.DataChannel, id uint32) {
	msg, _ := json.Marshal(struct {
		ID    uint32 `json:"id"`
		Error bool   `json:"error"`
	}{id, true})
	if dc.BufferedAmount() > 512<<10 || dc.SendText(string(msg)) != nil {
		p.stop()
	}
}

func (p *peer) receive(dc *webrtc.DataChannel, message webrtc.DataChannelMessage) {
	var r request
	if !message.IsString || len(message.Data) > 512 || !p.limiter.Allow() || json.Unmarshal(message.Data, &r) != nil || r.ID == 0 {
		p.stop()
		return
	}
	if !r.valid() {
		p.sendError(dc, r.ID)
		return
	}
	p.mu.Lock()
	if p.active[r.ID] {
		p.mu.Unlock()
		p.stop()
		return
	}
	if len(p.active) >= 4 {
		p.mu.Unlock()
		p.sendError(dc, r.ID)
		return
	}
	select {
	case p.server.transfers <- struct{}{}:
	default:
		p.mu.Unlock()
		p.sendError(dc, r.ID)
		return
	}
	p.active[r.ID] = true
	p.mu.Unlock()
	go func() {
		defer func() {
			<-p.server.transfers
			p.mu.Lock()
			delete(p.active, r.ID)
			p.mu.Unlock()
		}()
		ctx, cancel := context.WithTimeout(p.ctx, 12*time.Second)
		defer cancel()
		data, err := p.server.objects.get(ctx, r.objectKey)
		if err != nil {
			if p.ctx.Err() == nil {
				p.sendError(dc, r.ID)
			}
			return
		}
		if err := p.sendObject(ctx, dc, r.ID, data); err != nil {
			p.stop()
		}
	}()
}

func (p *peer) sendObject(ctx context.Context, dc *webrtc.DataChannel, id uint32, data []byte) error {
	header, _ := json.Marshal(struct {
		ID   uint32 `json:"id"`
		Size int    `json:"size"`
	}{id, len(data)})
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := dc.SendText(string(header)); err != nil {
		return err
	}
	frame := make([]byte, frameSize)
	binary.BigEndian.PutUint32(frame, id)
	for len(data) > 0 {
		// Other transfers on this channel can continue while SCTP drains.
		for dc.BufferedAmount() > 256<<10 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(8 * time.Millisecond):
			}
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		n := copy(frame[4:], data)
		if err := dc.Send(frame[:4+n]); err != nil {
			return err
		}
		p.bytes.Add(uint64(n))
		data = data[n:]
	}
	return nil
}
