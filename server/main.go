// 1ms-reach: Reach Check's server, at https://reach-api.1ms.dog:2096 (one machine, in Tokyo).
//
// For the one host:port a visitor asks about, it connects once and says what it found:
//   - TCP: what the service says first (SSH, SMTP, FTP… banners); for a service that waits, the TLS handshake
//     (version, ALPN, the certificate chain and why it isn't trusted) or what it answered instead (plain HTTP…).
//     Nothing is sent but the TLS ClientHello: no request, no payload.
//   - UDP: whether the port answers a standard hello (a QUIC handshake, a DNS query, a Minecraft Bedrock or Steam
//     server ping), says it's closed (ICMP port unreachable), or stays silent.
//
// It is reachable directly (DNS only, no proxy in front), so its own limits are the only guard against being used to
// scan others: one host:port per request, never a private, reserved or own address, a few checks per visitor and per
// target address an hour, a cap for the whole site, and a short cache so repeats don't reach the target again.
// It keeps nothing: no access log, and the counters (visitors as a keyed hash of their IP) live in memory for an hour.
//
//	GET /v1/probe?host=nas.example.com&port=22[&mode=udp][&ipv=4|6]  → JSON (see Result)
//	GET /healthz                                                       → "ok"
package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func main() {
	cred := os.Getenv("CREDENTIALS_DIRECTORY") // systemd LoadCredential=
	addr := flag.String("addr", ":2096", "listen address")
	cert := flag.String("cert", filepath.Join(cred, "fullchain.pem"), "certificate chain (PEM)")
	key := flag.String("key", filepath.Join(cred, "privkey.pem"), "private key (PEM)")
	plain := flag.Bool("plain", false, "serve plain HTTP (local testing only)")
	self := flag.String("self", "", "this machine's public addresses behind NAT, comma separated: never probed")
	flag.Parse()
	log.SetFlags(0)

	for _, s := range strings.Split(*self, ",") {
		if a, err := netip.ParseAddr(strings.TrimSpace(s)); err == nil {
			selfAddrs[a.Unmap()] = true
		}
	}
	if ifs, err := net.InterfaceAddrs(); err == nil {
		for _, a := range ifs {
			if p, err := netip.ParsePrefix(a.String()); err == nil {
				selfAddrs[p.Addr().Unmap()] = true
			}
		}
	}

	srv := &http.Server{
		Addr: *addr, Handler: handler(newLimits(time.Now)),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
		MaxHeaderBytes: 8 << 10,
		ErrorLog:       log.New(discard{}, "", 0), // TLS handshake noise from scanners is not worth a log line
	}
	if *plain {
		log.Fatal(srv.ListenAndServe())
	}
	srv.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	log.Fatal(srv.ListenAndServeTLS(*cert, *key))
}

type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }

// The page that may read the answers from a visitor's browser; anything else gets them without CORS headers
func allowedOrigin(o string) bool {
	if o == "https://reach.1ms.dog" {
		return true
	}
	u := strings.TrimPrefix(o, "http://")
	h, _, _ := strings.Cut(u, ":")
	return u != o && (h == "localhost" || h == "127.0.0.1")
}

func handler(lim *limits) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok\n")) })
	mux.HandleFunc("GET /v1/probe", func(w http.ResponseWriter, r *http.Request) {
		if o := r.Header.Get("Origin"); allowedOrigin(o) {
			w.Header().Set("Access-Control-Allow-Origin", o)
		}
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		res, status := serveProbe(r, lim)
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(res)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) })
	return mux
}

func serveProbe(r *http.Request, lim *limits) (*Result, int) {
	q := r.URL.Query()
	host := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(q.Get("host"))), ".")
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	port, err := strconv.Atoi(q.Get("port"))
	mode := q.Get("mode")
	if mode == "" {
		mode = "tcp"
	}
	ipv := q.Get("ipv")
	if err != nil || port < 1 || port > 65535 || !validHost(host) || (mode != "tcp" && mode != "udp") || (ipv != "" && ipv != "4" && ipv != "6") {
		return &Result{K: "bad"}, http.StatusBadRequest
	}
	res := &Result{Host: host, Port: port, Mode: mode}

	visitor := visitorKey(r.RemoteAddr)
	target := mode + "|" + host + "|" + strconv.Itoa(port) + "|" + ipv
	if which, retry := lim.visit(visitor, target); which != "" {
		return &Result{Host: host, Port: port, Mode: mode, K: "limit", Which: which, Retry: retry}, http.StatusTooManyRequests
	}
	if c := lim.cached(target); c != nil {
		cp := *c
		cp.Cached = true
		return &cp, http.StatusOK
	}
	if !lim.enter(visitor) {
		return &Result{Host: host, Port: port, Mode: mode, K: "limit", Which: "busy", Retry: 5}, http.StatusTooManyRequests
	}
	defer lim.leave(visitor)

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	addrs, err := resolve(ctx, host, ipv)
	if err != nil || len(addrs) == 0 {
		res.K = "dns"
		lim.store(target, res)
		return res, http.StatusOK
	}
	var dial netip.Addr
	for _, a := range addrs {
		k := addrKind(a)
		res.Addrs = append(res.Addrs, Addr{IP: a.String(), Kind: k})
		if k == "public" && !dial.IsValid() {
			dial = a
		}
	}
	if !dial.IsValid() {
		res.K = "private" // never connects: the page explains that nobody outside can reach such an address
		lim.store(target, res)
		return res, http.StatusOK
	}
	if which, retry := lim.dest(dial); which != "" {
		return &Result{Host: host, Port: port, Mode: mode, K: "limit", Which: which, Retry: retry}, http.StatusTooManyRequests
	}
	res.IP = dial.String()
	sni := ""
	if _, err := netip.ParseAddr(host); err != nil {
		sni = host
	}
	if mode == "udp" {
		probeUDP(ctx, netip.AddrPortFrom(dial, uint16(port)), sni, res)
	} else {
		probeTCP(ctx, netip.AddrPortFrom(dial, uint16(port)), sni, res)
	}
	if ctx.Err() != nil && errors.Is(r.Context().Err(), context.Canceled) {
		return res, http.StatusOK // the visitor left: don't cache a cut-short answer
	}
	lim.store(target, res)
	return res, http.StatusOK
}

// A domain name (letters, digits, hyphens, at least two labels) or an IP address; never a local name
func validHost(h string) bool {
	if a, err := netip.ParseAddr(h); err == nil {
		return a.Zone() == ""
	}
	if len(h) > 253 || !strings.Contains(h, ".") || h == "localhost" || strings.HasSuffix(h, ".localhost") {
		return false
	}
	for _, l := range strings.Split(h, ".") {
		if l == "" || len(l) > 63 || l[0] == '-' || l[len(l)-1] == '-' {
			return false
		}
		for _, c := range l {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
				return false
			}
		}
	}
	return true
}
