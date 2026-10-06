package catalog

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestShowTitleLoadsOrderedEpisodeEvidenceAndOmitsUnknownAirDate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/3/tv/42":
			w.Write([]byte(`{"id":42,"name":"Fixture series","first_air_date":"2020-01-01","status":"Ended","seasons":[{"season_number":0},{"season_number":1}]}`))
		case "/3/tv/42/season/1":
			w.Write([]byte(`{"episodes":[{"id":91,"name":"Opening","episode_number":1,"air_date":"2020-01-01"},{"id":92,"name":"Unknown","episode_number":2,"air_date":null}]}`))
		default:
			t.Errorf("unexpected %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	hit, e := New(Config{TMDBToken: "fixture", TMDBBaseURL: server.URL + "/3"}).Title(context.Background(), "tmdb:show:42")
	if e != nil {
		t.Fatal(e)
	}
	if len(hit.Episodes) != 2 || hit.Episodes[0].ID != "tmdb:episode:91" || hit.Episodes[0].Order != 1 || hit.Episodes[1].ReleasedAt != "" {
		t.Fatalf("episodes %#v", hit.Episodes)
	}
}
