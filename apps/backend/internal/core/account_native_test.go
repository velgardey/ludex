package core

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

func TestApplyLibraryUsesTheVersionedLibraryEditPath(t *testing.T) {
	pool := testDatabase(t)
	seedTitle(t, pool, "show:imported", "show")
	app := New(pool, Config{Env: "development", InviteCode: "invite"})
	session := signup(t, app, "library-bridge@example.test", "Library Bridge")
	user := userID(t, app, session.Token)
	raw := json.RawMessage(`{"commandId":"import:1","titleId":"show:imported","baseVersion":0,"patch":{"state":"active","rating":8,"note":"imported note"}}`)

	result, err := app.ApplyLibrary(t.Context(), user, raw)
	if err != nil {
		t.Fatalf("apply imported library edit: %v", err)
	}
	var applied CommandResult
	if err := json.Unmarshal(result, &applied); err != nil {
		t.Fatalf("decode library edit result: %v", err)
	}
	if applied.Status != "accepted" || applied.Version != 1 {
		t.Fatalf("library edit result = %#v, want accepted version 1", applied)
	}
	items, err := app.LoadLibrary(t.Context(), user)
	if err != nil || len(items) != 1 {
		t.Fatalf("load imported library item: items=%#v err=%v", items, err)
	}
	if items[0].State != "active" || items[0].Rating == nil || *items[0].Rating != 8 || items[0].Note == nil || *items[0].Note != "imported note" {
		t.Fatalf("imported show was not applied as a normal library edit: %#v", items[0])
	}
	if len(items[0].Runs) != 0 {
		t.Fatalf("show without episode evidence created progress runs: %#v", items[0].Runs)
	}
}

func TestAccountExportIsOwnerScopedAndOmitsConnectionCredentials(t *testing.T) {
	pool := testDatabase(t)
	app := New(pool, Config{Env: "development", InviteCode: "invite"})
	alice := signup(t, app, "export-alice@example.test", "Export Alice")
	bob := signup(t, app, "export-bob@example.test", "Export Bob")
	aliceID := userID(t, app, alice.Token)
	_, err := pool.Exec(t.Context(), `INSERT INTO connector_accounts(id,user_id,source,provider_user,sealed_credential) VALUES('connector:alice',$1,'steam','steam-user',decode('deadbeefcafebabe','hex'))`, aliceID)
	if err != nil {
		t.Fatalf("seed sealed connection credential: %v", err)
	}

	export := callJSON(t, app, http.MethodPost, "/api/account/export", map[string]any{}, alice.Token)
	if export.Code != http.StatusOK {
		t.Fatalf("create export status = %d; body=%s", export.Code, export.Body.String())
	}
	var result struct {
		DownloadID  string    `json:"downloadId"`
		ExpiresAt   time.Time `json:"expiresAt"`
		DownloadURL string    `json:"downloadUrl"`
	}
	if err := json.Unmarshal(export.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode export response: %v", err)
	}
	if result.DownloadID == "" || result.DownloadURL == "" || time.Until(result.ExpiresAt) < 14*time.Minute || time.Until(result.ExpiresAt) > 16*time.Minute {
		t.Fatalf("export response has wrong 15-minute download contract: %#v", result)
	}

	parsed, err := url.Parse(result.DownloadURL)
	if err != nil || parsed.Query().Get("id") != result.DownloadID {
		t.Fatalf("download URL %q does not carry the returned id: %v", result.DownloadURL, err)
	}
	path := parsed.RequestURI()
	download := callJSON(t, app, http.MethodGet, path, nil, alice.Token)
	if download.Code != http.StatusOK || download.Header().Get("Content-Disposition") != `attachment; filename="ludex-export.json"` {
		t.Fatalf("download status/header = %d %q; body=%s", download.Code, download.Header().Get("Content-Disposition"), download.Body.String())
	}
	var data struct {
		SchemaVersion int               `json:"schemaVersion"`
		ExportedAt    time.Time         `json:"exportedAt"`
		User          map[string]any    `json:"user"`
		Private       []json.RawMessage `json:"privateRecords"`
		Social        []json.RawMessage `json:"socialRecords"`
	}
	if err := json.Unmarshal(download.Body.Bytes(), &data); err != nil {
		t.Fatalf("decode export file: %v", err)
	}
	if data.SchemaVersion != 1 || data.User["id"] != aliceID || data.ExportedAt.IsZero() || data.Private == nil || data.Social == nil {
		t.Fatalf("export JSON shape or ownership is wrong: %#v", data)
	}
	if bytes.Contains(download.Body.Bytes(), []byte("deadbeefcafebabe")) || bytes.Contains(download.Body.Bytes(), []byte("sealed_credential")) || bytes.Contains(download.Body.Bytes(), []byte("password_hash")) || bytes.Contains(download.Body.Bytes(), []byte("token_hash")) {
		t.Fatalf("export leaked a credential field: %s", download.Body.String())
	}
	other := callJSON(t, app, http.MethodGet, path, nil, bob.Token)
	if other.Code != http.StatusNotFound {
		t.Fatalf("another account downloaded Alice's export: status=%d body=%s", other.Code, other.Body.String())
	}
	if _, err := pool.Exec(t.Context(), `UPDATE account_exports SET expires_at=now()-interval '1 second' WHERE download_id_hash=$1`, tokenHash(result.DownloadID)); err != nil {
		t.Fatalf("expire export fixture: %v", err)
	}
	expired := callJSON(t, app, http.MethodGet, path, nil, alice.Token)
	if expired.Code != http.StatusGone {
		t.Fatalf("expired export download status = %d, want 410; body=%s", expired.Code, expired.Body.String())
	}
}

