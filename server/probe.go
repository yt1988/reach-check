package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/netip"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/quic-go/quic-go"
)

// What one check found. K, the outcome:
//
//	tcp: banner (the service spoke first: Svc, Banner), tls (a TLS handshake: TLS), tlsfail (the server ended the
//	     handshake with an alert: Err), http (it answered the ClientHello with plain HTTP), answer (with something
//	     else that isn't TLS: Banner), silent (it accepted, then said nothing at all), closed (it accepted, then hung
//	     up without a word), refused, timeout, unreach, other
//	udp: answered (Via, Detail), closed (ICMP port unreachable), silent
//	both: dns (no address), private (no public address: never connected), bad (not a host:port), limit (Which, Retry)
type Result struct {
	Host   string   `json:"host,omitempty"`
	Port   int      `json:"port,omitempty"`
	Mode   string   `json:"mode,omitempty"`
	K      string   `json:"k"`
	Addrs  []Addr   `json:"addrs,omitempty"` // what DNS gave (or the IP typed), each with its kind
	IP     string   `json:"ip,omitempty"`    // the one connected to
	TCP    *int     `json:"tcp,omitempty"`   // ms to connect
	TLSMs  *int     `json:"tlsMs,omitempty"` // ms for the TLS handshake
	Svc    string   `json:"svc,omitempty"`   // ssh, smtp, ftp, pop3, imap, mysql, redis, vnc, http, telnet, rsync…
	Banner string   `json:"banner,omitempty"`
	TLS    *TLSInfo `json:"tls,omitempty"`
	Via    string   `json:"via,omitempty"` // udp: quic, dns, raknet, a2s, or "" for an answer we don't know
	Detail string   `json:"detail,omitempty"`
	MS     *int     `json:"ms,omitempty"` // udp: ms to the answer
	Err    string   `json:"err,omitempty"`
	Which  string   `json:"which,omitempty"` // limit: visitor, targets, dest, site, busy
	Retry  int      `json:"retry,omitempty"` // limit: seconds until it may be asked again
	Cached bool     `json:"cached,omitempty"`
}

type Addr struct {
	IP   string `json:"ip"`
	Kind string `json:"kind"`
}

type TLSInfo struct {
	Version string `json:"version"`
	ALPN    string `json:"alpn,omitempty"`
	Cipher  string `json:"cipher"`
	// OK: the chain the server sent leads to a root browsers trust, for this name, and is in date.
	// Otherwise Problem: chain (an intermediate is missing), self (self-signed), untrusted, name, expired, invalid
	OK      bool     `json:"ok"`
	Problem string   `json:"problem,omitempty"`
	Err     string   `json:"err,omitempty"`
	Names   []string `json:"names,omitempty"` // the certificate's names (at most 10)
	Chain   []Cert   `json:"chain"`
}

type Cert struct {
	Subject string `json:"subject"`
	Issuer  string `json:"issuer"`
	Until   string `json:"until"`
}

const (
	dialTimeout = 5 * time.Second
	bannerWait  = 2 * time.Second
	tlsTimeout  = 5 * time.Second
	bannerMax   = 512
	shownMax    = 160
	udpWait     = 1500 * time.Millisecond
	quicWait    = 3 * time.Second
)

func ms(d time.Duration) *int { n := int(d.Milliseconds()); return &n }

func dialErr(err error) string {
	var ne net.Error
	switch {
	case errors.Is(err, syscall.ECONNREFUSED):
		return "refused"
	case errors.Is(err, syscall.EHOSTUNREACH), errors.Is(err, syscall.ENETUNREACH):
		return "unreach"
	case errors.Is(err, syscall.ECONNRESET):
		return "closed"
	case errors.Is(err, os.ErrDeadlineExceeded), errors.Is(err, context.DeadlineExceeded), errors.As(err, &ne) && ne.Timeout():
		return "timeout"
	case strings.Contains(err.Error(), "refused"): // other systems' error numbers (tests on Windows)
		return "refused"
	}
	return "other"
}

