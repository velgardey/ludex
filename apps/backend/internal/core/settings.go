package core

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type accountSettings struct {
	Region                  string          `json:"region"`
	TimeZone                string          `json:"timeZone"`
	DefaultAudience         string          `json:"defaultAudience"`
	LowData                 bool            `json:"lowData"`
	ReducedMotion           bool            `json:"reducedMotion"`
	Haptics                 bool            `json:"haptics"`
	NotificationPreferences map[string]bool `json:"notificationPreferences"`
}

func (a *App) getSettings(ctx context.Context, p Principal) (accountSettings, error) {
	settings := accountSettings{Region: "US", TimeZone: "UTC", DefaultAudience: "private", LowData: false, ReducedMotion: false, Haptics: true, NotificationPreferences: map[string]bool{}}
	err := a.db.QueryRow(ctx, `SELECT region,time_zone,default_audience,low_data,reduced_motion,haptics,notification_preferences FROM account_settings WHERE user_id=$1`, p.UserID).Scan(&settings.Region, &settings.TimeZone, &settings.DefaultAudience, &settings.LowData, &settings.ReducedMotion, &settings.Haptics, &settings.NotificationPreferences)
	if err != nil && err.Error() != "no rows in result set" {
		return accountSettings{}, fmt.Errorf("read settings: %w", err)
	}
	if settings.NotificationPreferences == nil {
		settings.NotificationPreferences = map[string]bool{}
	}
	return settings, nil
}

func (a *App) saveSettings(ctx context.Context, p Principal, input map[string]json.RawMessage) (accountSettings, error) {
	allowed := map[string]bool{"region": true, "timeZone": true, "defaultAudience": true, "lowData": true, "reducedMotion": true, "haptics": true, "notificationPreferences": true}
	for key := range input {
		if !allowed[key] {
			return accountSettings{}, badRequest("invalid-settings")
		}
	}
	settings, err := a.getSettings(ctx, p)
	if err != nil {
		return accountSettings{}, err
	}
	decode := func(key string, target any) error {
		raw, ok := input[key]
		if !ok {
			return nil
		}
		if err := json.Unmarshal(raw, target); err != nil {
			return badRequest("invalid-settings")
		}
		return nil
	}
	if raw, ok := input["region"]; ok {
		var value string
		if json.Unmarshal(raw, &value) != nil || len(value) != 2 || value != strings.ToUpper(value) || value[0] < 'A' || value[0] > 'Z' || value[1] < 'A' || value[1] > 'Z' {
			return accountSettings{}, badRequest("invalid-region")
		}
		settings.Region = value
	}
	if raw, ok := input["timeZone"]; ok {
		var value string
		if json.Unmarshal(raw, &value) != nil || len(value) > 100 {
			return accountSettings{}, badRequest("invalid-time-zone")
		}
		if _, err := time.LoadLocation(value); err != nil {
			return accountSettings{}, badRequest("invalid-time-zone")
		}
		settings.TimeZone = value
	}
	if raw, ok := input["defaultAudience"]; ok {
		var value string
		if json.Unmarshal(raw, &value) != nil || value != "private" && value != "public" && value != "friends" {
			return accountSettings{}, badRequest("invalid-default-audience")
		}
		settings.DefaultAudience = value
	}
	if err := decode("lowData", &settings.LowData); err != nil {
		return accountSettings{}, err
	}
	if err := decode("reducedMotion", &settings.ReducedMotion); err != nil {
		return accountSettings{}, err
	}
	if err := decode("haptics", &settings.Haptics); err != nil {
		return accountSettings{}, err
	}
	if raw, ok := input["notificationPreferences"]; ok {
		var value map[string]bool
		if json.Unmarshal(raw, &value) != nil || len(value) > 100 {
			return accountSettings{}, badRequest("invalid-notification-preferences")
		}
		settings.NotificationPreferences = value
	}
	preferences, _ := json.Marshal(settings.NotificationPreferences)
	_, err = a.db.Exec(ctx, `INSERT INTO account_settings(user_id,region,time_zone,default_audience,low_data,reduced_motion,haptics,notification_preferences,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now()) ON CONFLICT(user_id) DO UPDATE SET region=EXCLUDED.region,time_zone=EXCLUDED.time_zone,default_audience=EXCLUDED.default_audience,low_data=EXCLUDED.low_data,reduced_motion=EXCLUDED.reduced_motion,haptics=EXCLUDED.haptics,notification_preferences=EXCLUDED.notification_preferences,updated_at=now()`, p.UserID, settings.Region, settings.TimeZone, settings.DefaultAudience, settings.LowData, settings.ReducedMotion, settings.Haptics, jsonText(preferences))
	if err != nil {
		return accountSettings{}, fmt.Errorf("save settings: %w", err)
	}
	return settings, nil
}