func TestAccountDeletionRemovesCoreCompanionAndConnectionDataImmediately(t *testing.T) {
	pool := testDatabase(t)
	app := New(pool, Config{Env: "development", InviteCode: "invite"})
	alice := signup(t, app, "delete-alice@example.test", "Delete Alice")
	aliceID := userID(t, app, alice.Token)
	conversationID := "10000000-0000-4000-8000-000000000001"
	planID := "plan:owned"
	for _, seed := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO assistant_conversations(id,user_id) VALUES($1,$2)`, []any{conversationID, aliceID}},
		{`INSERT INTO assistant_messages(id,conversation_id,request_id,role,body) VALUES('10000000-0000-4000-8000-000000000002',$1,'req','user','private message')`, []any{conversationID}},
		{`INSERT INTO assistant_budget_windows(scope_key,window_start,reserved_micros,spent_micros) VALUES('user:'||$1,current_date,10,4)`, []any{aliceID}},
		{`INSERT INTO assistant_monthly_usage(scope_key,month_start,reserved_micros,spent_micros,response_count) VALUES('user:'||$1,date_trunc('month',current_date)::date,10,4,1)`, []any{aliceID}},
		{`INSERT INTO connector_accounts(id,user_id,source,provider_user,sealed_credential) VALUES('connector:delete',$1,'steam','steam-user',decode('0102','hex'))`, []any{aliceID}},
		{`INSERT INTO connector_observations(id,user_id,source,provider_record,payload) VALUES('observation:delete',$1,'steam','record','{}')`, []any{aliceID}},
		{`INSERT INTO import_batches(id,user_id,source,rows) VALUES('batch:delete',$1,'csv','[]')`, []any{aliceID}},
		{`INSERT INTO work_jobs(id,user_id,kind,payload) VALUES('job:delete',$1,'import-commit','{}')`, []any{aliceID}},
		{`INSERT INTO shared_plans(id,owner_id,title) VALUES($1,$2,'plan')`, []any{planID, aliceID}},
		{`INSERT INTO plan_members(plan_id,user_id) VALUES($1,$2)`, []any{planID, aliceID}},
		{`INSERT INTO plan_candidates(plan_id,title_id,added_by) VALUES($1,'title:unknown',$2)`, []any{planID, aliceID}},
		{`INSERT INTO plan_messages(id,plan_id,user_id,body,scope) VALUES('message:delete',$1,$2,'plan note','{}')`, []any{planID, aliceID}},
		{`INSERT INTO notification_inbox(id,user_id,kind,body) VALUES('notification:delete',$1,'test','{}')`, []any{aliceID}},
		{`INSERT INTO reports(id,reporter_id,target_id,reason) VALUES('10000000-0000-4000-8000-000000000003',$1,'target:private','other')`, []any{aliceID}},
		{`INSERT INTO moderation_audit(id,moderator_id,target_id,action,reason) VALUES('10000000-0000-4000-8000-000000000004',$1,'target:private','remove','test')`, []any{aliceID}},
	} {
		if _, err := pool.Exec(t.Context(), seed.query, seed.args...); err != nil {
			t.Fatalf("seed account data: %v", err)
		}
	}

	deleted := callJSON(t, app, http.MethodPost, "/api/account/delete", map[string]any{}, alice.Token)
	if deleted.Code != http.StatusOK {
		t.Fatalf("request deletion status = %d; body=%s", deleted.Code, deleted.Body.String())
	}
	jobID := decodeMap(t, deleted)["jobId"]
	if _, ok := jobID.(string); !ok || jobID == "" {
		t.Fatalf("deletion response did not preserve jobId contract: %#v", decodeMap(t, deleted))
	}
	me := callJSON(t, app, http.MethodGet, "/api/auth/me", nil, alice.Token)
	if me.Code != http.StatusUnauthorized {
		t.Fatalf("deleted bearer session remained valid: status=%d body=%s", me.Code, me.Body.String())
	}
	ownerColumn := map[string]string{
		"users": "id", "sessions": "user_id", "assistant_conversations": "user_id", "assistant_budget_windows": "scope_key",
		"assistant_monthly_usage": "scope_key", "connector_accounts": "user_id", "connector_observations": "user_id", "import_batches": "user_id",
		"work_jobs": "user_id", "shared_plans": "owner_id", "plan_members": "user_id", "plan_messages": "user_id",
		"notification_inbox": "user_id", "reports": "reporter_id", "moderation_audit": "moderator_id",
	}
	for table, column := range ownerColumn {
		var count int
		value := aliceID
		if column == "scope_key" {
			value = "user:" + aliceID
		}
		if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM `+table+` WHERE `+column+`::text=$1`, value).Scan(&count); err != nil || count != 0 {
			t.Errorf("deletion retained rows in %s: count=%d err=%v", table, count, err)
		}
	}
	var candidateCount int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM plan_candidates WHERE plan_id=$1`, planID).Scan(&candidateCount); err != nil || candidateCount != 0 {
		t.Errorf("deletion retained owned plan candidates: count=%d err=%v", candidateCount, err)
	}
	var receiptCount int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM account_deletion_receipts WHERE user_hash=$1`, tokenHash(aliceID)).Scan(&receiptCount); err != nil || receiptCount != 1 {
		t.Fatalf("pseudonymous deletion receipt = %d rows, err=%v", receiptCount, err)
	}
}