func probeTCP(ctx context.Context, ap netip.AddrPort, sni string, res *Result) {
	d := net.Dialer{Timeout: dialTimeout}
	t0 := time.Now()
	conn, err := d.DialContext(ctx, "tcp", ap.String())
	if err != nil {
		res.K = dialErr(err)
		return
	}
	defer conn.Close()
	res.TCP = ms(time.Since(t0))

	// Many services speak first: read what they say, and that's all
	buf := make([]byte, bannerMax)
	conn.SetReadDeadline(time.Now().Add(bannerWait))
	n, err := io.ReadAtLeast(conn, buf, 1)
	if n > 0 {
		conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond)) // the rest of the greeting, if it's on its way
		m, _ := io.ReadAtLeast(conn, buf[n:], 1)
		res.K = "banner"
		res.Svc, res.Banner = identify(buf[:n+m])
		return
	}
	if !errors.Is(err, os.ErrDeadlineExceeded) {
		res.K = "closed"
		return
	}

	// Silent: it waits for the client. Offer TLS, the one hello many such services answer
	conn.SetReadDeadline(time.Time{})
	rec := &recConn{Conn: conn}
	cfg := &tls.Config{ServerName: sni, InsecureSkipVerify: true, NextProtos: []string{"h2", "http/1.1"}, MinVersion: tls.VersionTLS10}
	tc := tls.Client(rec, cfg)
	hctx, cancel := context.WithTimeout(ctx, tlsTimeout)
	defer cancel()
	t1 := time.Now()
	err = tc.HandshakeContext(hctx)
	if err == nil {
		res.TLSMs = ms(time.Since(t1))
		res.K = "tls"
		res.TLS = tlsInfo(tc.ConnectionState(), sni, ap.Addr())
		tc.Close()
		return
	}
	var rh tls.RecordHeaderError
	var alert tls.AlertError
	switch {
	case errors.As(err, &rh):
		// not TLS: what it said instead (a plain HTTP server answers "HTTP/1.1 400"), as much as arrives in a moment
		conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
		for rec.b.Len() < bannerMax {
			if m, err := conn.Read(buf); err != nil {
				break
			} else {
				rec.b.Write(buf[:m])
			}
		}
		res.Svc, res.Banner = identify(rec.b.Bytes())
		res.K = "answer"
		if res.Svc == "http" {
			res.K = "http"
		}
	case errors.As(err, &alert):
		res.K, res.Err = "tlsfail", alert.Error()
	case errors.Is(err, os.ErrDeadlineExceeded), errors.Is(err, context.DeadlineExceeded):
		res.K = "silent"
	default:
		var ne net.Error
		if errors.As(err, &ne) && ne.Timeout() {
			res.K = "silent"
		} else if strings.Contains(err.Error(), "remote error") {
			res.K, res.Err = "tlsfail", strings.TrimPrefix(err.Error(), "remote error: ")
		} else {
			res.K = "closed"
		}
	}
}

// recConn keeps the first bytes the server sends, for when they turn out not to be TLS
type recConn struct {
	net.Conn
	b bytes.Buffer
}

func (c *recConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	if c.b.Len() < bannerMax {
		c.b.Write(p[:n])
	}
	return n, err
}

func tlsInfo(st tls.ConnectionState, sni string, ip netip.Addr) *TLSInfo {
	t := &TLSInfo{Version: tls.VersionName(st.Version), ALPN: st.NegotiatedProtocol, Cipher: tls.CipherSuiteName(st.CipherSuite)}
	certs := st.PeerCertificates
	for i, c := range certs {
		if i == 5 {
			break
		}
		t.Chain = append(t.Chain, Cert{Subject: certName(c.Subject.CommonName, c.Subject.Organization, c.DNSNames), Issuer: certName(c.Issuer.CommonName, c.Issuer.Organization, nil), Until: c.NotAfter.UTC().Format("2006-01-02")})
	}
	if len(certs) == 0 {
		t.Problem = "invalid"
		return t
	}
	leaf := certs[0]
	for _, n := range leaf.DNSNames {
		if len(t.Names) == 10 {
			break
		}
		t.Names = append(t.Names, n)
	}
	for _, a := range leaf.IPAddresses {
		if len(t.Names) < 10 {
			t.Names = append(t.Names, a.String())
		}
	}
	inter := x509.NewCertPool()
	for _, c := range certs[1:] {
		inter.AddCert(c)
	}
	name := sni
	if name == "" {
		name = ip.String()
	}
	_, err := leaf.Verify(x509.VerifyOptions{DNSName: name, Intermediates: inter})
	if err == nil {
		t.OK = true
		return t
	}
	t.Err = err.Error()
	var ua x509.UnknownAuthorityError
	var he x509.HostnameError
	var ci x509.CertificateInvalidError
	// signed by its own key (not CheckSignatureFrom: that also wants the certificate to be a CA, and many self-signed ones aren't)
	selfSigned := bytes.Equal(leaf.RawIssuer, leaf.RawSubject) && leaf.CheckSignature(leaf.SignatureAlgorithm, leaf.RawTBSCertificate, leaf.Signature) == nil
	switch {
	case errors.As(err, &he):
		t.Problem = "name"
	case errors.As(err, &ci) && ci.Reason == x509.Expired:
		t.Problem = "expired"
	case errors.As(err, &ua) && selfSigned:
		t.Problem = "self"
	case errors.As(err, &ua) && len(certs) == 1:
		t.Problem = "chain"
	case errors.As(err, &ua):
		t.Problem = "untrusted"
	default:
		t.Problem = "invalid"
	}
	return t
}

