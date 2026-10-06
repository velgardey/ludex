package core

import (
	"context"
	"crypto"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/oauth2"
)

const googleIssuer = "https://accounts.google.com"
const googleCertsURL = "https://www.googleapis.com/oauth2/v3/certs"
const localPasswordRounds = 120_000

func (a *App) isDevelopment() bool {
	switch strings.ToLower(strings.TrimSpace(a.cfg.Env)) {
	case "dev", "development", "local":
		return true
	default:
		return false
	}
}

func (a *App) ResolveUser(r *http.Request) (string, error) {
	token := ""
	if value := r.Header.Get("Authorization"); strings.HasPrefix(value, "Bearer ") {
		token = strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	}
	if token == "" {
		cookieName := a.cfg.SessionCookieName
		if cookieName == "" {
			cookieName = "ludex_session"
		}
		if cookie, err := r.Cookie(cookieName); err == nil {
			token = cookie.Value
		}
	}
	if token == "" {
		return "", unauthorized("authentication-required")
	}
	if a.db == nil {
		return "", problem(http.StatusServiceUnavailable, "database-unavailable")
	}
	var userID string
	err := a.db.QueryRow(r.Context(), `
		SELECT u.id::text
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND NOT u.disabled`, tokenHash(token)).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", unauthorized("session-expired")
	}
	if err != nil {
		return "", fmt.Errorf("resolve session: %w", err)
	}
	return userID, nil
}

func (a *App) principal(ctx context.Context, userID string) (Principal, error) {
	var roles []string
	err := a.db.QueryRow(ctx, `SELECT roles FROM users WHERE id=$1 AND NOT disabled`, userID).Scan(&roles)
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, unauthorized("account-disabled")
	}
	if err != nil {
		return Principal{}, fmt.Errorf("load principal: %w", err)
	}
	return Principal{UserID: userID, Roles: roles}, nil
}

func (a *App) localSignup(ctx context.Context, input struct {
	InviteCode  string `json:"inviteCode"`
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
}) (Session, error) {
	if !a.isDevelopment() {
		return Session{}, problem(http.StatusServiceUnavailable, "local-auth-disabled")
	}
	if a.db == nil {
		return Session{}, problem(http.StatusServiceUnavailable, "database-unavailable")
	}
	email := strings.ToLower(strings.TrimSpace(input.Email))
	name := strings.TrimSpace(input.DisplayName)
	if !strings.Contains(email, "@") || len(email) > 320 || len(input.Password) < 12 || len(input.Password) > 1024 || len(name) < 1 || len(name) > 80 {
		return Session{}, badRequest("invalid-signup")
	}
	if a.cfg.InviteCode == "" || !sameSecret(input.InviteCode, a.cfg.InviteCode) {
		return Session{}, forbidden("invitation-required")
	}
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return Session{}, fmt.Errorf("begin signup: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(7482415)`); err != nil {
		return Session{}, fmt.Errorf("lock signup cohort: %w", err)
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&count); err != nil {
		return Session{}, fmt.Errorf("count accounts: %w", err)
	}
	maxAccounts := a.cfg.MaxAccounts
	if maxAccounts <= 0 {
		maxAccounts = 100
	}
	if count >= maxAccounts {
		return Session{}, forbidden("cohort-full")
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM local_credentials WHERE email_normalized=$1)`, email).Scan(&exists); err != nil {
		return Session{}, fmt.Errorf("check email: %w", err)
	}
	if exists {
		return Session{}, conflict("email-in-use")
	}
	id := uuid.NewString()
	roles := a.rolesForEmail(email)
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return Session{}, fmt.Errorf("generate credential salt: %w", err)
	}
	passwordHash := pbkdf2SHA256([]byte(input.Password), salt, localPasswordRounds, 32)
	if _, err := tx.Exec(ctx, `INSERT INTO users(id,display_name,email,roles) VALUES($1,$2,$3,$4)`, id, name, email, roles); err != nil {
		return Session{}, fmt.Errorf("insert user: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO local_credentials(user_id,email_normalized,salt,password_hash) VALUES($1,$2,$3,$4)`, id, email, salt, passwordHash); err != nil {
		return Session{}, fmt.Errorf("insert local credential: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO account_settings(user_id) VALUES($1)`, id); err != nil {
		return Session{}, fmt.Errorf("insert settings: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO showcases(user_id) VALUES($1)`, id); err != nil {
		return Session{}, fmt.Errorf("insert showcase: %w", err)
	}
	user := User{ID: id, DisplayName: name, Email: email, Roles: roles}
	session, err := a.createSessionTx(ctx, tx, user, "local")
	if err != nil {
		return Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, fmt.Errorf("commit signup: %w", err)
	}
	return session, nil
}

func (a *App) localLogin(ctx context.Context, input struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}) (Session, error) {
	if !a.isDevelopment() {
		return Session{}, problem(http.StatusServiceUnavailable, "local-auth-disabled")
	}
	if a.db == nil {
		return Session{}, problem(http.StatusServiceUnavailable, "database-unavailable")
	}
	email := strings.ToLower(strings.TrimSpace(input.Email))
	var user User
	var salt, expected []byte
	err := a.db.QueryRow(ctx, `
		SELECT u.id::text,u.display_name,COALESCE(u.email,''),u.roles,c.salt,c.password_hash
		FROM local_credentials c JOIN users u ON u.id=c.user_id
		WHERE c.email_normalized=$1 AND NOT u.disabled`, email).Scan(&user.ID, &user.DisplayName, &user.Email, &user.Roles, &salt, &expected)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, unauthorized("invalid-credentials")
	}
	if err != nil {
		return Session{}, fmt.Errorf("load local credential: %w", err)
	}
	actual := pbkdf2SHA256([]byte(input.Password), salt, localPasswordRounds, len(expected))
	if subtle.ConstantTimeCompare(actual, expected) != 1 {
		return Session{}, unauthorized("invalid-credentials")
	}
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return Session{}, fmt.Errorf("begin local login: %w", err)
	}
	defer tx.Rollback(ctx)
	session, err := a.createSessionTx(ctx, tx, user, "local")
	if err != nil {
		return Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, fmt.Errorf("commit local login: %w", err)
	}
	return session, nil
}

