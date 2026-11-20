package main

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/logging"
	"github.com/pion/webrtc/v4"
)

//go:generate python3 notices.py
//go:embed NOTICES.txt
var notices string

func settings() webrtc.SettingEngine {
	var se webrtc.SettingEngine
	se.LoggerFactory = &logging.DefaultLoggerFactory{Writer: io.Discard}
	se.SetSTUNGatherTimeout(1500 * time.Millisecond)
	se.SetICETimeouts(6*time.Second, 10*time.Second, 2*time.Second)
	se.SetSCTPMaxMessageSize(frameSize)
	se.SetSCTPMaxReceiveBufferSize(256 << 10)
	return se
}

func run() error {
	token := os.Getenv("FRANKERZ_HLS_LOCAL_TOKEN")
	if token == "" {
		return errors.New("missing local relay token")
	}
	objects, err := newObjectStore(os.Getenv("FRANKERZ_HLS_ORIGIN"), os.Getenv("FRANKERZ_HLS_CREDENTIAL"))
	if err != nil {
		return err
	}
	se := settings()
	if publicHost := os.Getenv("FRANKERZ_RELAY_PUBLIC_HOST"); publicHost != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		addresses, err := net.DefaultResolver.LookupHost(ctx, publicHost)
		cancel()
		if err != nil || len(addresses) == 0 {
			return errors.New("could not resolve relay public host")
		}
		err = se.SetICEAddressRewriteRules(webrtc.ICEAddressRewriteRule{External: addresses, AsCandidateType: webrtc.ICECandidateTypeHost, Mode: webrtc.ICEAddressRewriteReplace})
		if err != nil {
			return errors.New("could not configure relay public host")
		}
	}
	logger := se.LoggerFactory.NewLogger("ice")
	udp, err := ice.NewMultiUDPMuxFromPort(28190, ice.UDPMuxFromPortWithLogger(logger))
	if err != nil {
		return errors.New("could not bind relay UDP port 28190")
	}
	defer udp.Close()
	listener, err := net.Listen("tcp", ":28190")
	if err != nil {
		return errors.New("could not bind relay TCP port 28190")
	}
	tcp := ice.NewTCPMuxDefault(ice.TCPMuxParams{Listener: listener, ReadBufferSize: 8 << 10, WriteBufferSize: 1 << 20, Logger: logger})
	defer tcp.Close()
	se.SetICEUDPMux(udp)
	se.SetICETCPMux(tcp)
	se.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4, webrtc.NetworkTypeUDP6, webrtc.NetworkTypeTCP4, webrtc.NetworkTypeTCP6})
	api := webrtc.NewAPI(webrtc.WithSettingEngine(se))
	handler := newRelay(api, webrtc.Configuration{ICEServers: []webrtc.ICEServer{{URLs: []string{"stun:stun.cloudflare.com:3478"}}}}, objects, token)
	httpServer := &http.Server{Addr: "127.0.0.1:29998", Handler: handler, ReadHeaderTimeout: 2 * time.Second, ReadTimeout: 8 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8 << 10}
	if err := httpServer.ListenAndServe(); err != nil {
		return errors.New("local relay API stopped or could not bind port 29998")
	}
	return nil
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--licenses" {
		fmt.Print(notices)
		return
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