func certName(cn string, org []string, sans []string) string {
	switch {
	case cn != "":
		return clean([]byte(cn), 80)
	case len(sans) > 0:
		return clean([]byte(sans[0]), 80)
	case len(org) > 0:
		return clean([]byte(org[0]), 80)
	}
	return "?"
}

// clean: the first line, printable ASCII only, at most max characters
func clean(b []byte, max int) string {
	var sb strings.Builder
	for _, c := range b {
		if c == '\r' || c == '\n' || sb.Len() >= max {
			break
		}
		if c < 0x20 || c > 0x7e {
			c = '.'
		}
		sb.WriteByte(c)
	}
	return strings.TrimSpace(sb.String())
}

// identify: which service a greeting comes from, and the line to show
func identify(b []byte) (string, string) {
	s := string(b)
	up := strings.ToUpper(clean(b, 200))
	switch {
	case strings.HasPrefix(s, "SSH-"):
		return "ssh", clean(b, shownMax)
	case strings.HasPrefix(s, "HTTP/"):
		return "http", clean(b, shownMax)
	case strings.HasPrefix(s, "220") && strings.Contains(up, "FTP"):
		return "ftp", clean(b, shownMax)
	case strings.HasPrefix(s, "220") && (strings.Contains(up, "SMTP") || strings.Contains(up, "MAIL")):
		return "smtp", clean(b, shownMax)
	case strings.HasPrefix(s, "220"):
		return "", clean(b, shownMax)
	case strings.HasPrefix(s, "+OK"):
		return "pop3", clean(b, shownMax)
	case strings.HasPrefix(s, "* OK"), strings.HasPrefix(s, "* PREAUTH"):
		return "imap", clean(b, shownMax)
	case strings.HasPrefix(s, "RFB "):
		return "vnc", clean(b, shownMax)
	case strings.HasPrefix(s, "@RSYNCD:"):
		return "rsync", clean(b, shownMax)
	case strings.HasPrefix(s, "-ERR"), strings.HasPrefix(s, "-NOAUTH"), strings.HasPrefix(s, "-DENIED"):
		return "redis", clean(b, shownMax)
	case strings.HasPrefix(s, "AMQP"):
		return "amqp", "AMQP"
	case len(b) > 5 && b[3] == 0 && b[4] == 0x0a && bytes.IndexByte(b[5:], 0) > 0 && bytes.IndexByte(b[5:], 0) < 60:
		// MySQL's greeting: 3-byte length, sequence 0, protocol 10, the server's version up to a NUL
		v := b[5 : 5+bytes.IndexByte(b[5:], 0)]
		name := "MySQL"
		if bytes.Contains(v, []byte("MariaDB")) {
			name = "MariaDB"
		}
		return "mysql", name + " " + clean(v, 60)
	case len(b) > 1 && b[0] == 0xff && b[1] >= 0xfb:
		return "telnet", ""
	}
	return "", clean(b, shownMax)
}

// ---------- UDP ----------

// a hello to send to a UDP port, and how to tell its answer
type udpHello struct {
	via   string
	pkt   func() []byte
	match func(sent, got []byte) (bool, string)
}

// quic: a real QUIC handshake (ALPN h3, the name as SNI). Version negotiation alone isn't enough: big QUIC servers
// (Cloudflare) ignore a version they don't speak. Any QUIC answer counts, a refusal of the handshake included.
var quicHello = udpHello{via: "quic"}

func quicHandshake(ctx context.Context, ap netip.AddrPort, sni string) (bool, string) {
	ctx, cancel := context.WithTimeout(ctx, quicWait)
	defer cancel()
	tc := &tls.Config{ServerName: sni, InsecureSkipVerify: true, NextProtos: []string{"h3"}}
	c, err := quic.DialAddr(ctx, ap.String(), tc, &quic.Config{HandshakeIdleTimeout: quicWait})
	if err == nil {
		st := c.ConnectionState().TLS
		c.CloseWithError(0, "")
		return true, "QUIC · " + tls.VersionName(st.Version) + " · ALPN " + st.NegotiatedProtocol
	}
	var te *quic.TransportError
	var ae *quic.ApplicationError
	var vn *quic.VersionNegotiationError
	switch {
	case errors.As(err, &te) && te.Remote, errors.As(err, &ae) && ae.Remote:
		return true, clean([]byte(err.Error()), shownMax)
	case errors.As(err, &vn):
		return true, clean([]byte(vn.Error()), shownMax)
	}
	return false, ""
}

