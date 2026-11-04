package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"testing"
	"time"

	"github.com/quic-go/quic-go"
)

func TestAddrKind(t *testing.T) {
	for ip, want := range map[string]string{
		"8.8.8.8": "public", "2606:4700::1111": "public", "10.1.2.3": "private", "192.168.1.1": "private", "172.31.0.1": "private",
		"127.0.0.1": "private", "169.254.169.254": "private", "::1": "private", "fd00:ec2::254": "private", "fe80::1": "private",
		"100.64.0.1": "cgnat", "198.18.0.5": "fakeip", "0.0.0.0": "reserved", "224.0.0.1": "reserved", "255.255.255.255": "reserved",
		"::ffff:10.0.0.1": "private", "64:ff9b::a00:1": "reserved", "2002:a00:1::": "reserved", "2001:db8::1": "reserved",
		"ff02::1": "reserved", "::": "reserved", "2001:0:4136:e378::1": "reserved", "4000::1": "reserved",
	} {
		if got := addrKind(netip.MustParseAddr(ip)); got != want {
			t.Errorf("%s: %s, want %s", ip, got, want)
		}
	}
	selfAddrs[netip.MustParseAddr("16.76.79.94")] = true
	defer delete(selfAddrs, netip.MustParseAddr("16.76.79.94"))
	if addrKind(netip.MustParseAddr("16.76.79.94")) != "self" {
		t.Error("own address not refused")
	}
}

func TestValidHost(t *testing.T) {
	for h, want := range map[string]bool{"nas.example.com": true, "1.2.3.4": true, "2001:db8::1": true, "a_b.example.com": true,
		"localhost": false, "x.localhost": false, "example": false, "-a.com": false, "a..com": false, "a.com/x": false, "fe80::1%eth0": false, "": false} {
		if validHost(h) != want {
			t.Errorf("%q: %v", h, !want)
		}
	}
}

func TestIdentify(t *testing.T) {
	for in, want := range map[string]string{
		"SSH-2.0-OpenSSH_9.6\r\n": "ssh|SSH-2.0-OpenSSH_9.6", "220 mx.example.com ESMTP Postfix\r\n": "smtp|220 mx.example.com ESMTP Postfix",
		"220 (vsFTPd 3.0.5)\r\n": "ftp|220 (vsFTPd 3.0.5)", "HTTP/1.1 400 Bad Request\r\nServer: nginx": "http|HTTP/1.1 400 Bad Request",
		"+OK Dovecot ready.\r\n": "pop3|+OK Dovecot ready.", "RFB 003.008\n": "vnc|RFB 003.008", "-ERR unknown command\r\n": "redis|-ERR unknown command",
		"J\x00\x00\x00\x0a8.0.36\x00\x01\x02": "mysql|MySQL 8.0.36", "\x16\x03\x01\x00": "|....",
	} {
		svc, line := identify([]byte(in))
		if got := svc + "|" + line; got != want {
			t.Errorf("%q: %q, want %q", in, got, want)
		}
	}
}

func TestLimits(t *testing.T) {
	now := time.Unix(1e9, 0)
	l := newLimits(func() time.Time { return now })
	for i := 0; i < 5; i++ {
		if w, _ := l.visit(1, "t"+strconv.Itoa(i)); w != "" {
			t.Fatalf("target %d refused: %s", i, w)
		}
	}
	if w, _ := l.visit(1, "t5"); w != "targets" {
		t.Errorf("6th target: %q", w)
	}
	for i := 5; i < 10; i++ {
		if w, _ := l.visit(1, "t0"); w != "" {
			t.Fatalf("check %d refused: %s", i, w)
		}
	}
	if w, r := l.visit(1, "t0"); w != "visitor" || r < 3500 {
		t.Errorf("11th check: %q, retry %d", w, r)
	}
	if w, _ := l.visit(2, "t0"); w != "" {
		t.Error("another visitor refused")
	}
	now = now.Add(time.Hour)
	if w, _ := l.visit(1, "t9"); w != "" {
		t.Errorf("an hour later: %q", w)
	}

	a := netip.MustParseAddr("8.8.8.8")
	for i := 0; i < perDest; i++ {
		now = now.Add(2 * time.Second)
		if w, _ := l.dest(a); w != "" {
			t.Fatalf("connection %d refused: %s", i, w)
		}
	}
	if w, _ := l.dest(a); w != "dest" {
		t.Errorf("one address too often: %q", w)
	}
	for i := 0; i < sitePerMinute; i++ {
		l.dest(netip.AddrFrom4([4]byte{9, 9, byte(i >> 8), byte(i)}))
	}
	if w, _ := l.dest(netip.MustParseAddr("1.1.1.1")); w != "site" {
		t.Errorf("site per minute: %q", w)
	}
}

func get(t *testing.T, h http.Handler, q, remote string) (*Result, int) {
	r := httptest.NewRequest("GET", "/v1/probe?"+q, nil)
	r.RemoteAddr = remote
	r.Header.Set("Origin", "https://reach.1ms.dog")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var res Result
	json.Unmarshal(w.Body.Bytes(), &res)
	if w.Header().Get("Access-Control-Allow-Origin") != "https://reach.1ms.dog" {
		t.Error("no CORS for the page")
	}
	return &res, w.Code
}

