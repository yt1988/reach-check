// Endpoint auth (1ms.dog docs/tool-contract.md, "端点鉴权"): when MS_AUTH_SECRET is set, every request except
// /healthz must carry `Authorization: Bearer v1.<exp>.<nonce>.<hmac>`, where the HMAC-SHA256 covers
// `v1|exp|nonce|scope` and the scope names `reach`. Unset means no check, which is the self-hosted default and
// the rollout switch; this is in addition to the per-visitor limits, never instead of them.
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"strconv"
	"strings"
	"time"
)

// The page token names every endpoint it may use; a service token may name "*". A token signed for another
// endpoint (say ping) does not verify here.
var authScopes = []string{"reach", "*", "probe,reach,ping,rtc,ipv6,seg,dns,data"}

func authSecret() string { return os.Getenv("MS_AUTH_SECRET") }

// checkAuth returns ("", true) when the request may pass, or the 401 reason when it may not.
func checkAuth(secret, header string, now time.Time) (code string, ok bool) {
	if secret == "" {
		return "", true
	}
	h := strings.TrimSpace(header)
	if !strings.HasPrefix(h, "Bearer ") {
		return "no_token", false
	}
	tok := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	parts := strings.Split(tok, ".")
	if len(parts) != 4 || parts[0] != "v1" || parts[2] == "" {
		return "bad_token", false
	}
	exp, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || now.Unix() >= exp {
		return "bad_token", false
	}
	got, err := hex.DecodeString(parts[3])
	if err != nil {
		return "bad_token", false
	}
	for _, scope := range authScopes {
		m := hmac.New(sha256.New, []byte(secret))
		m.Write([]byte("v1|" + parts[1] + "|" + parts[2] + "|" + scope))
		if hmac.Equal(got, m.Sum(nil)) {
			return "", true
		}
	}
	return "bad_token", false
}
