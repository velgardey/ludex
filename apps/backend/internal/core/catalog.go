package core

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (a *App) GetTitle(ctx context.Context, id string) (CatalogHit, error) {
	return a.getTitle(ctx, id)
}

func (a *App) SearchCatalog(ctx context.Context, text, media, region string) ([]CatalogHit, error) {
	if a.cfg.CatalogSearch != nil {
		items, err := a.cfg.CatalogSearch(ctx, text, media, region)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			if err := a.cacheTitle(ctx, item); err != nil {
				return nil, err
			}
		}
		return items, nil
	}
	if a.db == nil {
		return nil, problem(503, "catalog-unavailable")
	}
	rows, err := a.db.Query(ctx, `
		SELECT id,media,title,provider_ids,episodes,body FROM titles
		WHERE ($1 = '' OR title ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR media = $2)
		ORDER BY title LIMIT 50`, strings.TrimSpace(text), media)
	if err != nil {
		return nil, fmt.Errorf("search cached catalog: %w", err)
	}
	defer rows.Close()
	result := make([]CatalogHit, 0)
	for rows.Next() {
		var id, media, title string
		var providerIDs, episodes, raw []byte
		if err := rows.Scan(&id, &media, &title, &providerIDs, &episodes, &raw); err != nil {
			return nil, fmt.Errorf("read cached catalog hit: %w", err)
		}
		item, err := decodeCatalogHit(id, media, title, providerIDs, episodes, raw)
		if err != nil {
			return nil, fmt.Errorf("decode cached catalog hit: %w", err)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cached catalog: %w", err)
	}
	return result, nil
}

func (a *App) getTitle(ctx context.Context, id string) (CatalogHit, error) {
	if strings.TrimSpace(id) == "" {
		return CatalogHit{}, badRequest("title-required")
	}
	if a.cfg.CatalogGet != nil {
		item, err := a.cfg.CatalogGet(ctx, id)
		if err != nil {
			return CatalogHit{}, err
		}
		if item.ID != id {
			return CatalogHit{}, badRequest("catalog-id-mismatch")
		}
		if err := a.cacheTitle(ctx, item); err != nil {
			return CatalogHit{}, err
		}
		return item, nil
	}
	if a.db == nil {
		return CatalogHit{}, problem(503, "catalog-unavailable")
	}
	var media, title string
	var providerIDs, episodes, raw []byte
	err := a.db.QueryRow(ctx, `SELECT media,title,provider_ids,episodes,body FROM titles WHERE id=$1`, id).Scan(&media, &title, &providerIDs, &episodes, &raw)
	if err == pgx.ErrNoRows {
		return CatalogHit{}, notFound("title-not-found")
	}
	if err != nil {
		return CatalogHit{}, fmt.Errorf("load title: %w", err)
	}
	item, err := decodeCatalogHit(id, media, title, providerIDs, episodes, raw)
	if err != nil {
		return CatalogHit{}, fmt.Errorf("decode title: %w", err)
	}
	return item, nil
}

func decodeCatalogHit(id, media, title string, providerIDs, episodes, raw []byte) (CatalogHit, error) {
	var item CatalogHit
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &item); err != nil {
			return CatalogHit{}, err
		}
	}
	if item.ID == "" {
		item.ID = id
	}
	if item.Media == "" {
		item.Media = media
	}
	if item.Title == "" {
		item.Title = title
	}
	if len(item.ProviderIDs) == 0 {
		_ = json.Unmarshal(providerIDs, &item.ProviderIDs)
	}
	if item.ProviderIDs == nil {
		item.ProviderIDs = map[string]string{}
	}
	if len(item.Episodes) == 0 {
		_ = json.Unmarshal(episodes, &item.Episodes)
	}
	if item.Episodes == nil {
		item.Episodes = []Episode{}
	}
	return item, nil
}

func (a *App) cacheTitle(ctx context.Context, item CatalogHit) error {
	if a.db == nil {
		return problem(503, "database-unavailable")
	}
	if item.ID == "" || item.Title == "" || (item.Media != "movie" && item.Media != "show" && item.Media != "game") {
		return badRequest("invalid-catalog-item")
	}
	if item.ProviderIDs == nil {
		item.ProviderIDs = map[string]string{}
	}
	if item.Episodes == nil {
		item.Episodes = []Episode{}
	}
	body, err := json.Marshal(item)
	if err != nil {
		return fmt.Errorf("encode title: %w", err)
	}
	providerIDs, err := json.Marshal(item.ProviderIDs)
	if err != nil {
		return fmt.Errorf("encode provider IDs: %w", err)
	}
	episodes, err := json.Marshal(item.Episodes)
	if err != nil {
		return fmt.Errorf("encode episodes: %w", err)
	}
	_, err = a.db.Exec(ctx, `
		INSERT INTO titles(id,media,title,provider_ids,episodes,body,updated_at)
		VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,now())
		ON CONFLICT(id) DO UPDATE SET media=EXCLUDED.media,title=EXCLUDED.title,
		provider_ids=EXCLUDED.provider_ids,episodes=EXCLUDED.episodes,body=EXCLUDED.body,updated_at=now()`,
		item.ID, item.Media, item.Title, jsonText(providerIDs), jsonText(episodes), jsonText(body))
	if err != nil {
		return fmt.Errorf("cache catalog title: %w", err)
	}
	return nil
}

func (a *App) searchCatalog(ctx context.Context, query url.Values) ([]CatalogHit, error) {
	media := query.Get("media")
	if media != "" && media != "movie" && media != "show" && media != "game" {
		return nil, badRequest("invalid-media")
	}
	return a.SearchCatalog(ctx, query.Get("text"), media, query.Get("region"))
}
