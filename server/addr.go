package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"net"
	"net/netip"
	"sync/atomic"
	"time"
)

// Names are looked up at public resolvers, never the machine's own (the cloud network's resolver answers names
// that only exist inside it). The address that was checked is the one connected to, so a name can't change its
// answer in between (DNS rebinding).
var resolvers = []string{"1.1.1.1:53", "8.8.8.8:53", "9.9.9.9:53"}
var next atomic.Uint32

var resolver = &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
	d := net.Dialer{Timeout: 2 * time.Second}
	return d.DialContext(ctx, network, resolvers[next.Add(1)%uint32(len(resolvers))])
}}

func resolve(ctx context.Context, host, ipv string) ([]netip.Addr, error) {
	if a, err := netip.ParseAddr(host); err == nil {
		return []netip.Addr{a.Unmap()}, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	network := map[string]string{"4": "ip4", "6": "ip6"}[ipv]
	if network == "" {
		network = "ip"
	}
	as, err := resolver.LookupNetIP(ctx, network, host)
	if len(as) > 8 {
		as = as[:8]
	}
	for i := range as {
		as[i] = as[i].Unmap()
	}
	return as, err
}

// Every range that isn't a public unicast address on the internet, by what the page tells the visitor about it
var ranges = []struct {
	p    netip.Prefix
	kind string
}{
	{pfx("10.0.0.0/8"), "private"}, {pfx("172.16.0.0/12"), "private"}, {pfx("192.168.0.0/16"), "private"},
	{pfx("127.0.0.0/8"), "private"}, {pfx("169.254.0.0/16"), "private"}, {pfx("fc00::/7"), "private"},
	{pfx("fe80::/10"), "private"}, {pfx("::1/128"), "private"},
	{pfx("100.64.0.0/10"), "cgnat"},
	{pfx("198.18.0.0/15"), "fakeip"},
	{pfx("0.0.0.0/8"), "reserved"}, {pfx("192.0.0.0/24"), "reserved"}, {pfx("192.0.2.0/24"), "reserved"},
	{pfx("192.88.99.0/24"), "reserved"}, {pfx("198.51.100.0/24"), "reserved"}, {pfx("203.0.113.0/24"), "reserved"},
	{pfx("224.0.0.0/4"), "reserved"}, {pfx("240.0.0.0/4"), "reserved"},
	{pfx("::/96"), "reserved"}, {pfx("::ffff:0:0/96"), "reserved"}, {pfx("64:ff9b::/96"), "reserved"},
	{pfx("64:ff9b:1::/48"), "reserved"}, {pfx("100::/64"), "reserved"}, {pfx("2001::/23"), "reserved"},
	{pfx("2001:db8::/32"), "reserved"}, {pfx("2002::/16"), "reserved"}, {pfx("3fff::/20"), "reserved"},
	{pfx("5f00::/16"), "reserved"}, {pfx("fec0::/10"), "reserved"}, {pfx("ff00::/8"), "reserved"},
}

func pfx(s string) netip.Prefix { return netip.MustParsePrefix(s) }

// This machine's own addresses (its interfaces, and its public IPv4 behind the cloud's NAT): never probed
var selfAddrs = map[netip.Addr]bool{}

// public, private, cgnat, fakeip, reserved or self; only public ones are ever connected to
func addrKind(a netip.Addr) string {
	a = a.Unmap()
	if selfAddrs[a] {
		return "self"
	}
	for _, r := range ranges {
		if r.p.Contains(a) {
			return r.kind
		}
	}
	if a.Is6() && !pfx("2000::/3").Contains(a) {
		return "reserved" // only 2000::/3 is handed out as global unicast
	}
	return "public"
}

// A visitor, for the counters: a keyed hash of their IP (an IPv6 address by its /64, which one subscriber gets);
// the key is made at start and never leaves memory, so the hashes can't be turned back into addresses
var visitorSecret = func() []byte { b := make([]byte, 32); rand.Read(b); return b }()

func visitorKey(remote string) uint64 {
	ap, err := netip.ParseAddrPort(remote)
	if err != nil {
		return 0
	}
	a := ap.Addr().Unmap()
	if a.Is6() {
		a = netip.PrefixFrom(a, 64).Masked().Addr()
	}
	m := hmac.New(sha256.New, visitorSecret)
	m.Write(a.AsSlice())
	return binary.BigEndian.Uint64(m.Sum(nil))
}
