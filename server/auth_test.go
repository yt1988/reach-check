package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func token(secret, scope string, exp int64) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte("v1|" + itoa(exp) + "|n0nce|" + scope))
	return "v1." + itoa(exp) + ".n0nce." + hex.EncodeToString(m.Sum(nil))
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

func TestCheckAuth(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	future, past := now.Unix()+300, now.Unix()-1
	cases := []struct {
		name   string
		secret string
		header string
		wantOK bool
		want   string
	}{
		{"no secret lets everything through", "", "", true, ""},
		{"secret, no header", "s3cret", "", false, "no_token"},
		{"secret, wrong scheme", "s3cret", "Basic abc", false, "no_token"},
		{"expired", "s3cret", "Bearer " + token("s3cret", "reach", past), false, "bad_token"},
		{"wrong scope", "s3cret", "Bearer " + token("s3cret", "ping", future), false, "bad_token"},
		{"wrong secret", "s3cret", "Bearer " + token("other", "reach", future), false, "bad_token"},
		{"reach scope", "s3cret", "Bearer " + token("s3cret", "reach", future), true, ""},
		{"page token (all scopes)", "s3cret", "Bearer " + token("s3cret", "probe,reach,ping,rtc,ipv6,seg,dns,data", future), true, ""},
		{"service token", "s3cret", "Bearer " + token("s3cret", "*", future), true, ""},
		{"garbage", "s3cret", "Bearer v1.x.y.z", false, "bad_token"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			code, ok := checkAuth(c.secret, c.header, now)
			if ok != c.wantOK || code != c.want {
				t.Fatalf("got (%q, %v), want (%q, %v)", code, ok, c.want, c.wantOK)
			}
		})
	}
}

func TestHandlerAuth(t *testing.T) {
	now := time.Now().Unix()
	probe := "/v1/probe?host=127.0.0.1&port=80&ipv=4"

	t.Run("no secret: request passes without a token", func(t *testing.T) {
		t.Setenv("MS_AUTH_SECRET", "")
		rr := httptest.NewRecorder()
		handler(newLimits(time.Now)).ServeHTTP(rr, httptest.NewRequest("GET", probe, nil))
		if rr.Code != http.StatusOK {
			t.Fatalf("status %d, want 200 (private address is refused without connecting)", rr.Code)
		}
		if !strings.Contains(rr.Body.String(), `"private"`) {
			t.Fatalf("body %s, want the private answer", rr.Body.String())
		}
	})

	t.Run("secret: no token is 401 no_token, healthz still answers", func(t *testing.T) {
		t.Setenv("MS_AUTH_SECRET", "s3cret")
		h := handler(newLimits(time.Now))
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest("GET", probe, nil))
		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("status %d, want 401", rr.Code)
		}
		var body map[string]string
		json.NewDecoder(rr.Body).Decode(&body)
		if body["error"] != "no_token" {
			t.Fatalf("error %q, want no_token", body["error"])
		}
		rr = httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest("GET", "/healthz", nil))
		if rr.Code != http.StatusOK {
			t.Fatalf("healthz status %d, want 200", rr.Code)
		}
	})

	t.Run("secret: a valid token passes to the probe (limits still apply)", func(t *testing.T) {
		t.Setenv("MS_AUTH_SECRET", "s3cret")
		req := httptest.NewRequest("GET", probe, nil)
		req.Header.Set("Authorization", "Bearer "+token("s3cret", "reach", now+300))
		rr := httptest.NewRecorder()
		handler(newLimits(time.Now)).ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("status %d, want 200", rr.Code)
		}
	})
}
