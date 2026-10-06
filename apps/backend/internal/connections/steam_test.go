package connections

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSteamOwnedGamesPrivacyBoundary(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"response":{}}`))
	}))
	defer s.Close()
	c := SteamClient{Key: "test", BaseURL: s.URL, HTTP: s.Client()}
	_, err := c.OwnedGames(context.Background(), "76561198000000000")
	if err == nil {
		t.Fatal("private/missing library treated as empty successful sync")
	}
}
func TestSteamNormalizesPermittedGameList(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"response":{"game_count":1,"games":[{"appid":570,"name":"Dota 2","playtime_forever":120}]}}`))
	}))
	defer s.Close()
	c := SteamClient{Key: "test", BaseURL: s.URL, HTTP: s.Client()}
	games, err := c.OwnedGames(context.Background(), "76561198000000000")
	if err != nil || len(games) != 1 || games[0].Minutes != 120 {
		t.Fatal("owned library normalization failed")
	}
}
