package core

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
)

const nativeAuthLimit = 12

type nativeGoogleStartInput struct {
	InviteCode    string `json:"inviteCode"`
	CodeChallenge string `json:"codeChallenge"`
}

type nativeGoogleStartResult struct {
	URL   string `json:"url"`
	State string `json:"state"`
}

func (a *App) startNativeBrowserGoogle(ctx context.Context, request *http.Request, input nativeGoogleStartInput) (nativeGoogleStartResult, error) {
	if a.cfg.GoogleWebClientID == "" || a.cfg.GoogleWebClientSecret == "" || a.cfg.RedirectURI == "" {
		return nativeGoogleStartResult{}, problem(http.StatusServiceUnavailable, "google-web-not-configured")
	}
	if !validS256Challenge(input.CodeChallenge) {
		return nativeGoogleStartResult{}, badRequest("invalid-code-challenge")
	}
	if err := a.applyNativeRateLimit(ctx, request, "start"); err != nil {
		return nativeGoogleStartResult{}, err
	}
	state, err := randomToken(32)
	if err != nil {
		return nativeGoogleStartResult{}, fmt.Errorf("generate native oauth state: %w", err)
	}
	serverVerifier, err := randomToken(32)
	if err != nil {
		return nativeGoogleStartResult{}, fmt.Errorf("generate google pkce verifier: %w", err)
	}
	nonce, err := randomToken(24)
	if err != nil {
		return nativeGoogleStartResult{}, fmt.Errorf("generate native oauth nonce: %w", err)
	}
	var inviteHash any
	if input.InviteCode != "" {
		inviteHash = tokenHash(input.InviteCode)
	}
	_, err = a.db.Exec(ctx, `INSERT INTO oauth_states(state_hash,nonce,code_verifier,invite_code_hash,client_kind,redirect_uri,expires_at,app_code_challenge) VALUES($1,$2,$3,$4,'native-browser',$5,now()+interval '10 minutes',$6)`, tokenHash(state), nonce, serverVerifier, inviteHash, a.cfg.RedirectURI, input.CodeChallenge)
	if err != nil {
		return nativeGoogleStartResult{}, fmt.Errorf("store native oauth state: %w", err)
	}
	query := url.Values{
		"client_id":             {a.cfg.GoogleWebClientID},
		"redirect_uri":          {a.cfg.RedirectURI},
		"response_type":         {"code"},
		"scope":                 {"openid email profile"},
		"state":                 {state},
		"nonce":                 {nonce},
		"code_challenge":        {s256Challenge(serverVerifier)},
		"code_challenge_method": {"S256"},
	}
	return nativeGoogleStartResult{URL: "https://accounts.google.com/o/oauth2/v2/auth?" + query.Encode(), State: state}, nil
}

func (a *App) exchangeNativeBrowserHandoff(ctx context.Context, code, codeVerifier string) (Session, error) {
	if code == "" || !validPKCEVerifier(codeVerifier) {
		return Session{}, badRequest("invalid-native-handoff")
	}
	if a.db == nil {
		return Session{}, problem(http.StatusServiceUnavailable, "database-unavailable")
	}
	wantedChallenge := s256Challenge(codeVerifier)
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Session{}, fmt.Errorf("begin native handoff exchange: %w", err)
	}
	defer tx.Rollback(ctx)
	var userID, storedChallenge string
	err = tx.QueryRow(ctx, `SELECT user_id::text,code_challenge FROM oauth_handoffs WHERE code_hash=$1 AND expires_at>now() FOR UPDATE`, tokenHash(code)).Scan(&userID, &storedChallenge)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, unauthorized("native-handoff-expired")
	}
	if err != nil {
		return Session{}, fmt.Errorf("read native handoff: %w", err)
	}
	if subtle.ConstantTimeCompare([]byte(wantedChallenge), []byte(storedChallenge)) != 1 {
		return Session{}, unauthorized("invalid-native-verifier")
	}
	var user User
	err = tx.QueryRow(ctx, `SELECT id::text,display_name,COALESCE(email,''),roles,bio FROM users WHERE id=$1 AND NOT disabled FOR UPDATE`, userID).Scan(&user.ID, &user.DisplayName, &user.Email, &user.Roles, &user.Bio)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, unauthorized("account-disabled")
	}
	if err != nil {
		return Session{}, fmt.Errorf("load native handoff account: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM oauth_handoffs WHERE code_hash=$1`, tokenHash(code)); err != nil {
		return Session{}, fmt.Errorf("consume native handoff: %w", err)
	}
	session, err := a.createSessionTx(ctx, tx, user, "native")
	if err != nil {
		return Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, fmt.Errorf("commit native handoff: %w", err)
	}
	return session, nil
}

func (a *App) createNativeBrowserHandoff(ctx context.Context, claims googleClaims, inviteCode, appChallenge string) (string, error) {
	code, err := randomToken(32)
	if err != nil {
		return "", fmt.Errorf("generate native handoff: %w", err)
	}
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return "", fmt.Errorf("begin native google account: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(7482415)`); err != nil {
		return "", fmt.Errorf("lock signup cohort: %w", err)
	}
	user, err := a.googleUserTx(ctx, tx, claims, inviteCode)
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO oauth_handoffs(code_hash,user_id,code_challenge,expires_at) VALUES($1,$2,$3,now()+interval '3 minutes')`, tokenHash(code), user.ID, appChallenge); err != nil {
		return "", fmt.Errorf("store native handoff: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit native google handoff: %w", err)
	}
	return code, nil
}

func (a *App) applyNativeRateLimit(ctx context.Context, request *http.Request, action string) error {
	if a.db == nil {
		return problem(http.StatusServiceUnavailable, "database-unavailable")
	}
	remote := strings.TrimSpace(request.RemoteAddr)
	if host, _, err := net.SplitHostPort(remote); err == nil {
		remote = host
	}
	if remote == "" {
		remote = "unknown"
	}
	var attempts int
	err := a.db.QueryRow(ctx, `
		INSERT INTO native_auth_rate_limits(client_key_hash,action,window_start,attempts)
		VALUES($1,$2,date_trunc('minute',clock_timestamp()),1)
		ON CONFLICT(client_key_hash,action,window_start)
		DO UPDATE SET attempts=native_auth_rate_limits.attempts+1
		RETURNING attempts`, tokenHash(remote), action).Scan(&attempts)
	if err != nil {
		return fmt.Errorf("apply native auth rate limit: %w", err)
	}
	if attempts > nativeAuthLimit {
		return problem(http.StatusTooManyRequests, "rate-limit-exceeded")
	}
	return nil
}

func validS256Challenge(value string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size && base64.RawURLEncoding.EncodeToString(decoded) == value
}

func validPKCEVerifier(value string) bool {
	if len(value) < 43 || len(value) > 128 {
		return false
	}
	for _, char := range value {
		if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || strings.ContainsRune("-._~", char)) {
			return false
		}
	}
	return true
}

func s256Challenge(verifier string) string {
	digest := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func nativeHandoffURL(code, state string) string {
	query := url.Values{"code": {code}, "state": {state}}
	return "ludex://auth?" + query.Encode()
}
