package main

import (
	"net/netip"
	"sync"
	"time"
)

// The limits, all in memory and all per sliding hour unless noted:
const (
	perVisitor    = 10              // checks a visitor may ask for (cached answers included)
	targetsPer    = 5               // different host:port a visitor may ask about
	perDest       = 30              // connections to one address, whoever asks (cached answers don't count)
	sitePerMinute = 60              // connections the whole site makes in a minute
	sitePerHour   = 1000            // … and in an hour
	busyAtOnce    = 16              // connections under way at the same time
	visitorAtOnce = 2               // … for one visitor
	cacheFor      = 5 * time.Minute // a repeat within this gets the same answer, without connecting again
	maxKeys       = 50000           // visitors, addresses or cached answers tracked: past this, new ones wait
	window        = time.Hour
	minute        = time.Minute
	cacheEntries  = 5000
	retryWhenBusy = 5
	sweepEvery    = time.Minute
)

type limits struct {
	mu       sync.Mutex
	now      func() time.Time
	visitors map[uint64]*visitor
	dests    map[netip.Addr][]time.Time
	site     []time.Time
	cache    map[string]cacheEntry
	busy     int
	last     time.Time
}

type visitor struct {
	hits    []time.Time
	targets map[string]time.Time
	busy    int
}

type cacheEntry struct {
	res     Result
	expires time.Time
}

func newLimits(now func() time.Time) *limits {
	return &limits{now: now, visitors: map[uint64]*visitor{}, dests: map[netip.Addr][]time.Time{}, cache: map[string]cacheEntry{}}
}

// recent: the times still inside the window, oldest first
func recent(ts []time.Time, now time.Time, w time.Duration) []time.Time {
	i := 0
	for i < len(ts) && now.Sub(ts[i]) >= w {
		i++
	}
	return ts[i:]
}

// seconds until the oldest of ts leaves the window
func retryAfter(ts []time.Time, now time.Time, w time.Duration) int {
	if len(ts) == 0 {
		return 1
	}
	return int(w-now.Sub(ts[0]))/int(time.Second) + 1
}

func (l *limits) sweep(now time.Time) {
	if now.Sub(l.last) < sweepEvery {
		return
	}
	l.last = now
	for k, v := range l.visitors {
		v.hits = recent(v.hits, now, window)
		for t, at := range v.targets {
			if now.Sub(at) >= window {
				delete(v.targets, t)
			}
		}
		if len(v.hits) == 0 && v.busy == 0 {
			delete(l.visitors, k)
		}
	}
	for a, ts := range l.dests {
		if ts = recent(ts, now, window); len(ts) == 0 {
			delete(l.dests, a)
		} else {
			l.dests[a] = ts
		}
	}
	for k, c := range l.cache {
		if now.After(c.expires) {
			delete(l.cache, k)
		}
	}
}

// visit counts a request; "" when it may go on, else which limit it hit and the seconds until it may try again
func (l *limits) visit(key uint64, target string) (string, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.sweep(now)
	v := l.visitors[key]
	if v == nil {
		if len(l.visitors) >= maxKeys {
			return "busy", retryWhenBusy
		}
		v = &visitor{targets: map[string]time.Time{}}
		l.visitors[key] = v
	}
	v.hits = recent(v.hits, now, window)
	if len(v.hits) >= perVisitor {
		return "visitor", retryAfter(v.hits, now, window)
	}
	if _, seen := v.targets[target]; !seen {
		if len(v.targets) >= targetsPer {
			oldest := now
			for _, at := range v.targets {
				if at.Before(oldest) {
					oldest = at
				}
			}
			return "targets", retryAfter([]time.Time{oldest}, now, window)
		}
		v.targets[target] = now
	}
	v.hits = append(v.hits, now)
	return "", 0
}

func (l *limits) cached(target string) *Result {
	l.mu.Lock()
	defer l.mu.Unlock()
	if c, ok := l.cache[target]; ok && l.now().Before(c.expires) {
		r := c.res
		return &r
	}
	return nil
}

func (l *limits) store(target string, r *Result) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.cache) >= cacheEntries {
		return
	}
	l.cache[target] = cacheEntry{*r, l.now().Add(cacheFor)}
}

// enter: one more check under way, if the site and the visitor have room for it
func (l *limits) enter(key uint64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	v := l.visitors[key]
	if l.busy >= busyAtOnce || v == nil || v.busy >= visitorAtOnce {
		return false
	}
	l.busy++
	v.busy++
	return true
}

func (l *limits) leave(key uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.busy--
	if v := l.visitors[key]; v != nil {
		v.busy--
	}
}

// dest counts a connection to a: "" when it may go ahead, else which limit it hit and the seconds to wait
func (l *limits) dest(a netip.Addr) (string, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.site = recent(l.site, now, window)
	lastMinute := recent(l.site, now, minute)
	if len(lastMinute) >= sitePerMinute {
		return "site", retryAfter(lastMinute, now, minute)
	}
	if len(l.site) >= sitePerHour {
		return "site", retryAfter(l.site, now, window)
	}
	ts := recent(l.dests[a], now, window)
	if len(ts) >= perDest {
		return "dest", retryAfter(ts, now, window)
	}
	if ts == nil && len(l.dests) >= maxKeys {
		return "busy", retryWhenBusy
	}
	l.dests[a] = append(ts, now)
	l.site = append(l.site, now)
	return "", 0
}
