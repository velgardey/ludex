package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProductModulesAndAssistantAliases(t *testing.T) {
	echo := func(label string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Module", label)
			w.Header().Set("X-Path", r.URL.Path)
		})
	}
	router := productRouter(echo("core"), echo("assistant"), echo("connections"), echo("plans"))
	for _, tc := range []struct{ url, module, path string }{
		{"/api/assistant/state", "assistant", "/state"},
		{"/api/v1/assistant/messages", "assistant", "/messages"},
		{"/api/imports/jobs/one", "connections", "/api/imports/jobs/one"},
		{"/api/v1/plans/one/discussion", "plans", "/api/v1/plans/one/discussion"},
		{"/api/auth/google/native/start", "core", "/api/auth/google/native/start"},
	} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", tc.url, nil))
		if w.Header().Get("X-Module") != tc.module || w.Header().Get("X-Path") != tc.path {
			t.Errorf("%s dispatch %s %s", tc.url, w.Header().Get("X-Module"), w.Header().Get("X-Path"))
		}
	}
}