func (a *App) createSessionTx(ctx context.Context, tx pgx.Tx, user User, kind string) (Session, error) {
	token, err := randomToken(32)
	if err != nil {
		return Session{}, fmt.Errorf("generate session: %w", err)
	}
	lifetime := a.cfg.SessionLifetime
	if lifetime <= 0 {
		lifetime = 7 * 24 * time.Hour
	}
	expiresAt := time.Now().UTC().Add(lifetime)
	if _, err := tx.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,expires_at,client_kind) VALUES($1,$2,$3,$4)`, tokenHash(token), user.ID, expiresAt, kind); err != nil {
		return Session{}, fmt.Errorf("persist session: %w", err)
	}
	return Session{Token: token, ExpiresAt: expiresAt, User: user}, nil
}

func (a *App) rolesForEmail(email string) []string {
	roles := []string{"user"}
	for _, moderator := range a.cfg.ModeratorEmails {
		if strings.EqualFold(strings.TrimSpace(moderator), email) {
			return []string{"user", "moderator"}
		}
	}
	return roles
}

func (a *App) me(ctx context.Context, userID string) (User, error) {
	var user User
	err := a.db.QueryRow(ctx, `SELECT id::text,display_name,COALESCE(email,''),roles,bio FROM users WHERE id=$1 AND NOT disabled`, userID).Scan(&user.ID, &user.DisplayName, &user.Email, &user.Roles, &user.Bio)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, notFound("user-unavailable")
	}
	if err != nil {
		return User{}, fmt.Errorf("read user: %w", err)
	}
	return user, nil
}

func (a *App) logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	_, err := a.db.Exec(ctx, `UPDATE sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`, tokenHash(token))
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	return nil
}

func (a *App) googleNative(ctx context.Context, raw struct {
	IDToken     string `json:"idToken"`
	ChallengeID string `json:"challengeId"`
	InviteCode  string `json:"inviteCode"`
}) (Session, error) {
	if a.cfg.GoogleAndroidClientID == "" {
		return Session{}, problem(http.StatusServiceUnavailable, "google-android-not-configured")
	}
	if raw.IDToken == "" || raw.ChallengeID == "" {
		return Session{}, badRequest("google-challenge-required")
	}
	stateHash := tokenHash(raw.ChallengeID)
	var nonce, inviteHash, clientKind string
	err := a.db.QueryRow(ctx, `DELETE FROM oauth_states WHERE state_hash=$1 AND client_kind='native' AND expires_at>now() RETURNING nonce,COALESCE(encode(invite_code_hash,'hex'),''),client_kind`, stateHash).Scan(&nonce, &inviteHash, &clientKind)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, unauthorized("google-challenge-expired")
	}
	if err != nil {
		return Session{}, fmt.Errorf("consume native challenge: %w", err)
	}
	claims, err := a.verifyGoogleIDToken(ctx, raw.IDToken, a.cfg.GoogleAndroidClientID, nonce)
	if err != nil {
		return Session{}, err
	}
	if inviteHash != "" && !sameHash(tokenHash(raw.InviteCode), inviteHash) {
		return Session{}, forbidden("invitation-required")
	}
	return a.googleSession(ctx, claims, raw.InviteCode)
}

func (a *App) googleChallenge(ctx context.Context) (map[string]string, error) {
	if a.cfg.GoogleAndroidClientID == "" {
		return nil, problem(http.StatusServiceUnavailable, "google-android-not-configured")
	}
	state, err := randomToken(32)
	if err != nil {
		return nil, fmt.Errorf("generate google challenge: %w", err)
	}
	nonce, err := randomToken(24)
	if err != nil {
		return nil, fmt.Errorf("generate google nonce: %w", err)
	}
	if _, err := a.db.Exec(ctx, `INSERT INTO oauth_states(state_hash,nonce,code_verifier,client_kind,redirect_uri,expires_at) VALUES($1,$2,'','native','',now()+interval '5 minutes')`, tokenHash(state), nonce); err != nil {
		return nil, fmt.Errorf("store native challenge: %w", err)
	}
	return map[string]string{"challengeId": state, "nonce": nonce}, nil
}

func (a *App) googleStart(w http.ResponseWriter, r *http.Request) error {
	if a.cfg.GoogleWebClientID == "" || a.cfg.GoogleWebClientSecret == "" || a.cfg.RedirectURI == "" {
		return problem(http.StatusServiceUnavailable, "google-web-not-configured")
	}
	state, err := randomToken(32)
	if err != nil {
		return fmt.Errorf("generate oauth state: %w", err)
	}
	verifier, err := randomToken(32)
	if err != nil {
		return fmt.Errorf("generate pkce verifier: %w", err)
	}
	nonce, err := randomToken(24)
	if err != nil {
		return fmt.Errorf("generate oauth nonce: %w", err)
	}
	invite := ""
	if r.Method == http.MethodPost {
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/x-www-form-urlencoded" {
			return badRequest("invalid-oauth-start-form")
		}
		if err := r.ParseForm(); err != nil {
			return badRequest("invalid-oauth-start-form")
		}
		invite = r.PostForm.Get("inviteCode")
	}
	var inviteHash any
	if invite != "" {
		inviteHash = tokenHash(invite)
	}
	if _, err := a.db.Exec(r.Context(), `INSERT INTO oauth_states(state_hash,nonce,code_verifier,invite_code_hash,client_kind,redirect_uri,expires_at) VALUES($1,$2,$3,$4,'web',$5,now()+interval '10 minutes')`, tokenHash(state), nonce, verifier, inviteHash, a.cfg.RedirectURI); err != nil {
		return fmt.Errorf("store oauth state: %w", err)
	}
	cookieName := "ludex_oauth_state"
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: state, Path: "/api/auth/google/callback", HttpOnly: true, Secure: !a.isDevelopment(), SameSite: http.SameSiteLaxMode, MaxAge: 600})
	challenge := base64.RawURLEncoding.EncodeToString(hashBytes([]byte(verifier)))
	query := url.Values{
		"client_id":             {a.cfg.GoogleWebClientID},
		"redirect_uri":          {a.cfg.RedirectURI},
		"response_type":         {"code"},
		"scope":                 {"openid email profile"},
		"state":                 {state},
		"nonce":                 {nonce},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
	}
	http.Redirect(w, r, "https://accounts.google.com/o/oauth2/v2/auth?"+query.Encode(), http.StatusSeeOther)
	return nil
}

func (a *App) googleCallback(w http.ResponseWriter, r *http.Request) error {
	if a.cfg.GoogleWebClientID == "" || a.cfg.GoogleWebClientSecret == "" || a.cfg.RedirectURI == "" {
		return problem(http.StatusServiceUnavailable, "google-web-not-configured")
	}
	if r.URL.Query().Get("error") != "" {
		return unauthorized("google-signin-cancelled")
	}
	state := r.URL.Query().Get("state")
	if state == "" {
		return unauthorized("invalid-oauth-state")
	}
	var observedKind string
	err := a.db.QueryRow(r.Context(), `SELECT client_kind FROM oauth_states WHERE state_hash=$1 AND expires_at>now()`, tokenHash(state)).Scan(&observedKind)
	if errors.Is(err, pgx.ErrNoRows) {
		return unauthorized("oauth-state-expired")
	}
	if err != nil {
		return fmt.Errorf("read oauth state: %w", err)
	}
	if observedKind == "web" {
		cookie, cookieErr := r.Cookie("ludex_oauth_state")
		if cookieErr != nil || !sameSecret(state, cookie.Value) {
			return unauthorized("invalid-oauth-state")
		}
	} else if observedKind != "native-browser" {
		return unauthorized("invalid-oauth-state")
	}
	var nonce, verifier, inviteHash, redirectURI, clientKind, appChallenge string
	err = a.db.QueryRow(r.Context(), `DELETE FROM oauth_states WHERE state_hash=$1 AND client_kind=$2 AND expires_at>now() RETURNING nonce,code_verifier,COALESCE(encode(invite_code_hash,'hex'),''),redirect_uri,client_kind,COALESCE(app_code_challenge,'')`, tokenHash(state), observedKind).Scan(&nonce, &verifier, &inviteHash, &redirectURI, &clientKind, &appChallenge)
	if errors.Is(err, pgx.ErrNoRows) {
		return unauthorized("oauth-state-expired")
	}
	if err != nil {
		return fmt.Errorf("consume oauth state: %w", err)
	}
	oauth := oauth2.Config{
		ClientID:     a.cfg.GoogleWebClientID,
		ClientSecret: a.cfg.GoogleWebClientSecret,
		RedirectURL:  redirectURI,
		Scopes:       []string{"openid", "email", "profile"},
		Endpoint:     oauth2.Endpoint{AuthURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token"},
	}
	googleToken, err := oauth.Exchange(r.Context(), r.URL.Query().Get("code"), oauth2.SetAuthURLParam("code_verifier", verifier))
	if err != nil {
		return problem(http.StatusBadGateway, "google-token-exchange-failed")
	}
	idToken, _ := googleToken.Extra("id_token").(string)
	if idToken == "" {
		return problem(http.StatusUnauthorized, "google-token-exchange-failed")
	}
	claims, err := a.verifyGoogleIDToken(r.Context(), idToken, a.cfg.GoogleWebClientID, nonce)
	if err != nil {
		return err
	}
	// An invitation is checked only for new identities; existing Google subjects
	// can sign in without asking the user to reuse their original invitation.
	inviteCode := ""
	if inviteHash != "" {
		if !sameHash(tokenHash(a.cfg.InviteCode), inviteHash) {
			return forbidden("invitation-required")
		}
		inviteCode = a.cfg.InviteCode
	}
	if clientKind == "native-browser" {
		if !validS256Challenge(appChallenge) {
			return unauthorized("invalid-oauth-state")
		}
		handoff, err := a.createNativeBrowserHandoff(r.Context(), claims, inviteCode, appChallenge)
		if err != nil {
			return err
		}
		http.Redirect(w, r, nativeHandoffURL(handoff, state), http.StatusSeeOther)
		return nil
	}
	session, err := a.googleSession(r.Context(), claims, inviteCode)
	if err != nil {
		return err
	}
	cookieName := a.cfg.SessionCookieName
	if cookieName == "" {
		cookieName = "ludex_session"
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: session.Token, Path: "/api", HttpOnly: true, Secure: !a.isDevelopment(), SameSite: http.SameSiteLaxMode, Expires: session.ExpiresAt})
	http.SetCookie(w, &http.Cookie{Name: "ludex_oauth_state", Value: "", Path: "/api/auth/google/callback", HttpOnly: true, Secure: !a.isDevelopment(), SameSite: http.SameSiteLaxMode, MaxAge: -1})
	if a.cfg.WebOrigin != "" {
		http.Redirect(w, r, strings.TrimRight(a.cfg.WebOrigin, "/")+"/?auth=complete", http.StatusSeeOther)
		return nil
	}
	writeJSON(w, http.StatusOK, session)
	return nil
}

type googleClaims struct {
	Issuer        string
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	Nonce         string
}

func (a *App) googleSession(ctx context.Context, claims googleClaims, inviteCode string) (Session, error) {
	tx, err := a.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return Session{}, fmt.Errorf("begin google session: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(7482415)`); err != nil {
		return Session{}, fmt.Errorf("lock signup cohort: %w", err)
	}
	user, err := a.googleUserTx(ctx, tx, claims, inviteCode)
	if err != nil {
		return Session{}, err
	}
	session, err := a.createSessionTx(ctx, tx, user, "native")
	if err != nil {
		return Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, fmt.Errorf("commit google session: %w", err)
	}
	return session, nil
}

