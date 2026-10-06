package platform

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type rate struct {
	n     int
	reset time.Time
}

func Protect(next http.Handler, origins []string) http.Handler {
	allowed := map[string]bool{}
	for _, s := range origins {
		allowed[strings.TrimRight(strings.TrimSpace(s), "/")] = true
	}
	var mu sync.Mutex
	rates := map[string]rate{}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Vary", "Origin")
		b := make([]byte, 12)
		rand.Read(b)
		w.Header().Set("X-Request-ID", hex.EncodeToString(b))
		if origin := r.Header.Get("Origin"); origin != "" {
			if !allowed[strings.TrimRight(origin, "/")] {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(403)
				json.NewEncoder(w).Encode(map[string]string{"code": "origin-not-allowed", "message": "Origin is not allowed."})
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		}
		if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" && r.Header.Get("Authorization") == "" {
			if cookie, err := r.Cookie("ludex_session"); err == nil && cookie.Value != "" && r.Header.Get("Origin") == "" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(403)
				json.NewEncoder(w).Encode(map[string]string{"code": "csrf-origin-required", "message": "A trusted origin is required for browser writes."})
				return
			}
		}
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		key, _, hostErr := net.SplitHostPort(r.RemoteAddr)
		if hostErr != nil {
			key = r.RemoteAddr
		}
		now := time.Now()
		mu.Lock()
		v := rates[key]
		if now.After(v.reset) {
			v = rate{reset: now.Add(time.Minute)}
		}
		v.n++
		rates[key] = v
		if len(rates) > 10000 {
			for k, x := range rates {
				if now.After(x.reset) {
					delete(rates, k)
				}
			}
		}
		mu.Unlock()
		if v.n > 500 {
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(429)
			json.NewEncoder(w).Encode(map[string]string{"code": "rate-limited", "message": "Please wait before trying again."})
			return
		}
		next.ServeHTTP(w, r)
	})
}