func TestNativeBrowserGoogleFlowBindsHandoffAndConsumesOnlyAfterVerifierMatches(t *testing.T) {
	pool := testDatabase(t)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	transport := &testGoogleTransport{key: key, audience: "google-client", nonce: new(string)}
	app := New(pool, Config{
		Env: "development", InviteCode: "invite", GoogleWebClientID: "google-client", GoogleWebClientSecret: "google-secret",
		RedirectURI: "https://api.ludex.test/api/auth/google/callback", HTTPClient: &http.Client{Transport: transport},
	})
	appVerifier := strings.Repeat("v", 43)
	clientChallenge := s256ChallengeForTest(appVerifier)
	started := callJSON(t, app, http.MethodPost, "/api/auth/google/native/start", map[string]string{"inviteCode": "invite", "codeChallenge": clientChallenge, "redirectUri": "https://attacker.invalid"}, "")
	if started.Code != http.StatusOK {
		t.Fatalf("native-browser start status = %d; body=%s", started.Code, started.Body.String())
	}
	var start struct {
		URL   string `json:"url"`
		State string `json:"state"`
	}
	if err := json.Unmarshal(started.Body.Bytes(), &start); err != nil || start.URL == "" || start.State == "" {
		t.Fatalf("invalid native-browser start response: %#v err=%v", start, err)
	}
	googleURL, err := url.Parse(start.URL)
	if err != nil || googleURL.Host != "accounts.google.com" || googleURL.Query().Get("state") != start.State || googleURL.Query().Get("redirect_uri") != app.cfg.RedirectURI || googleURL.Query().Get("redirect_uri") == "https://attacker.invalid" {
		t.Fatalf("authorization URL did not use server callback and returned state: %q (%v)", start.URL, err)
	}
	var nonce, serverVerifier, persistedChallenge string
	if err := pool.QueryRow(t.Context(), `SELECT nonce,code_verifier,app_code_challenge FROM oauth_states WHERE state_hash=$1 AND client_kind='native-browser'`, tokenHash(start.State)).Scan(&nonce, &serverVerifier, &persistedChallenge); err != nil {
		t.Fatalf("load server-side native state: %v", err)
	}
	*transport.nonce = nonce
	if persistedChallenge != clientChallenge || googleURL.Query().Get("code_challenge") != s256ChallengeForTest(serverVerifier) {
		t.Fatalf("app challenge or server PKCE challenge was not bound separately")
	}

	badCallback := googleCallbackRequest(app, start.State+"x")
	badResponse := httptest.NewRecorder()
	app.ServeHTTP(badResponse, badCallback)
	if badResponse.Code != http.StatusUnauthorized {
		t.Fatalf("callback accepted an unknown state: %d %s", badResponse.Code, badResponse.Body.String())
	}
	var stillAvailable bool
	if err := pool.QueryRow(t.Context(), `SELECT EXISTS(SELECT 1 FROM oauth_states WHERE state_hash=$1)`, tokenHash(start.State)).Scan(&stillAvailable); err != nil || !stillAvailable {
		t.Fatalf("invalid callback state consumed the valid state: available=%v err=%v", stillAvailable, err)
	}

	callback := googleCallbackRequest(app, start.State)
	callbackResponse := httptest.NewRecorder()
	app.ServeHTTP(callbackResponse, callback)
	if callbackResponse.Code != http.StatusSeeOther {
		t.Fatalf("cookie-less native callback status = %d; body=%s", callbackResponse.Code, callbackResponse.Body.String())
	}
	deepLink, err := url.Parse(callbackResponse.Header().Get("Location"))
	if err != nil || deepLink.Scheme != "ludex" || deepLink.Host != "auth" || deepLink.Query().Get("state") != start.State {
		t.Fatalf("callback deep link is not fixed or state-bound: %q (%v)", callbackResponse.Header().Get("Location"), err)
	}
	handoff := deepLink.Query().Get("code")
	if handoff == "" || strings.Contains(callbackResponse.Header().Get("Location"), serverVerifier) || strings.Contains(callbackResponse.Header().Get("Location"), "token") {
		t.Fatalf("callback leaked a bearer or omitted one-time handoff: %q", callbackResponse.Header().Get("Location"))
	}

	wrong := callJSON(t, app, http.MethodPost, "/api/auth/google/native/exchange", map[string]string{"code": handoff, "codeVerifier": strings.Repeat("x", 43)}, "")
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong app verifier status = %d; body=%s", wrong.Code, wrong.Body.String())
	}
	correct := callJSON(t, app, http.MethodPost, "/api/auth/google/native/exchange", map[string]string{"code": handoff, "codeVerifier": appVerifier}, "")
	if correct.Code != http.StatusOK {
		t.Fatalf("correct app verifier status = %d; body=%s", correct.Code, correct.Body.String())
	}
	var session Session
	if err := json.Unmarshal(correct.Body.Bytes(), &session); err != nil || session.Token == "" || session.User.ID == "" {
		t.Fatalf("exchange did not return a regular session: %#v err=%v", session, err)
	}
	replay := callJSON(t, app, http.MethodPost, "/api/auth/google/native/exchange", map[string]string{"code": handoff, "codeVerifier": appVerifier}, "")
	if replay.Code != http.StatusUnauthorized {
		t.Fatalf("handoff replay status = %d; body=%s", replay.Code, replay.Body.String())
	}
}