func TestHandlerNeverConnectsToPrivate(t *testing.T) {
	h := handler(newLimits(time.Now))
	for _, host := range []string{"192.168.1.1", "127.0.0.1", "100.64.1.1", "[::1]", "169.254.169.254"} {
		res, code := get(t, h, "host="+host+"&port=22", "203.0.113.9:1234")
		if code != 200 || res.K != "private" || res.TCP != nil {
			t.Errorf("%s: %d %+v", host, code, res)
		}
	}
	for _, q := range []string{"host=a.com&port=0", "host=a.com&port=70000", "host=localhost&port=22", "host=a.com&port=22&mode=icmp", "host=1.2.3.0/24&port=22", "host=a.com&port=22-80"} {
		if res, code := get(t, h, q, "203.0.113.9:1234"); code != 400 || res.K != "bad" {
			t.Errorf("%s: %d %+v", q, code, res)
		}
	}
	// 5 checks were counted above; 5 more are allowed, the 11th isn't
	for i := 0; i < 5; i++ {
		get(t, h, "host=192.168.1.1&port=22", "203.0.113.9:1234")
	}
	if res, code := get(t, h, "host=192.168.1.1&port=22", "203.0.113.9:1234"); code != 429 || res.K != "limit" || res.Which != "visitor" {
		t.Errorf("11th: %d %+v", code, res)
	}
	if res, _ := get(t, h, "host=10.0.0.9&port=22", "203.0.113.10:1"); res.K != "private" {
		t.Errorf("a new visitor: %+v", res)
	}
	for i := 1; i < 5; i++ {
		get(t, h, "host=10.0.0."+strconv.Itoa(i)+"&port=22", "203.0.113.10:1")
	}
	if res, _ := get(t, h, "host=10.0.0.5&port=22", "203.0.113.10:1"); res.K != "limit" || res.Which != "targets" {
		t.Errorf("6th target: %+v", res)
	}
	// the same /64 is the same visitor
	for i := 0; i < 10; i++ {
		get(t, h, "host=10.0.0.1&port=22", "[2001:db8:1:2::"+strconv.Itoa(i+1)+"]:1")
	}
	if res, _ := get(t, h, "host=10.0.0.1&port=22", "[2001:db8:1:2:ffff::1]:1"); res.K != "limit" {
		t.Error("an IPv6 visitor got around the limit by changing address")
	}
}

func listen(t *testing.T, serve func(net.Conn)) netip.AddrPort {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() { defer c.Close(); serve(c) }()
		}
	}()
	return netip.MustParseAddrPort(ln.Addr().String())
}

func selfSigned(t *testing.T, name string) tls.Certificate {
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: name}, DNSNames: []string{name},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
	der, _ := x509.CreateCertificate(rand.Reader, tpl, tpl, &k.PublicKey, k)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: k}
}

func TestProbeTCP(t *testing.T) {
	ctx := context.Background()
	ssh := listen(t, func(c net.Conn) { c.Write([]byte("SSH-2.0-OpenSSH_9.6\r\n")); time.Sleep(time.Second) })
	var res Result
	probeTCP(ctx, ssh, "", &res)
	if res.K != "banner" || res.Svc != "ssh" || res.Banner != "SSH-2.0-OpenSSH_9.6" || res.TCP == nil {
		t.Errorf("ssh: %+v", res)
	}

	cert := selfSigned(t, "nas.example.com")
	tl := listen(t, func(c net.Conn) {
		s := tls.Server(c, &tls.Config{Certificates: []tls.Certificate{cert}, NextProtos: []string{"h2"}})
		s.Handshake()
		time.Sleep(200 * time.Millisecond)
	})
	res = Result{}
	probeTCP(ctx, tl, "nas.example.com", &res)
	if res.K != "tls" || res.TLS == nil || res.TLS.OK || res.TLS.Problem != "self" || res.TLS.ALPN != "h2" || res.TLS.Version != "TLS 1.3" || res.TLS.Chain[0].Subject != "nas.example.com" {
		t.Errorf("tls: %+v %+v", res, res.TLS)
	}

	plainHTTP := listen(t, func(c net.Conn) {
		b := make([]byte, 1024)
		c.Read(b)
		c.Write([]byte("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n"))
	})
	res = Result{}
	probeTCP(ctx, plainHTTP, "x.example.com", &res)
	if res.K != "http" || res.Banner != "HTTP/1.1 400 Bad Request" {
		t.Errorf("http: %+v", res)
	}

	hangup := listen(t, func(c net.Conn) {})
	res = Result{}
	probeTCP(ctx, hangup, "", &res)
	if res.K != "closed" {
		t.Errorf("hang up: %+v", res)
	}

	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	closed := netip.MustParseAddrPort(ln.Addr().String())
	ln.Close()
	res = Result{}
	probeTCP(ctx, closed, "", &res)
	if res.K != "refused" {
		t.Errorf("refused: %+v", res)
	}
}

func TestProbeUDP(t *testing.T) {
	cert := selfSigned(t, "game.example.com")
	ln, err := quic.ListenAddr("127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{cert}, NextProtos: []string{"h3"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept(context.Background())
			if err != nil {
				return
			}
			go func() { time.Sleep(time.Second); c.CloseWithError(0, "") }()
		}
	}()
	var res Result
	probeUDP(context.Background(), netip.MustParseAddrPort(ln.Addr().String()), "game.example.com", &res)
	if res.K != "answered" || res.Via != "quic" || res.Detail != "QUIC · TLS 1.3 · ALPN h3" {
		t.Errorf("quic: %+v", res)
	}

	if ok, d := dnsHello.match([]byte{7, 9}, []byte{7, 9, 0x81, 0x05, 0, 1, 0, 0, 0, 0, 0, 0}); !ok || d != "REFUSED" {
		t.Errorf("dns: %v %q", ok, d)
	}
}
