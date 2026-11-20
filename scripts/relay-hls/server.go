package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
	"golang.org/x/time/rate"
)

var peerID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

type relay struct {
	api       *webrtc.API
	config    webrtc.Configuration
	objects   *objectStore
	token     string
	mu        sync.Mutex
	peers     map[string]*peer
	transfers chan struct{}
}

func newRelay(api *webrtc.API, config webrtc.Configuration, objects *objectStore, token string) *relay {
	return &relay{api: api, config: config, objects: objects, token: token, peers: make(map[string]*peer), transfers: make(chan struct{}, 64)}
}

type peerStatus struct {
	ID            string `json:"id"`
	Established   bool   `json:"established"`
	OutboundBytes uint64 `json:"outboundBytes"`
}

func (s *relay) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if s.token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.token)) != 1 {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if r.URL.Path == "/peers" && r.Method == http.MethodGet {
		s.mu.Lock()
		peers := make([]peerStatus, 0, len(s.peers))
		for id, p := range s.peers {
			peers = append(peers, peerStatus{id, p.established.Load(), p.bytes.Load()})
		}
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(peers)
		return
	}
	id, ok := strings.CutPrefix(r.URL.Path, "/peers/")
	if !ok || !peerID.MatchString(id) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	id = strings.ToLower(id)
	switch r.Method {
	case http.MethodDelete:
		s.mu.Lock()
		p := s.peers[id]
		s.mu.Unlock()
		if p != nil {
			p.stop()
		}
		w.WriteHeader(http.StatusNoContent)
	case http.MethodPost:
		s.answer(w, r, id)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *relay) answer(w http.ResponseWriter, r *http.Request, id string) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	offer := webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: string(body)}
	parsed, err := offer.Unmarshal()
	if err != nil || len(parsed.MediaDescriptions) != 1 || parsed.MediaDescriptions[0].MediaName.Media != "application" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	if s.peers[id] != nil {
		s.mu.Unlock()
		w.WriteHeader(http.StatusConflict)
		return
	}
	if len(s.peers) >= 64 {
		s.mu.Unlock()
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	pc, err := s.api.NewPeerConnection(s.config)
	if err != nil {
		s.mu.Unlock()
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	peerCtx, cancel := context.WithCancel(context.Background())
	p := &peer{id: id, server: s, pc: pc, ctx: peerCtx, cancel: cancel, limiter: rate.NewLimiter(40, 48), active: make(map[uint32]bool)}
	s.peers[id] = p
	s.mu.Unlock()
	p.attach()
	ok := false
	defer func() {
		if !ok {
			p.stop()
		}
	}()
	if err := pc.SetRemoteDescription(offer); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	gathered := webrtc.GatheringCompletePromise(pc)
	if err := pc.SetLocalDescription(answer); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, stop := context.WithTimeout(r.Context(), 5*time.Second)
	defer stop()
	select {
	case <-gathered:
	case <-peerCtx.Done():
		w.WriteHeader(http.StatusGone)
		return
	case <-ctx.Done():
		w.WriteHeader(http.StatusGatewayTimeout)
		return
	}
	desc := pc.LocalDescription()
	if desc == nil || peerCtx.Err() != nil {
		w.WriteHeader(http.StatusGone)
		return
	}
	w.Header().Set("Content-Type", "application/sdp")
	w.WriteHeader(http.StatusCreated)
	_, err = io.WriteString(w, desc.SDP)
	ok = err == nil
}
