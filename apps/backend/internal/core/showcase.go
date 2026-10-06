package core

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

type saveShowcaseInput struct {
	CommandID   string   `json:"commandId"`
	BaseVersion int64    `json:"baseVersion"`
	Showcase    Showcase `json:"showcase"`
}

type saveCollectionInput struct {
	CommandID   string   `json:"commandId"`
	ID          string   `json:"id"`
	Version     int64    `json:"version"`
	Title       string   `json:"title"`
	Description *string  `json:"description,omitempty"`
	TitleIDs    []string `json:"titleIds"`
	Audience    Audience `json:"audience"`
}

func (a *App) readShowcase(ctx context.Context, viewer *string, userID string) (Showcase, error) {
	if userID == "" || !a.activeUser(ctx, userID) || a.blockedViewer(ctx, viewer, userID) {
		return Showcase{}, notFound("profile-unavailable")
	}
	showcase := Showcase{UserID: userID, Version: 0, Theme: "lounge", Shelves: []Shelf{}}
	err := a.db.QueryRow(ctx, `SELECT version,theme,COALESCE(featured_title_id,'') FROM showcases WHERE user_id=$1`, userID).Scan(&showcase.Version, &showcase.Theme, &showcase.FeaturedTitleID)
	if err != nil && err != pgx.ErrNoRows {
		return Showcase{}, fmt.Errorf("read showcase: %w", err)
	}
	rows, err := a.db.Query(ctx, `SELECT shelf_id,title,layout,audience_kind,circle_id::text FROM showcase_shelves WHERE user_id=$1 ORDER BY position`, userID)
	if err != nil {
		return Showcase{}, fmt.Errorf("read showcase shelves: %w", err)
	}
	type shelfRecord struct {
		id, title, layout string
		audience          Audience
	}
	shelves := make([]shelfRecord, 0)
	for rows.Next() {
		var shelf shelfRecord
		var circleID *string
		if err := rows.Scan(&shelf.id, &shelf.title, &shelf.layout, &shelf.audience.Kind, &circleID); err != nil {
			rows.Close()
			return Showcase{}, fmt.Errorf("scan showcase shelf: %w", err)
		}
		if circleID != nil {
			shelf.audience.CircleID = *circleID
		}
		if a.visible(ctx, viewer, userID, shelf.audience) {
			shelves = append(shelves, shelf)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return Showcase{}, fmt.Errorf("iterate showcase shelves: %w", err)
	}
	rows.Close()
	for _, record := range shelves {
		items, err := a.db.Query(ctx, `SELECT title_id FROM showcase_shelf_items WHERE user_id=$1 AND shelf_id=$2 ORDER BY position`, userID, record.id)
		if err != nil {
			return Showcase{}, fmt.Errorf("read shelf items: %w", err)
		}
		shelf := Shelf{ID: record.id, Title: record.title, Layout: record.layout, Audience: record.audience, ItemIDs: []string{}}
		for items.Next() {
			var id string
			if err := items.Scan(&id); err != nil {
				items.Close()
				return Showcase{}, fmt.Errorf("scan shelf item: %w", err)
			}
			shelf.ItemIDs = append(shelf.ItemIDs, id)
		}
		if err := items.Err(); err != nil {
			items.Close()
			return Showcase{}, fmt.Errorf("iterate shelf items: %w", err)
		}
		items.Close()
		showcase.Shelves = append(showcase.Shelves, shelf)
	}
	return showcase, nil
}

func (a *App) saveShowcase(ctx context.Context, p Principal, input saveShowcaseInput) (CommandResult, error) {
	value := input.Showcase
	if input.CommandID == "" || input.BaseVersion < 0 || value.UserID != p.UserID || value.Version != input.BaseVersion || len(value.Shelves) > 8 {
		return CommandResult{}, badRequest("invalid-showcase")
	}
	if value.Theme != "lounge" && value.Theme != "matinee" && value.Theme != "midnight" {
		return CommandResult{}, badRequest("invalid-showcase-theme")
	}
	if value.FeaturedTitleID != "" {
		if _, err := a.getTitle(ctx, value.FeaturedTitleID); err != nil {
			return CommandResult{}, err
		}
	}
	seen := map[string]bool{}
	for _, shelf := range value.Shelves {
		if shelf.ID == "" || len(shelf.Title) == 0 || len(shelf.Title) > 80 || len(shelf.ItemIDs) > 24 {
			return CommandResult{}, badRequest("invalid-showcase-shelf")
		}
		if seen[shelf.ID] {
			return CommandResult{}, badRequest("duplicate-shelf")
		}
		seen[shelf.ID] = true
		if shelf.Layout != "covers" && shelf.Layout != "spread" && shelf.Layout != "milestones" {
			return CommandResult{}, badRequest("invalid-shelf-layout")
		}
		if err := a.validateAudience(ctx, p.UserID, shelf.Audience); err != nil {
			return CommandResult{}, err
		}
		for _, id := range shelf.ItemIDs {
			if _, err := a.getTitle(ctx, id); err != nil {
				return CommandResult{}, err
			}
		}
	}
	hash, payload, err := hashJSON(input)
	if err != nil {
		return CommandResult{}, fmt.Errorf("encode showcase: %w", err)
	}
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return CommandResult{}, fmt.Errorf("begin showcase: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := lockCommand(ctx, tx, p.UserID, input.CommandID); err != nil {
		return CommandResult{}, err
	}
	if result, found, err := findReceipt(ctx, tx, p.UserID, input.CommandID, hash); err != nil {
		return CommandResult{}, err
	} else if found {
		return result, nil
	}
	var version int64
	err = tx.QueryRow(ctx, `SELECT version FROM showcases WHERE user_id=$1 FOR UPDATE`, p.UserID).Scan(&version)
	if err == pgx.ErrNoRows {
		version = 0
	} else if err != nil {
		return CommandResult{}, fmt.Errorf("lock showcase: %w", err)
	}
	if version != input.BaseVersion {
		return CommandResult{Status: "conflict", CommandID: input.CommandID, CurrentVersion: version}, nil
	}
	version++
	if _, err := tx.Exec(ctx, `INSERT INTO showcases(user_id,version,theme,featured_title_id,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version,theme=EXCLUDED.theme,featured_title_id=EXCLUDED.featured_title_id,updated_at=now()`, p.UserID, version, value.Theme, nullString(value.FeaturedTitleID)); err != nil {
		return CommandResult{}, fmt.Errorf("save showcase header: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM showcase_shelves WHERE user_id=$1`, p.UserID); err != nil {
		return CommandResult{}, fmt.Errorf("replace showcase shelves: %w", err)
	}
	for position, shelf := range value.Shelves {
		if _, err := tx.Exec(ctx, `INSERT INTO showcase_shelves(user_id,shelf_id,title,layout,audience_kind,circle_id,position) VALUES($1,$2,$3,$4,$5,$6,$7)`, p.UserID, shelf.ID, shelf.Title, shelf.Layout, shelf.Audience.Kind, nullString(shelf.Audience.CircleID), position); err != nil {
			return CommandResult{}, fmt.Errorf("save showcase shelf: %w", err)
		}
		for itemPosition, titleID := range shelf.ItemIDs {
			if _, err := tx.Exec(ctx, `INSERT INTO showcase_shelf_items(user_id,shelf_id,title_id,position) VALUES($1,$2,$3,$4)`, p.UserID, shelf.ID, titleID, itemPosition); err != nil {
				return CommandResult{}, fmt.Errorf("save showcase shelf item: %w", err)
			}
		}
	}
	result := CommandResult{Status: "accepted", CommandID: input.CommandID, Version: version, EventID: "showcase:" + input.CommandID}
	rawResult, _ := json.Marshal(result)
	if _, err := tx.Exec(ctx, `INSERT INTO command_receipts(user_id,command_id,payload_hash,result) VALUES($1,$2,$3,$4::jsonb)`, p.UserID, input.CommandID, hash, jsonText(rawResult)); err != nil {
		return CommandResult{}, fmt.Errorf("save showcase receipt: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE account_policy SET revision=revision+1 WHERE singleton=true`); err != nil {
		return CommandResult{}, fmt.Errorf("update visibility revision: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		if cached, found, readErr := a.readReceipt(ctx, p.UserID, input.CommandID, hash); readErr == nil && found {
			return cached, nil
		}
		_ = payload
		return CommandResult{}, fmt.Errorf("commit showcase: %w", err)
	}
	return result, nil
}

func (a *App) readCollection(ctx context.Context, viewer *string, id string) (Collection, error) {
	c, err := a.loadCollection(ctx, id)
	if err != nil {
		return Collection{}, err
	}
	if !a.visible(ctx, viewer, c.UserID, c.Audience) {
		return Collection{}, notFound("collection-unavailable")
	}
	return c, nil
}

func (a *App) loadCollection(ctx context.Context, id string) (Collection, error) {
	var c Collection
	var circleID *string
	err := a.db.QueryRow(ctx, `SELECT id::text,user_id::text,version,title,COALESCE(description,''),audience_kind,circle_id::text FROM collections WHERE id=$1`, id).Scan(&c.ID, &c.UserID, &c.Version, &c.Title, &c.Description, &c.Audience.Kind, &circleID)
	if err == pgx.ErrNoRows {
		return Collection{}, notFound("collection-unavailable")
	}
	if err != nil {
		return Collection{}, fmt.Errorf("read collection: %w", err)
	}
	if circleID != nil {
		c.Audience.CircleID = *circleID
	}
	rows, err := a.db.Query(ctx, `SELECT title_id FROM collection_titles WHERE collection_id=$1 ORDER BY position`, id)
	if err != nil {
		return Collection{}, fmt.Errorf("read collection titles: %w", err)
	}
	defer rows.Close()
	c.TitleIDs = []string{}
	for rows.Next() {
		var titleID string
		if err := rows.Scan(&titleID); err != nil {
			return Collection{}, fmt.Errorf("scan collection title: %w", err)
		}
		c.TitleIDs = append(c.TitleIDs, titleID)
	}
	if err := rows.Err(); err != nil {
		return Collection{}, fmt.Errorf("iterate collection titles: %w", err)
	}
	return c, nil
}

func (a *App) saveCollection(ctx context.Context, p Principal, input saveCollectionInput) (CommandResult, error) {
	if input.CommandID == "" || input.ID == "" || input.Version < 0 || len(strings.TrimSpace(input.Title)) < 1 || len(input.Title) > 100 || len(input.TitleIDs) > 200 {
		return CommandResult{}, badRequest("invalid-collection")
	}
	if input.Description != nil && len(*input.Description) > 2000 {
		return CommandResult{}, badRequest("invalid-collection-description")
	}
	if err := a.validateAudience(ctx, p.UserID, input.Audience); err != nil {
		return CommandResult{}, err
	}
	seen := map[string]bool{}
	for _, id := range input.TitleIDs {
		if seen[id] {
			return CommandResult{}, badRequest("duplicate-collection-title")
		}
		seen[id] = true
		if _, err := a.getTitle(ctx, id); err != nil {
			return CommandResult{}, err
		}
	}
	hash, _, err := hashJSON(input)
	if err != nil {
		return CommandResult{}, fmt.Errorf("encode collection: %w", err)
	}
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return CommandResult{}, fmt.Errorf("begin collection: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := lockCommand(ctx, tx, p.UserID, input.CommandID); err != nil {
		return CommandResult{}, err
	}
	if result, found, err := findReceipt(ctx, tx, p.UserID, input.CommandID, hash); err != nil {
		return CommandResult{}, err
	} else if found {
		return result, nil
	}
	var owner string
	var version int64
	err = tx.QueryRow(ctx, `SELECT user_id::text,version FROM collections WHERE id=$1 FOR UPDATE`, input.ID).Scan(&owner, &version)
	if err != nil && err != pgx.ErrNoRows {
		return CommandResult{}, fmt.Errorf("lock collection: %w", err)
	}
	if err == pgx.ErrNoRows {
		version = 0
	} else if owner != p.UserID {
		return CommandResult{}, forbidden("wrong-owner")
	}
	if version != input.Version {
		return CommandResult{Status: "conflict", CommandID: input.CommandID, CurrentVersion: version}, nil
	}
	next := version + 1
	if _, err := tx.Exec(ctx, `INSERT INTO collections(id,user_id,version,title,description,audience_kind,circle_id,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,title=EXCLUDED.title,description=EXCLUDED.description,audience_kind=EXCLUDED.audience_kind,circle_id=EXCLUDED.circle_id,updated_at=now()`, input.ID, p.UserID, next, strings.TrimSpace(input.Title), input.Description, input.Audience.Kind, nullString(input.Audience.CircleID)); err != nil {
		return CommandResult{}, fmt.Errorf("save collection header: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM collection_titles WHERE collection_id=$1`, input.ID); err != nil {
		return CommandResult{}, fmt.Errorf("replace collection titles: %w", err)
	}
	for position, titleID := range input.TitleIDs {
		if _, err := tx.Exec(ctx, `INSERT INTO collection_titles(collection_id,title_id,position) VALUES($1,$2,$3)`, input.ID, titleID, position); err != nil {
			return CommandResult{}, fmt.Errorf("save collection title: %w", err)
		}
	}
	result := CommandResult{Status: "accepted", CommandID: input.CommandID, Version: next, EventID: "collection:" + input.CommandID}
	rawResult, _ := json.Marshal(result)
	if _, err := tx.Exec(ctx, `INSERT INTO command_receipts(user_id,command_id,payload_hash,result) VALUES($1,$2,$3,$4::jsonb)`, p.UserID, input.CommandID, hash, jsonText(rawResult)); err != nil {
		return CommandResult{}, fmt.Errorf("save collection receipt: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE account_policy SET revision=revision+1 WHERE singleton=true`); err != nil {
		return CommandResult{}, fmt.Errorf("update visibility revision: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		if cached, found, readErr := a.readReceipt(ctx, p.UserID, input.CommandID, hash); readErr == nil && found {
			return cached, nil
		}
		return CommandResult{}, fmt.Errorf("commit collection: %w", err)
	}
	return result, nil
}

func (a *App) readCollections(ctx context.Context, viewer *string, userID string) ([]Collection, error) {
	rows, err := a.db.Query(ctx, `SELECT id::text FROM collections ORDER BY updated_at DESC,id LIMIT 500`)
	if err != nil {
		return nil, fmt.Errorf("list collections: %w", err)
	}
	defer rows.Close()
	result := make([]Collection, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan collection id: %w", err)
		}
		c, err := a.loadCollection(ctx, id)
		if err != nil {
			continue
		}
		if userID != "" && c.UserID != userID {
			continue
		}
		if a.visible(ctx, viewer, c.UserID, c.Audience) {
			result = append(result, c)
			if len(result) == 50 {
				break
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate collections: %w", err)
	}
	return result, nil
}

func (a *App) validateAudience(ctx context.Context, userID string, audience Audience) error {
	switch audience.Kind {
	case "private", "public", "friends":
		if audience.CircleID != "" {
			return badRequest("invalid-audience")
		}
		return nil
	case "circle":
		if audience.CircleID == "" {
			return badRequest("invalid-audience")
		}
		var owner string
		if err := a.db.QueryRow(ctx, `SELECT owner_id::text FROM circles WHERE id=$1`, audience.CircleID).Scan(&owner); err != nil || owner != userID {
			return forbidden("circle-unavailable")
		}
		return nil
	default:
		return badRequest("invalid-audience")
	}
}
