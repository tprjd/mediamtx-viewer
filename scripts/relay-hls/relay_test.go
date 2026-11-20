package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

const segment = "7f18ab34cd56_video1_seg42.mp4"
const localToken = "local-test-token"

func checkEventually(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for expected state")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func loopbackAPI() *webrtc.API {
	se := settings()
	se.SetIncludeLoopbackCandidate(true)
	se.SetIPFilter(func(ip net.IP) bool { return ip.IsLoopback() })
	return webrtc.NewAPI(webrtc.WithSettingEngine(se))
}

func control(t *testing.T, method, url, body, token string, want int) []byte {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != want {
		t.Fatalf("%s returned %d, want %d", method, res.StatusCode, want)
	}
	return b
}

type browser struct {
	dc       *webrtc.DataChannel
	messages chan webrtc.DataChannelMessage
}

func connect(t *testing.T, url, id string) browser {
	t.Helper()
	pc, err := loopbackAPI().NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = pc.Close() })
	dc, err := pc.CreateDataChannel("frankerz-hls", nil)
	if err != nil {
		t.Fatal(err)
	}
	ready := make(chan struct{})
	b := browser{dc, make(chan webrtc.DataChannelMessage, 256)}
	dc.OnOpen(func() { close(ready) })
	dc.OnMessage(func(m webrtc.DataChannelMessage) { b.messages <- m })
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered := webrtc.GatheringCompletePromise(pc)
	if err := pc.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gathered:
	case <-time.After(5 * time.Second):
		t.Fatal("browser ICE gathering failed")
	}
	answer := control(t, "POST", url+"/peers/"+id, pc.LocalDescription().SDP, localToken, 201)
	err = pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: string(answer)})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-ready:
	case <-time.After(5 * time.Second):
		t.Fatal("data channel did not open")
	}
	return b
}

func (b browser) request(t *testing.T, id uint32, rendition, file string) {
	t.Helper()
	body, err := json.Marshal(request{id, objectKey{rendition, file}})
	if err != nil {
		t.Fatal(err)
	}
	if err := b.dc.SendText(string(body)); err != nil {
		t.Fatal(err)
	}
}

func (b browser) next(t *testing.T) webrtc.DataChannelMessage {
	t.Helper()
	select {
	case m := <-b.messages:
		return m
	case <-time.After(5 * time.Second):
		t.Fatal("no data channel reply")
	}
	return webrtc.DataChannelMessage{}
}

func (b browser) expectObject(t *testing.T, id uint32, expected []byte) {
	t.Helper()
	header := b.next(t)
	var h struct {
		ID   uint32
		Size int
	}
	if !header.IsString || json.Unmarshal(header.Data, &h) != nil || h.ID != id || h.Size != len(expected) {
		t.Fatal("invalid object header")
	}
	got := make([]byte, 0, len(expected))
	for len(got) < len(expected) {
		m := b.next(t)
		if m.IsString || len(m.Data) > frameSize || len(m.Data) <= 4 || binary.BigEndian.Uint32(m.Data) != id {
			t.Fatal("invalid binary chunk")
		}
		got = append(got, m.Data[4:]...)
	}
	if !bytes.Equal(got, expected) {
		t.Fatal("received different media bytes")
	}
}