var dnsHello = udpHello{"dns", func() []byte {
	p := []byte{0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1} // ". NS IN", no recursion asked
	rand.Read(p[:2])
	return p
}, func(sent, got []byte) (bool, string) {
	if len(got) < 12 || got[0] != sent[0] || got[1] != sent[1] || got[2]&0x80 == 0 {
		return false, ""
	}
	codes := []string{"NOERROR", "FORMERR", "SERVFAIL", "NXDOMAIN", "NOTIMP", "REFUSED"}
	if rc := int(got[3] & 0x0f); rc < len(codes) {
		return true, codes[rc]
	}
	return true, ""
}}

var raknetMagic = []byte{0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe, 0xfd, 0xfd, 0xfd, 0xfd, 0x12, 0x34, 0x56, 0x78}

var raknetHello = udpHello{"raknet", func() []byte { // Minecraft Bedrock's "unconnected ping"
	p := make([]byte, 33)
	p[0] = 0x01
	binary.BigEndian.PutUint64(p[1:], uint64(time.Now().UnixMilli()))
	copy(p[9:], raknetMagic)
	rand.Read(p[25:])
	return p
}, func(sent, got []byte) (bool, string) {
	if len(got) < 35 || got[0] != 0x1c || !bytes.Equal(got[17:33], raknetMagic) {
		return false, ""
	}
	f := strings.Split(clean(got[35:], 200), ";") // MCPE;motd;protocol;version;…
	switch {
	case len(f) > 3 && f[0] == "MCPE":
		return true, "Minecraft Bedrock " + f[3]
	case len(f) > 3 && f[0] == "MCEE":
		return true, "Minecraft Education " + f[3]
	}
	return true, "RakNet"
}}

var a2sHello = udpHello{"a2s", func() []byte { // Steam / Source "A2S_INFO"
	return append([]byte{0xff, 0xff, 0xff, 0xff, 0x54}, "Source Engine Query\x00"...)
}, func(sent, got []byte) (bool, string) {
	if len(got) < 5 || !bytes.Equal(got[:4], []byte{0xff, 0xff, 0xff, 0xff}) || (got[4] != 0x41 && got[4] != 0x49) {
		return false, ""
	}
	if got[4] == 0x49 && len(got) > 6 { // header, protocol, then name, map, folder, game
		f := bytes.SplitN(got[6:], []byte{0}, 5)
		if len(f) > 3 {
			return true, clean(f[3], 60)
		}
	}
	return true, ""
}}

// hellos: which to send, in order, for a port
func hellos(port uint16) []udpHello {
	switch {
	case port == 53:
		return []udpHello{dnsHello}
	case port == 19132 || port == 19133:
		return []udpHello{raknetHello, quicHello, a2sHello}
	case port >= 27015 && port <= 27020:
		return []udpHello{a2sHello, quicHello, raknetHello}
	}
	return []udpHello{quicHello, raknetHello, a2sHello}
}

func probeUDP(ctx context.Context, ap netip.AddrPort, sni string, res *Result) {
	conn, err := net.DialUDP("udp", nil, net.UDPAddrFromAddrPort(ap))
	if err != nil {
		res.K = dialErr(err)
		return
	}
	defer conn.Close()
	buf := make([]byte, 2048)
	for _, h := range hellos(ap.Port()) {
		if ctx.Err() != nil {
			break
		}
		t0 := time.Now()
		if h.via == "quic" {
			if ok, detail := quicHandshake(ctx, ap, sni); ok {
				res.K, res.Via, res.Detail, res.MS = "answered", "quic", detail, ms(time.Since(t0))
				return
			}
			continue
		}
		pkt := h.pkt()
		if _, err := conn.Write(pkt); err != nil {
			if errors.Is(err, syscall.ECONNREFUSED) {
				res.K = "closed"
				return
			}
			res.K = dialErr(err)
			return
		}
		conn.SetReadDeadline(t0.Add(udpWait))
		for {
			n, err := conn.Read(buf)
			if errors.Is(err, syscall.ECONNREFUSED) { // ICMP port unreachable: the host is there, the port is closed
				res.K = "closed"
				return
			}
			if err != nil {
				break // nothing within udpWait: try the next hello
			}
			if ok, detail := h.match(pkt, buf[:n]); ok {
				res.K, res.Via, res.Detail, res.MS = "answered", h.via, detail, ms(time.Since(t0))
				return
			}
			// an answer to something else (or to another hello late): something listens, whatever it is
			res.K, res.MS, res.Detail = "answered", ms(time.Since(t0)), clean(buf[:n], 60)
			return
		}
	}
	res.K = "silent"
}
