package platform

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORSProtectsAllMountedModules(t *testing.T) {
	called := false
	h := Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(200) }), []string{"http://localhost:3001"})
	req := httptest.NewRequest("POST", "/api/assistant/messages", nil)
	req.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if called || w.Code != 403 {
		t.Fatal("mounted AI handler bypassed origin protection")
	}
}
func TestPreflightAllowsAuthorization(t *testing.T) {
	h := Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Fatal("preflight should not reach auth") }), []string{"http://localhost:3001"})
	req := httptest.NewRequest("OPTIONS", "/api/assistant/messages", nil)
	req.Header.Set("Origin", "http://localhost:3001")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") == "" {
		t.Fatal("preflight failed")
	}
}

func TestCookieWritesRequireTrustedOrigin(t *testing.T) {
	h := Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Fatal("untrusted cookie write reached handler") }), []string{"http://localhost:3001"})
	r := httptest.NewRequest("POST", "/api/assistant/messages", nil)
	r.AddCookie(&http.Cookie{Name: "ludex_session", Value: "test"})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cookie request without CSRF origin accepted")
	}
}
