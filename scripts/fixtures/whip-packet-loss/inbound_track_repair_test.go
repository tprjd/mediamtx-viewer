package webrtc

import (
	"encoding/binary"
	"testing"
	"time"

	"github.com/bluenviron/mediamtx/internal/test"
	"github.com/pion/rtp"
	pion "github.com/pion/webrtc/v4"
	"github.com/stretchr/testify/require"
)

func TestInboundVideoLateRepair(t *testing.T) {
	pub, err := pion.NewPeerConnection(pion.Configuration{})
	require.NoError(t, err)
	defer pub.Close() //nolint:errcheck
	track, err := pion.NewTrackLocalStaticRTP(pion.RTPCodecCapability{MimeType: pion.MimeTypeH264, ClockRate: 90000}, "video", "publisher")
	require.NoError(t, err)
	_, err = pub.AddTrack(track)
	require.NoError(t, err)
	reader := &PeerConnection{LocalRandomUDP: true, IPsFromInterfaces: true, Publish: false, Log: test.NilLogger}
	require.NoError(t, reader.Start())
	defer reader.Close()
	offer, err := pub.CreateOffer(nil)
	require.NoError(t, err)
	require.NoError(t, pub.SetLocalDescription(offer))
	answer, err := reader.CreateFullAnswer(&offer, false)
	require.NoError(t, err)
	require.NoError(t, pub.SetRemoteDescription(*answer))
	require.NoError(t, reader.WaitUntilConnected(10*time.Second))
	write := func(seq uint16) {
		payload := []byte{0x61, 0, 0}
		binary.BigEndian.PutUint16(payload[1:], seq)
		require.NoError(t, track.WriteRTP(&rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: uint32(seq) * 90, SSRC: 1234}, Payload: payload}))
	}
	write(0)
	require.NoError(t, reader.GatherInboundTracks(5*time.Second))
	received := make(chan uint16, 400)
	reader.InboundTracks()[0].OnPacketRTP = func(p *rtp.Packet) { received <- binary.BigEndian.Uint16(p.Payload[1:]) }
	reader.StartReading()
	for seq := uint16(2); seq <= 301; seq++ {
		write(seq)
		if seq%25 == 0 {
			time.Sleep(8 * time.Millisecond)
		}
	}
	write(1)
	write(1) // An authenticated duplicate must still be rejected.
	write(302)
	deadline := time.NewTimer(time.Second)
	defer deadline.Stop()
	for expected := uint16(0); expected <= 302; expected++ {
		select {
		case got := <-received:
			require.Equal(t, expected, got, "late video repair must preserve the packet sequence")
		case <-deadline.C:
			t.Fatalf("missing repaired packet %d", expected)
		}
	}
}