func TestNativeBrowserGoogleStartAndExchangeAreRateLimited(t *testing.T) {
	pool := testDatabase(t)
	app := New(pool, Config{Env: "development", InviteCode: "invite", GoogleWebClientID: "google-client", GoogleWebClientSecret: "google-secret", RedirectURI: "https://api.ludex.test/api/auth/google/callback"})
	challenge := s256ChallengeForTest(strings.Repeat("v", 43))
	var last *httptest.ResponseRecorder
	for i := 0; i < 13; i++ {
		last = callJSON(t, app, http.MethodPost, "/api/auth/google/native/start", map[string]string{"inviteCode": "invite", "codeChallenge": challenge}, "")
	}
	if last.Code != http.StatusTooManyRequests {
		t.Fatalf("native start limit status = %d, want 429; body=%s", last.Code, last.Body.String())
	}
	for i := 0; i < 13; i++ {
		last = callJSON(t, app, http.MethodPost, "/api/auth/google/native/exchange", map[string]string{"code": "unknown", "codeVerifier": strings.Repeat("v", 43)}, "")
	}
	if last.Code != http.StatusTooManyRequests {
		t.Fatalf("native exchange limit status = %d, want 429; body=%s", last.Code, last.Body.String())
	}
}

func TestGoogleWebCallbackStillRequiresItsStateCookie(t *testing.T) {
	pool := testDatabase(t)
	app := New(pool, Config{Env: "development", InviteCode: "invite", GoogleWebClientID: "google-client", GoogleWebClientSecret: "google-secret", RedirectURI: "https://api.ludex.test/api/auth/google/callback"})
	start := httptest.NewRequest(http.MethodPost, "/api/auth/google/start", strings.NewReader(url.Values{"inviteCode": {"invite"}}.Encode()))
	start.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	started := httptest.NewRecorder()
	app.ServeHTTP(started, start)
	if started.Code != http.StatusSeeOther {
		t.Fatalf("web oauth start status = %d; body=%s", started.Code, started.Body.String())
	}
	googleURL, err := url.Parse(started.Header().Get("Location"))
	if err != nil {
		t.Fatalf("parse Google redirect: %v", err)
	}
	state := googleURL.Query().Get("state")
	callback := httptest.NewRecorder()
	app.ServeHTTP(callback, httptest.NewRequest(http.MethodGet, "/api/auth/google/callback?code=google-code&state="+url.QueryEscape(state), nil))
	if callback.Code != http.StatusUnauthorized || !strings.Contains(callback.Body.String(), "invalid-oauth-state") {
		t.Fatalf("web callback without state cookie was accepted: %d %s", callback.Code, callback.Body.String())
	}
	var stillAvailable bool
	if err := pool.QueryRow(t.Context(), `SELECT EXISTS(SELECT 1 FROM oauth_states WHERE state_hash=$1 AND client_kind='web')`, tokenHash(state)).Scan(&stillAvailable); err != nil || !stillAvailable {
		t.Fatalf("web callback cookie rejection consumed OAuth state: available=%v err=%v", stillAvailable, err)
	}
}

