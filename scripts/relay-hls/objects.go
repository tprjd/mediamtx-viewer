package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	maxObjectBytes = 16 << 20
	maxCacheBytes  = 64 << 20
	maxCacheFiles  = 256
	objectLifetime = 30 * time.Second
	fetchTimeout   = 8 * time.Second
)

var mediaFile = regexp.MustCompile(`^[0-9a-f]{12}_(?:video|audio)[1-9][0-9]{0,3}_(?:part|seg)[0-9]{1,20}\.mp4$`)
var errUnavailable = errors.New("media object unavailable")

type objectKey struct {
	Rendition string `json:"rendition"`
	File      string `json:"file"`
}

func (k objectKey) valid() bool {
	return (k.Rendition == "primary" || k.Rendition == "fallback") && mediaFile.MatchString(k.File)
}

type cachedObject struct {
	data    []byte
	expires time.Time
	order   uint64
}

type fetch struct {
	done    chan struct{}
	cancel  context.CancelFunc
	waiters int
	data    []byte
	err     error
}

type objectStore struct {
	origin     string
	credential string
	client     *http.Client
	mu         sync.Mutex
	files      map[objectKey]cachedObject
	nextOrder  uint64
	bytes      int
	fetches    map[objectKey]*fetch
	slots      chan struct{}
}

func newObjectStore(origin, credential string) (*objectStore, error) {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || u.User != nil || u.ForceQuery || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || credential == "" {
		return nil, errors.New("invalid relay source configuration")
	}
	loopback := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && loopback) {
		return nil, errors.New("invalid relay source origin")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DisableCompression = true
	transport.MaxResponseHeaderBytes = 32 << 10
	return &objectStore{
		origin: strings.TrimSuffix(u.String(), "/"), credential: credential,
		client: &http.Client{Transport: transport, Timeout: fetchTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		files:  make(map[objectKey]cachedObject), fetches: make(map[objectKey]*fetch), slots: make(chan struct{}, 8),
	}, nil
}

func (s *objectStore) download(ctx context.Context, key objectKey) ([]byte, error) {
	target := s.origin + "/api/relay/source/hls/" + key.Rendition + "/" + key.File
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, errUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+s.credential)
	res, err := s.client.Do(req)
	if err != nil {
		return nil, errUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK || res.ContentLength > maxObjectBytes || res.Header.Get("Content-Range") != "" {
		return nil, errUnavailable
	}
	mediaType := res.Header.Get("Content-Type")
	if (mediaType != "audio/mp4" && mediaType != "video/mp4") || res.Header.Get("Content-Encoding") != "" {
		return nil, errUnavailable
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, maxObjectBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxObjectBytes {
		return nil, errUnavailable
	}
	return data, nil
}

func (s *objectStore) remember(key objectKey, data []byte) {
	for len(s.files) >= maxCacheFiles || s.bytes+len(data) > maxCacheBytes {
		var oldestKey objectKey
		var oldestOrder uint64
		for k, file := range s.files {
			if oldestOrder == 0 || file.order < oldestOrder {
				oldestKey, oldestOrder = k, file.order
			}
		}
		s.bytes -= len(s.files[oldestKey].data)
		delete(s.files, oldestKey)
	}
	s.nextOrder++
	s.files[key] = cachedObject{data: data, expires: time.Now().Add(objectLifetime), order: s.nextOrder}
	s.bytes += len(data)
}

func (s *objectStore) get(ctx context.Context, key objectKey) ([]byte, error) {
	if !key.valid() {
		return nil, errUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	if f, ok := s.files[key]; ok {
		if time.Now().Before(f.expires) {
			s.mu.Unlock()
			return f.data, nil
		}
		s.bytes -= len(f.data)
		delete(s.files, key)
	}
	f := s.fetches[key]
	if f == nil {
		select {
		case s.slots <- struct{}{}:
		default:
			s.mu.Unlock()
			return nil, errUnavailable
		}
		downloadCtx, cancel := context.WithTimeout(context.Background(), fetchTimeout)
		f = &fetch{done: make(chan struct{}), cancel: cancel}
		s.fetches[key] = f
		go func() {
			defer cancel()
			data, err := s.download(downloadCtx, key)
			s.mu.Lock()
			defer s.mu.Unlock()
			if s.fetches[key] == f {
				delete(s.fetches, key)
				if err == nil {
					s.remember(key, data)
				}
			}
			f.data, f.err = data, err
			<-s.slots
			close(f.done)
		}()
	}
	f.waiters++
	s.mu.Unlock()
	select {
	case <-f.done:
		return f.data, f.err
	case <-ctx.Done():
		s.mu.Lock()
		f.waiters--
		if f.waiters == 0 && s.fetches[key] == f {
			delete(s.fetches, key)
			f.cancel()
		}
		s.mu.Unlock()
		return nil, ctx.Err()
	}
}
