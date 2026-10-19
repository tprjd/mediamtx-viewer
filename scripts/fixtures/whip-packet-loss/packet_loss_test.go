package webrtc

import (
	"sort"
	"testing"
	"time"

	"github.com/bluenviron/gortsplib/v5/pkg/rtpreceiver"
	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/srtp/v3"
)

// Synthetic RTP is encrypted before impairment. No live stream is affected.
func TestWorsePacketLoss(t *testing.T) {
	for _, c := range []struct {
		name              string
		rate, size, burst int
		repair            time.Duration
		lossEvery         int
		repairEvery       int
		wantLost          uint64
	}{
		{"128_packet_burst_repaired_at_150ms", 1600, 512, 128, 150 * time.Millisecond, 0, 0, 0},
		{"32_packet_burst_never_returns", 1600, 512, 32, 0, 0, 0, 32},
		{"one_percent_permanent_loss", 1600, 512, 0, 0, 100, 0, 15},
		{"five_percent_permanent_loss", 1600, 512, 0, 0, 20, 0, 75},
		{"twenty_percent_permanent_loss", 1600, 512, 0, 0, 5, 0, 300},
		{"late_repairs_outside_window", 1600, 512, 32, 400 * time.Millisecond, 0, 0, 32},
		{"slow_video_permanent_loss", 100, 512, 1, 0, 0, 0, 1},
		{"audio_permanent_loss", 50, 64, 1, 0, 0, 0, 1},
		{"permanent_loss_with_overlapping_150ms_repairs", 1600, 512, 0, 150 * time.Millisecond, 100, 17, 15},
	} {
		t.Run(c.name, func(t *testing.T) {
			sender, err := srtp.CreateContext(make([]byte, 16), make([]byte, 14), srtp.ProtectionProfileAes128CmHmacSha1_80)
			if err != nil {
				t.Fatal(err)
			}
			receiver, err := srtp.CreateContext(make([]byte, 16), make([]byte, 14), srtp.ProtectionProfileAes128CmHmacSha1_80, srtp.SRTPReplayProtection(512))
			if err != nil {
				t.Fatal(err)
			}
			rr := &rtpreceiver.Receiver{ClockRate: 90000, UnrealiableTransport: true, BufferSize: c.size, MaxReorderDelay: 200 * time.Millisecond, Period: time.Hour, WritePacketRTCP: func(rtcp.Packet) {}}
			if err = rr.Initialize(); err != nil {
				t.Fatal(err)
			}
			defer rr.Close()
			type event struct {
				at  time.Duration
				raw []byte
				seq uint16
			}
			var events []event
			count := 2000
			for seq := 0; seq < count; seq++ {
				pkt := &rtp.Packet{Header: rtp.Header{Version: 2, SSRC: 1, SequenceNumber: uint16(65000 + seq), Timestamp: uint32(seq * 90000 / c.rate)}, Payload: []byte{0x61, 1}}
				raw, err := pkt.Marshal()
				if err != nil {
					t.Fatal(err)
				}
				encrypted, err := sender.EncryptRTP(nil, raw, nil)
				if err != nil {
					t.Fatal(err)
				}
				at := time.Duration(seq) * time.Second / time.Duration(c.rate)
				burst := seq >= 100 && seq < 100+c.burst
				impaired := seq > 0 && seq <= 1500
				if burst && c.repair == 0 || impaired && c.lossEvery > 0 && seq%c.lossEvery == 0 {
					continue
				}
				if burst || impaired && c.repairEvery > 0 && seq%c.repairEvery == 0 {
					at += c.repair
				}
				events = append(events, event{at, encrypted, uint16(65000 + seq)})
			}
			sort.SliceStable(events, func(i, j int) bool { return events[i].at < events[j].at })
			receivedAt := map[uint16]time.Duration{}
			var lost uint64
			var maxWait time.Duration
			emitted := 0
			rejected := 0
			var previous uint16
			for _, e := range events {
				raw, err := receiver.DecryptRTP(nil, e.raw, nil)
				if err != nil {
					rejected++
					continue
				}
				pkt := new(rtp.Packet)
				if err = pkt.Unmarshal(raw); err != nil {
					t.Fatal(err)
				}
				receivedAt[e.seq] = e.at
				out, n := rr.ProcessPacket2(pkt, time.Unix(1, 0).Add(e.at), true)
				lost += n
				for _, p := range out {
					if emitted > 0 && int16(p.SequenceNumber-previous) <= 0 {
						t.Fatalf("duplicate or out-of-order output: previous=%d current=%d", previous, p.SequenceNumber)
					}
					previous = p.SequenceNumber
					emitted++
					if wait := e.at - receivedAt[p.SequenceNumber]; wait > maxWait {
						maxWait = wait
					}
				}
			}
			t.Logf("rate=%d/s lost=%d rejected=%d emitted=%d maximum-held=%.1fms", c.rate, lost, rejected, emitted, float64(maxWait)/float64(time.Millisecond))
			if lost != c.wantLost {
				t.Errorf("lost=%d want %d", lost, c.wantLost)
			}
			if emitted != count-int(c.wantLost) {
				t.Errorf("emitted=%d want %d", emitted, count-int(c.wantLost))
			}
			if maxWait > 200*time.Millisecond+time.Second/time.Duration(c.rate) {
				t.Errorf("reorder wait %s exceeds 200ms plus one packet interval", maxWait)
			}
		})
	}
}