func TestNativeBrowserHandoffExpires(t *testing.T) {
	pool := testDatabase(t)
	app := New(pool, Config{Env: "development", InviteCode: "invite", GoogleWebClientID: "google-client", GoogleWebClientSecret: "google-secret", RedirectURI: "https://api.ludex.test/api/auth/google/callback"})
	code := strings.Repeat("h", 43)
	user := signup(t, app, "expired-handoff@example.test", "Expired Handoff")
	userID := userID(t, app, user.Token)
	_, err := pool.Exec(t.Context(), `INSERT INTO oauth_handoffs(code_hash,user_id,code_challenge,expires_at) VALUES($1,$2,$3,now()-interval '1 second')`, tokenHash("expired-handoff"), userID, s256ChallengeForTest(code))
	if err != nil {
		t.Fatalf("seed expired handoff: %v", err)
	}
	response := callJSON(t, app, http.MethodPost, "/api/auth/google/native/exchange", map[string]string{"code": "expired-handoff", "codeVerifier": code}, "")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expired handoff exchange status = %d; body=%s", response.Code, response.Body.String())
	}
}

func s256ChallengeForTest(verifier string) string {
	digest := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func googleCallbackRequest(app *App, state string) *http.Request {
	request := httptest.NewRequest(http.MethodGet, "/api/auth/google/callback?code=google-code&state="+url.QueryEscape(state), nil)
	return request.WithContext(context.WithValue(request.Context(), oauth2.HTTPClient, app.httpClient))
}

type testGoogleTransport struct {
	key      *rsa.PrivateKey
	audience string
	nonce    *string
}

func (transport *testGoogleTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	var status int
	var contentType string
	var body []byte
	switch request.URL.Host + request.URL.Path {
	case "oauth2.googleapis.com/token":
		form, err := url.ParseQuery(readTestBody(request))
		if err != nil || form.Get("code") != "google-code" || form.Get("code_verifier") == "" {
			return nil, fmt.Errorf("unexpected Google token request")
		}
		nonce := *transport.nonce
		body, _ = json.Marshal(map[string]any{"access_token": "google-access", "token_type": "Bearer", "expires_in": 3600, "id_token": signedGoogleIDToken(transport.key, transport.audience, nonce)})
		status, contentType = http.StatusOK, "application/json"
	case "www.googleapis.com/oauth2/v3/certs":
		body, _ = json.Marshal(map[string]any{"keys": []any{map[string]any{
			"kid": "test-key", "kty": "RSA", "alg": "RS256", "use": "sig",
			"n": base64.RawURLEncoding.EncodeToString(transport.key.PublicKey.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(transport.key.PublicKey.E)).Bytes()),
		}}})
		status, contentType = http.StatusOK, "application/json"
	default:
		return nil, fmt.Errorf("unexpected Google URL %s", request.URL)
	}
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{contentType}}, Body: io.NopCloser(bytes.NewReader(body)), Request: request}, nil
}

func readTestBody(request *http.Request) string {
	if request.Body == nil {
		return ""
	}
	body, _ := io.ReadAll(request.Body)
	return string(body)
}

func signedGoogleIDToken(key *rsa.PrivateKey, audience, nonce string) string {
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "kid": "test-key", "typ": "JWT"})
	claims, _ := json.Marshal(map[string]any{
		"iss": googleIssuer, "sub": "google-subject", "aud": audience, "exp": time.Now().Add(5 * time.Minute).Unix(),
		"iat": time.Now().Unix(), "nonce": nonce, "email": "native@example.test", "email_verified": true, "name": "Native User",
	})
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	digest := sha256.Sum256([]byte(unsigned))
	signature, _ := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature)
}
