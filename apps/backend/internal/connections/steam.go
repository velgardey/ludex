package connections

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type SteamGame struct {
	AppID   int    `json:"appid"`
	Name    string `json:"name"`
	Minutes int    `json:"playtime_forever"`
}
type SteamClient struct {
	Key     string
	BaseURL string
	HTTP    *http.Client
}

func (s SteamClient) OwnedGames(ctx context.Context, id string) ([]SteamGame, error) {
	if s.Key == "" {
		return nil, fmt.Errorf("Steam key is not configured")
	}
	if len(id) != 17 || strings.Trim(id, "0123456789") != "" {
		return nil, fmt.Errorf("invalid SteamID64")
	}
	base := s.BaseURL
	if base == "" {
		base = "https://api.steampowered.com"
	}
	u := base + "/IPlayerService/GetOwnedGames/v1/?" + url.Values{"key": {s.Key}, "steamid": {id}, "include_appinfo": {"true"}, "include_played_free_games": {"true"}}.Encode()
	req, e := http.NewRequestWithContext(ctx, "GET", u, nil)
	if e != nil {
		return nil, fmt.Errorf("Steam request unavailable")
	}
	client := s.HTTP
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	res, e := client.Do(req)
	if e != nil {
		return nil, fmt.Errorf("Steam request failed")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("Steam source unavailable")
	}
	var data struct {
		Response struct {
			GameCount *int        `json:"game_count"`
			Games     []SteamGame `json:"games"`
		} `json:"response"`
	}
	if json.NewDecoder(io.LimitReader(res.Body, 4*1024*1024)).Decode(&data) != nil {
		return nil, fmt.Errorf("Steam response invalid")
	}
	if data.Response.GameCount == nil {
		return nil, fmt.Errorf("Steam library unavailable or private")
	}
	if data.Response.Games == nil {
		return []SteamGame{}, nil
	}
	return data.Response.Games, nil
}