func TestSixBrowsersShareOneOriginFetch(t *testing.T) {
	key := objectKey{"primary", segment}
	// Two seconds of video at 14 Mbps.
	primary := bytes.Repeat([]byte{0, 1, 7, 44, 255}, 700000)
	fallback := bytes.Repeat([]byte("backup"), 3000)
	var calls atomic.Int32
	release := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "GET" || r.Header.Get("Authorization") != "Bearer source-test-token" || r.Header.Get("Cookie") != "" || r.URL.RawQuery != "" {
			t.Error("unexpected origin request")
			w.WriteHeader(403)
			return
		}
		w.Header().Set("Content-Type", "video/mp4")
		switch r.URL.Path {
		case "/api/relay/source/hls/primary/" + segment:
			select {
			case <-release:
			case <-ctx.Done():
				return
			case <-r.Context().Done():
				return
			}
			_, _ = w.Write(primary)
		case "/api/relay/source/hls/fallback/" + segment:
			_, _ = w.Write(fallback)
		default:
			t.Error("unexpected origin path")
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(origin.Close)
	objects, err := newObjectStore(origin.URL, "source-test-token")
	if err != nil {
		t.Fatal(err)
	}
	s := newRelay(loopbackAPI(), webrtc.Configuration{}, objects, localToken)
	site := httptest.NewServer(s)
	t.Cleanup(site.Close)
	var viewers []browser
	for i := 1; i <= 6; i++ {
		viewers = append(viewers, connect(t, site.URL, fmt.Sprintf("bb000000-0000-4000-8000-%012x", i)))
	}
	for i, b := range viewers {
		b.request(t, uint32(i+1), "primary", segment)
	}
	checkEventually(t, func() bool {
		objects.mu.Lock()
		defer objects.mu.Unlock()
		return objects.fetches[key] != nil && objects.fetches[key].waiters == 6
	})
	close(release)
	for i, b := range viewers {
		b.expectObject(t, uint32(i+1), primary)
	}
	viewers[0].request(t, 44, "primary", segment)
	viewers[0].expectObject(t, 44, primary)
	if calls.Load() != 1 {
		t.Fatalf("got %d origin requests for one segment", calls.Load())
	}
	viewers[0].request(t, 45, "fallback", segment)
	viewers[0].expectObject(t, 45, fallback)
	for _, bad := range []string{"index.m3u8", "7f18ab34cd56_video1_init.mp4", "../" + segment, segment + "?arg=1"} {
		viewers[0].request(t, 46, "primary", bad)
		m := viewers[0].next(t)
		if !m.IsString || string(m.Data) != `{"id":46,"error":true}` {
			t.Fatal("unsafe file was accepted")
		}
	}
	if calls.Load() != 2 {
		t.Fatal("unsafe file reached the origin")
	}
	var peers []peerStatus
	stats := control(t, "GET", site.URL+"/peers", "", localToken, 200)
	if json.Unmarshal(stats, &peers) != nil || len(peers) != 6 {
		t.Fatal("incorrect peer list")
	}
	var total uint64
	for _, p := range peers {
		if !p.Established {
			t.Fatal("established peer not reported")
		}
		total += p.OutboundBytes
	}
	if total != uint64(7*len(primary)+len(fallback)) {
		t.Fatalf("incorrect total payload byte count %d", total)
	}
	peerURL := site.URL + "/peers/bb000000-0000-4000-8000-000000000001"
	control(t, "DELETE", peerURL, "", "incorrect-token", 401)
	control(t, "DELETE", peerURL, "", localToken, 204)
	control(t, "DELETE", peerURL, "", localToken, 204)
	checkEventually(t, func() bool { return viewers[0].dc.ReadyState() == webrtc.DataChannelStateClosed })
	control(t, "GET", site.URL+"/peers", "", "incorrect-token", 401)
	control(t, "POST", site.URL+"/peers/bad", "", localToken, 404)
	control(t, "POST", peerURL, "v=0\r\nm=video", localToken, 400)
	control(t, "POST", peerURL, strings.Repeat("s", 65537), localToken, 413)
}

func TestOriginLimitsAndAbandonedDownload(t *testing.T) {
	var kind atomic.Int32
	var redirects atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { redirects.Add(1) }))
	defer other.Close()
	started := make(chan struct{})
	canceled := make(chan struct{})
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "video/mp4")
		switch kind.Load() {
		case 0:
			w.Header().Set("Content-Length", strconv.Itoa(maxObjectBytes+1))
			w.WriteHeader(200)
		case 1:
			w.WriteHeader(206)
			_, _ = w.Write([]byte("partial"))
		case 2:
			http.Redirect(w, r, other.URL, http.StatusTemporaryRedirect)
		case 3:
			close(started)
			<-r.Context().Done()
			close(canceled)
		case 4:
			w.WriteHeader(http.StatusForbidden)
		case 5:
			w.Header().Set("Content-Range", "bytes 0-3/9")
			_, _ = w.Write([]byte("part"))
		case 6:
			w.(http.Flusher).Flush()
			block := make([]byte, 1<<16)
			for i := 0; i <= maxObjectBytes/len(block); i++ {
				if _, err := w.Write(block); err != nil {
					return
				}
			}
		case 7:
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte("sign in"))
		case 8:
			w.Header().Set("Content-Encoding", "gzip")
			_, _ = w.Write([]byte("unexpected encoding"))
		}
	}))
	defer origin.Close()
	s, err := newObjectStore(origin.URL, "source-credential")
	if err != nil {
		t.Fatal(err)
	}
	key := objectKey{"primary", segment}
	for _, code := range []int32{0, 1, 2, 4, 5, 6, 7, 8} {
		kind.Store(code)
		if _, err := s.get(context.Background(), key); err == nil {
			t.Fatalf("bad upstream reply %d reached viewer", code)
		}
	}
	if redirects.Load() != 0 {
		t.Fatal("followed origin redirect")
	}
	kind.Store(3)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := s.get(ctx, key); done <- err }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("fetch did not start")
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("abandoned reader succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("reader did not cancel")
	}
	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("last peer left the origin fetch running")
	}
	if _, err := newObjectStore("http://example.com", "test"); err == nil {
		t.Fatal("public plain HTTP accepted a bearer credential")
	}
}

func TestCacheBoundsAndSharedCancellation(t *testing.T) {
	wait := make(chan struct{})
	started := make(chan struct{})
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-r.Context().Done():
			return
		case <-wait:
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte{1, 2, 3})
		}
	}))
	defer origin.Close()
	store, err := newObjectStore(origin.URL, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	key := objectKey{"primary", segment}
	ctx, cancel := context.WithCancel(context.Background())
	first := make(chan error, 1)
	go func() { _, err := store.get(ctx, key); first <- err }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("origin did not start")
	}
	second := make(chan error, 1)
	go func() { _, err := store.get(context.Background(), key); second <- err }()
	checkEventually(t, func() bool {
		store.mu.Lock()
		defer store.mu.Unlock()
		f := store.fetches[key]
		return f != nil && f.waiters == 2
	})
	cancel()
	if <-first == nil {
		t.Fatal("canceled peer kept its fetch")
	}
	close(wait)
	if err := <-second; err != nil {
		t.Fatal("one canceled peer interrupted another viewer")
	}

	// Reuse the allocation so the test can check the byte budget without excessive RAM.
	full := make([]byte, maxObjectBytes)
	for i := 0; i < 6; i++ {
		store.remember(objectKey{"primary", fmt.Sprintf("7f18ab34cd56_video1_seg%d.mp4", i)}, full)
	}
	if store.bytes != maxCacheBytes || len(store.files) != maxCacheBytes/maxObjectBytes {
		t.Fatal("cache exceeded its byte budget")
	}
	for i := 0; i < maxCacheFiles+10; i++ {
		store.remember(objectKey{"primary", fmt.Sprintf("7f18ab34cd56_audio1_part%d.mp4", i)}, []byte{1})
	}
	if len(store.files) != maxCacheFiles || store.bytes != maxCacheFiles {
		t.Fatal("cache did not discard old objects")
	}
}