func TestWorsePacketLossOverlappingGaps(t *testing.T) {
	type arrival struct {
		seq, ms int
		want    []uint16
		lost    uint64
	}
	for _, c := range []struct {
		name     string
		arrivals []arrival
	}{
		{"repaired_gap_keeps_newer_deadline", []arrival{
			{0, 0, []uint16{0}, 0}, {2, 1, nil, 0}, {4, 190, nil, 0},
			{1, 195, []uint16{1, 2}, 0}, {5, 202, nil, 0},
			{3, 210, []uint16{3, 4, 5}, 0},
		}},
		{"permanent_gap_does_not_expire_newer_repair", []arrival{
			{0, 0, []uint16{0}, 0}, {2, 1, nil, 0}, {4, 190, nil, 0},
			{5, 202, []uint16{2}, 1}, {3, 210, []uint16{3, 4, 5}, 0},
		}},
		{"new_arrivals_do_not_extend_old_deadlines", []arrival{
			{0, 0, []uint16{0}, 0}, {2, 1, nil, 0}, {4, 190, nil, 0},
			{5, 202, []uint16{2}, 1}, {6, 389, nil, 0},
			{7, 390, []uint16{4, 5, 6, 7}, 1},
		}},
		{"arrival_age_is_not_sequence_order", []arrival{
			{0, 0, []uint16{0}, 0}, {4, 1, nil, 0}, {2, 190, nil, 0},
			{5, 202, []uint16{2, 4, 5}, 2},
		}},
		{"head_repair_also_releases_expired_packets", []arrival{
			{0, 0, []uint16{0}, 0}, {2, 1, nil, 0}, {4, 2, nil, 0},
			{1, 205, []uint16{1, 2, 4}, 1},
		}},
		{"duplicate_does_not_extend_deadline", []arrival{
			{0, 0, []uint16{0}, 0}, {2, 1, nil, 0}, {2, 100, nil, 0},
			{3, 201, []uint16{2, 3}, 1},
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			for _, base := range []uint16{0, 65534} {
				rr := &rtpreceiver.Receiver{ClockRate: 90000, UnrealiableTransport: true, BufferSize: 512, MaxReorderDelay: 200 * time.Millisecond, Period: time.Hour, WritePacketRTCP: func(rtcp.Packet) {}}
				if err := rr.Initialize(); err != nil {
					t.Fatal(err)
				}
				defer rr.Close()
				var totalLost, totalReceived uint64
				for _, e := range c.arrivals {
					out, lost := rr.ProcessPacket2(&rtp.Packet{Header: rtp.Header{Version: 2, SSRC: 1, SequenceNumber: base + uint16(e.seq)}}, time.Unix(1, 0).Add(time.Duration(e.ms)*time.Millisecond), true)
					if lost != e.lost || len(out) != len(e.want) {
						t.Fatalf("base=%d packet=%d at=%dms lost=%d want=%d emitted=%d want=%v", base, e.seq, e.ms, lost, e.lost, len(out), e.want)
					}
					for i, want := range e.want {
						if out[i].SequenceNumber != base+want {
							t.Fatalf("base=%d packet=%d emitted=%d want=%d", base, e.seq, out[i].SequenceNumber, base+want)
						}
					}
					totalLost += e.lost
					totalReceived += uint64(len(e.want))
					if stats := rr.Stats(); stats.Lost != totalLost || stats.Received != totalReceived {
						t.Fatalf("incorrect receiver statistics: %+v", stats)
					}
				}
			}
		})
	}
}