func (a *App) googleUserTx(ctx context.Context, tx pgx.Tx, claims googleClaims, inviteCode string) (User, error) {
	var user User
	err := tx.QueryRow(ctx, `SELECT u.id::text,u.display_name,COALESCE(u.email,''),u.roles,u.bio FROM google_identities g JOIN users u ON u.id=g.user_id WHERE g.issuer=$1 AND g.subject=$2 AND NOT u.disabled FOR UPDATE OF u`, claims.Issuer, claims.Subject).Scan(&user.ID, &user.DisplayName, &user.Email, &user.Roles, &user.Bio)
	if errors.Is(err, pgx.ErrNoRows) {
		if a.cfg.InviteCode == "" || !sameSecret(inviteCode, a.cfg.InviteCode) {
			return User{}, forbidden("invitation-required")
		}
		var count int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&count); err != nil {
			return User{}, fmt.Errorf("count accounts: %w", err)
		}
		maxAccounts := a.cfg.MaxAccounts
		if maxAccounts <= 0 {
			maxAccounts = 100
		}
		if count >= maxAccounts {
			return User{}, forbidden("cohort-full")
		}
		name := strings.TrimSpace(claims.Name)
		if name == "" {
			name = "Ludex user"
		}
		id := uuid.NewString()
		email := ""
		if claims.EmailVerified {
			email = strings.ToLower(strings.TrimSpace(claims.Email))
		}
		user = User{ID: id, DisplayName: name, Email: email, Roles: a.rolesForEmail(email)}
		if _, err := tx.Exec(ctx, `INSERT INTO users(id,display_name,email,roles) VALUES($1,$2,$3,$4)`, id, name, nullString(email), user.Roles); err != nil {
			return User{}, fmt.Errorf("insert google user: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO google_identities(issuer,subject,user_id,email,email_verified) VALUES($1,$2,$3,$4,$5)`, claims.Issuer, claims.Subject, id, nullString(email), claims.EmailVerified); err != nil {
			return User{}, fmt.Errorf("insert google identity: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO account_settings(user_id) VALUES($1)`, id); err != nil {
			return User{}, fmt.Errorf("insert settings: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO showcases(user_id) VALUES($1)`, id); err != nil {
			return User{}, fmt.Errorf("insert showcase: %w", err)
		}
	} else if err != nil {
		return User{}, fmt.Errorf("find google identity: %w", err)
	}
	return user, nil
}

func (a *App) verifyGoogleIDToken(ctx context.Context, value, audience, nonce string) (googleClaims, error) {
	parts := strings.Split(value, ".")
	if len(parts) != 3 || audience == "" {
		return googleClaims{}, unauthorized("invalid-google-token")
	}
	decode := base64.RawURLEncoding.DecodeString
	headerBytes, err := decode(parts[0])
	if err != nil {
		return googleClaims{}, unauthorized("invalid-google-token")
	}
	var header struct {
		Algorithm string `json:"alg"`
		KeyID     string `json:"kid"`
	}
	if json.Unmarshal(headerBytes, &header) != nil || header.Algorithm != "RS256" || header.KeyID == "" {
		return googleClaims{}, unauthorized("invalid-google-token")
	}
	keys, err := a.googleKeys(ctx)
	if err != nil {
		return googleClaims{}, problem(http.StatusBadGateway, "google-keys-unavailable")
	}
	var key *rsa.PublicKey
	for _, candidate := range keys.Keys {
		if candidate.Kid != header.KeyID || candidate.Kty != "RSA" || candidate.Alg != "RS256" {
			continue
		}
		n, decodeErr := decode(candidate.N)
		if decodeErr != nil {
			break
		}
		e, decodeErr := decode(candidate.E)
		if decodeErr != nil {
			break
		}
		eValue := new(big.Int).SetBytes(e).Int64()
		key = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(eValue)}
		break
	}
	if key == nil {
		return googleClaims{}, unauthorized("invalid-google-token")
	}
	signature, err := decode(parts[2])
	if err != nil {
		return googleClaims{}, unauthorized("invalid-google-token")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature); err != nil {
		return googleClaims{}, unauthorized("invalid-google-token")
	}
	payload, err := decode(parts[1])
	if err != nil {
		return googleClaims{}, unauthorized("invalid-google-token")
	}
	var claims struct {
		Issuer        string          `json:"iss"`
		Subject       string          `json:"sub"`
		Audience      json.RawMessage `json:"aud"`
		Authorized    string          `json:"azp"`
		Expires       int64           `json:"exp"`
		IssuedAt      int64           `json:"iat"`
		Nonce         string          `json:"nonce"`
		Email         string          `json:"email"`
		EmailVerified bool            `json:"email_verified"`
		Name          string          `json:"name"`
	}
	if json.Unmarshal(payload, &claims) != nil {
		return googleClaims{}, unauthorized("invalid-google-token")
	}
	if claims.Issuer != googleIssuer && claims.Issuer != "accounts.google.com" {
		return googleClaims{}, unauthorized("invalid-google-token")
	}
	if claims.Subject == "" || claims.Expires <= time.Now().Unix() || claims.IssuedAt > time.Now().Add(5*time.Minute).Unix() || claims.IssuedAt == 0 {
		return googleClaims{}, unauthorized("invalid-google-token")
	}
	var audiences []string
	if len(claims.Audience) > 0 && claims.Audience[0] == '[' {
		if err := json.Unmarshal(claims.Audience, &audiences); err != nil {
			return googleClaims{}, unauthorized("invalid-google-token")
		}
	} else {
		var one string
		if err := json.Unmarshal(claims.Audience, &one); err != nil {
			return googleClaims{}, unauthorized("invalid-google-token")
		}
		audiences = []string{one}
	}
	matched := false
	for _, got := range audiences {
		matched = matched || got == audience
	}
	if !matched || (len(audiences) > 1 && claims.Authorized != audience) {
		return googleClaims{}, unauthorized("invalid-google-token")
	}
	if nonce == "" || !sameSecret(claims.Nonce, nonce) {
		return googleClaims{}, unauthorized("invalid-google-nonce")
	}
	return googleClaims{Issuer: googleIssuer, Subject: claims.Subject, Email: claims.Email, EmailVerified: claims.EmailVerified, Name: claims.Name, Nonce: claims.Nonce}, nil
}

func (a *App) googleKeys(ctx context.Context) (struct {
	Keys []struct {
		Kid string `json:"kid"`
		Kty string `json:"kty"`
		Alg string `json:"alg"`
		N   string `json:"n"`
		E   string `json:"e"`
	} `json:"keys"`
}, error) {
	var set struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			Alg string `json:"alg"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, googleCertsURL, nil)
	if err != nil {
		return set, err
	}
	response, err := a.httpClient.Do(req)
	if err != nil {
		return set, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return set, fmt.Errorf("google certificate server returned %s", response.Status)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&set); err != nil {
		return set, err
	}
	return set, nil
}

func randomToken(size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func tokenHash(value string) []byte {
	return hashBytes([]byte(value))
}

func hashBytes(value []byte) []byte {
	sum := sha256.Sum256(value)
	return sum[:]
}

func sameSecret(a, b string) bool {
	left := sha256.Sum256([]byte(a))
	right := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(left[:], right[:]) == 1
}

func sameHash(value []byte, expectedHex string) bool {
	expected, err := hex.DecodeString(expectedHex)
	return err == nil && len(value) == len(expected) && hmac.Equal(value, expected)
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func pbkdf2SHA256(password, salt []byte, rounds, keyLen int) []byte {
	const blockSize = 32
	result := make([]byte, 0, keyLen)
	for block := uint32(1); len(result) < keyLen; block++ {
		mac := hmac.New(sha256.New, password)
		_, _ = mac.Write(salt)
		var counter [4]byte
		counter[0] = byte(block >> 24)
		counter[1] = byte(block >> 16)
		counter[2] = byte(block >> 8)
		counter[3] = byte(block)
		_, _ = mac.Write(counter[:])
		u := mac.Sum(nil)
		value := append([]byte(nil), u...)
		for round := 1; round < rounds; round++ {
			mac = hmac.New(sha256.New, password)
			_, _ = mac.Write(u)
			u = mac.Sum(nil)
			for i := range value {
				value[i] ^= u[i]
			}
		}
		result = append(result, value...)
	}
	return result[:keyLen]
}
