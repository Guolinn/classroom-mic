package main

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"sync"
	"syscall"
	"time"

	"github.com/gen2brain/malgo"
	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
)

var version = "0.1.2"

type receiver struct {
	mu                        sync.Mutex
	player                    *playout
	pairToken, origin, ticket string
	control, audio            *webtransport.Session
}

func secret() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}
func equal(a, b string) bool {
	return len(a) == 43 && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
func (r *receiver) mute() {
	r.mu.Lock()
	old := r.audio
	r.audio = nil
	r.ticket = ""
	r.player.reset()
	r.mu.Unlock()
	if old != nil {
		old.CloseWithError(1, "Microphone stopped")
	}
}
func (r *receiver) serveControl(s *webtransport.Session) {
	defer func() { r.mute(); r.mu.Lock(); r.control = nil; r.mu.Unlock(); s.CloseWithError(0, "Control closed") }()
	ctx, cancel := context.WithTimeout(s.Context(), 5*time.Second)
	stream, err := s.AcceptStream(ctx)
	cancel()
	if err != nil {
		return
	}
	scan := bufio.NewScanner(stream)
	scan.Buffer(make([]byte, 1024), 4096)
	for {
		stream.SetReadDeadline(time.Now().Add(time.Second))
		if !scan.Scan() {
			return
		}
		var msg struct {
			ID     uint32   `json:"id"`
			Type   string   `json:"type"`
			Ticket string   `json:"ticket"`
			Volume *float64 `json:"volume"`
		}
		if json.Unmarshal(scan.Bytes(), &msg) != nil {
			return
		}
		r.player.beat()
		if msg.Volume != nil {
			r.player.setVolume(*msg.Volume)
		}
		switch msg.Type {
		case "arm":
			if len(msg.Ticket) != 43 {
				return
			}
			r.mute()
			r.mu.Lock()
			r.ticket = msg.Ticket
			r.mu.Unlock()
		case "mute":
			r.mute()
		case "test":
			r.mute()
			r.player.testTone()
		case "ping", "volume":
		default:
			return
		}
		response, _ := json.Marshal(map[string]any{"id": msg.ID, "ok": true, "version": version, "stats": r.player.snapshot()})
		stream.SetWriteDeadline(time.Now().Add(time.Second))
		if _, err := stream.Write(append(response, '\n')); err != nil {
			return
		}
	}
}
func (r *receiver) serveAudio(s *webtransport.Session, ticket string) {
	defer func() {
		r.mu.Lock()
		if r.audio == s {
			r.audio = nil
			r.player.reset()
		}
		r.mu.Unlock()
		s.CloseWithError(0, "Audio closed")
	}()
	window, count := time.Now(), 0
	for {
		packet, err := s.ReceiveDatagram(s.Context())
		if err != nil {
			return
		}
		now := time.Now()
		if now.Sub(window) >= time.Second {
			window, count = now, 0
		}
		count++
		if count > 400 {
			return
		}
		r.mu.Lock()
		if r.audio != s || r.ticket != ticket || r.control == nil {
			r.mu.Unlock()
			return
		}
		valid := r.player.push(packet, now)
		r.mu.Unlock()
		if !valid && (len(packet) != 492 || string(packet[:4]) != "MT01") {
			return
		}
	}
}

func certificate(ip net.IP) (tls.Certificate, string, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return tls.Certificate{}, "", err
	}
	now := time.Now()
	template := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "MicTurn local receiver"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, IPAddresses: []net.IP{ip, net.ParseIP("127.0.0.1")}, DNSNames: []string{"localhost"}}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	hash := sha256.Sum256(der)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, base64.RawURLEncoding.EncodeToString(hash[:]), nil
}
func localIP() string {
	interfaces, _ := net.Interfaces()
	for _, prefix := range []string{"en", "eth", "wlan", ""} {
		for _, iface := range interfaces {
			if prefix != "" && (len(iface.Name) < len(prefix) || iface.Name[:len(prefix)] != prefix) {
				continue
			}
			if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
				continue
			}
			addrs, _ := iface.Addrs()
			for _, addr := range addrs {
				ip, _, _ := net.ParseCIDR(addr.String())
				if ip.To4() != nil && ip.IsPrivate() {
					return ip.String()
				}
			}
		}
	}
	return "127.0.0.1"
}
func audioDevice(p *playout) (func(), error) {
	ctx, err := malgo.InitContext(nil, malgo.ContextConfig{}, nil)
	if err != nil {
		return nil, err
	}
	cfg := malgo.DefaultDeviceConfig(malgo.Playback)
	cfg.Playback.Format = malgo.FormatS16
	cfg.Playback.Channels = 1
	cfg.SampleRate = rate
	cfg.PeriodSizeInFrames = 128
	cfg.Periods = 2
	device, err := malgo.InitDevice(ctx.Context, cfg, malgo.DeviceCallbacks{Data: func(out, in []byte, frames uint32) { p.render(out, time.Now()) }})
	if err != nil {
		ctx.Uninit()
		ctx.Free()
		return nil, err
	}
	if err := device.Start(); err != nil {
		device.Uninit()
		ctx.Uninit()
		ctx.Free()
		return nil, err
	}
	return func() { device.Uninit(); ctx.Uninit(); ctx.Free() }, nil
}
func run() error {
	address := flag.String("address", localIP(), "LAN IPv4 address advertised to students")
	port := flag.Int("port", 4444, "Local UDP port")
	origin := flag.String("origin", "https://classroom-mic.beringtech.com", "Allowed website origin")
	noOpen := flag.Bool("no-open", false, "Do not open the teacher website")
	silent := flag.Bool("silent", false, "Test only: consume audio without opening a speaker")
	pairFile := flag.String("pair-file", "", "Test only: write private pairing data to this file (0600)")
	flag.Parse()
	ip := net.ParseIP(*address)
	if ip == nil || ip.To4() == nil || (!ip.IsPrivate() && !ip.IsLoopback()) {
		return errors.New("choose a private LAN IPv4 address")
	}
	u, err := url.Parse(*origin)
	if err != nil || u.Host == "" || u.Path != "" || (u.Scheme != "https" && u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") {
		return errors.New("invalid website origin")
	}
	cert, hash, err := certificate(ip)
	if err != nil {
		return err
	}
	r := &receiver{player: newPlayout(), pairToken: secret(), origin: *origin}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *silent {
		go func() {
			tick := time.NewTicker(5 * time.Millisecond)
			defer tick.Stop()
			b := make([]byte, 480)
			for {
				select {
				case <-ctx.Done():
					return
				case now := <-tick.C:
					r.player.render(b, now)
				}
			}
		}()
	} else {
		closeAudio, err := audioDevice(r.player)
		if err != nil {
			return fmt.Errorf("cannot open the selected sound output: %w", err)
		}
		defer closeAudio()
	}
	h3 := &http3.Server{Addr: net.JoinHostPort(*address, fmt.Sprint(*port)), TLSConfig: http3.ConfigureTLSConfig(&tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13}), QUICConfig: &quic.Config{EnableDatagrams: true, EnableStreamResetPartialDelivery: true, MaxIncomingStreams: 4, MaxIncomingUniStreams: 8, MaxIdleTimeout: 10 * time.Second}}
	webtransport.ConfigureHTTP3Server(h3)
	srv := &webtransport.Server{H3: h3, CheckOrigin: func(req *http.Request) bool { return req.Header.Get("Origin") == r.origin }}
	mux := http.NewServeMux()
	h3.Handler = mux
	mux.HandleFunc("/control", func(w http.ResponseWriter, req *http.Request) {
		if !equal(req.URL.Query().Get("key"), r.pairToken) {
			http.Error(w, "Forbidden", 403)
			return
		}
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.control != nil {
			http.Error(w, "Receiver already paired", 409)
			return
		}
		s, err := srv.Upgrade(w, req)
		if err != nil {
			return
		}
		r.control = s
		go r.serveControl(s)
	})
	mux.HandleFunc("/audio", func(w http.ResponseWriter, req *http.Request) {
		ticket := req.URL.Query().Get("ticket")
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.control == nil || r.audio != nil || !equal(ticket, r.ticket) {
			http.Error(w, "Not approved", 403)
			return
		}
		s, err := srv.Upgrade(w, req)
		if err != nil {
			return
		}
		r.audio = s
		go r.serveAudio(s, ticket)
	})
	listener, err := net.ListenPacket("udp", h3.Addr)
	if err != nil {
		return err
	}
	defer listener.Close()
	endpoint := "https://" + listener.LocalAddr().String()
	config := map[string]any{"v": 1, "url": endpoint, "hash": hash, "key": r.pairToken}
	data, _ := json.Marshal(config)
	code := "mt1." + base64.RawURLEncoding.EncodeToString(data)
	if *pairFile != "" {
		if err := os.WriteFile(*pairFile, data, 0600); err != nil {
			return err
		}
	}
	fmt.Printf("MicTurn receiver %s (experimental)\nKeep this window open. Press Control-C to stop.\nUse the same Wi-Fi as the students. Allow local network access if asked.\n\nPairing code (teacher only):\n%s\n\n", version, code)
	if !*noOpen && runtime.GOOS == "darwin" {
		exec.Command("open", *origin+"/#receiver="+url.QueryEscape(code)).Start()
	}
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Serve(listener) }()
	select {
	case <-ctx.Done():
		r.mute()
		srv.Close()
		return nil
	case err := <-errCh:
		return err
	}
}
func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
