package companion

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrAllowanceExhausted   = errors.New("assistant allowance exhausted")
	ErrAllowanceUnavailable = errors.New("assistant pricing or budget limits are not configured")
	ErrBudgetDuplicate      = errors.New("assistant request already has a budget reservation")
)

type budgetStore struct {
	db     *pgxpool.Pool
	limits Limits
}

func newBudgetStore(db *pgxpool.Pool, limits Limits) *budgetStore {
	return &budgetStore{db: db, limits: limits}
}

func (b *budgetStore) responsesEnabled() bool {
	return b != nil && b.db != nil && b.limits.UserDailyMicros > 0 && b.limits.SharedDailyMicros > 0 &&
		b.limits.ResponsesInputMicrosPerMillion > 0 && b.limits.ResponsesOutputMicrosPerMillion > 0 &&
		b.limits.MonthlyResponsesPerUser > 0 && b.limits.MonthlyBudgetMicros > 0 &&
		b.limits.MaxContextTokens > 0 && b.limits.MaxOutputTokens > 0
}

func (b *budgetStore) embeddingsEnabled() bool {
	return b != nil && b.db != nil && b.limits.UserDailyMicros > 0 && b.limits.SharedDailyMicros > 0 &&
		b.limits.EmbeddingMicrosPerMillion > 0 && b.limits.MonthlyBudgetMicros > 0 && b.limits.MaxContextTokens > 0
}

func (b *budgetStore) reserve(ctx context.Context, userID, requestID, callKind string, inputTokens, outputTokens int, inputRate, outputRate int64) (string, error) {
	if b == nil || b.db == nil || b.limits.UserDailyMicros <= 0 || b.limits.SharedDailyMicros <= 0 || b.limits.MonthlyBudgetMicros <= 0 || inputRate <= 0 || inputTokens <= 0 {
		return "", ErrAllowanceUnavailable
	}
	if callKind != "responses" && callKind != "embeddings" {
		return "", errors.New("unsupported assistant call kind")
	}
	if outputTokens < 0 || (callKind == "embeddings" && outputTokens != 0) {
		return "", errors.New("invalid token reservation")
	}
	reserved, err := tokenCostMicros(inputTokens, inputRate, outputTokens, outputRate)
	if err != nil {
		return "", err
	}
	if reserved <= 0 {
		return "", ErrAllowanceUnavailable
	}
	window := time.Now().UTC().Format("2006-01-02")
	month := time.Now().UTC().Format("2006-01") + "-01"
	userKey := "user:" + userID

	tx, err := b.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var conversationID string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM assistant_conversations WHERE user_id = $1`, userID).Scan(&conversationID); err != nil {
		return "", err
	}
	var existing string
	err = tx.QueryRow(ctx, `SELECT id::text FROM assistant_budget_reservations WHERE conversation_id = $1 AND request_id = $2 AND call_kind = $3 AND window_start = $4`, conversationID, requestID, callKind, window).Scan(&existing)
	if err == nil {
		return "", ErrBudgetDuplicate
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if callKind == "responses" && b.limits.MonthlyResponsesPerUser <= 0 {
		return "", ErrAllowanceUnavailable
	}
	if _, err := tx.Exec(ctx, `INSERT INTO assistant_budget_windows(scope_key, window_start) VALUES ('shared', $1), ($2, $1) ON CONFLICT DO NOTHING`, window, userKey); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO assistant_monthly_usage(scope_key, month_start) VALUES ('shared', $1), ($2, $1) ON CONFLICT DO NOTHING`, month, userKey); err != nil {
		return "", err
	}
	rows, err := tx.Query(ctx, `SELECT scope_key, reserved_micros, spent_micros FROM assistant_budget_windows WHERE window_start = $1 AND scope_key = ANY($2::text[]) ORDER BY scope_key FOR UPDATE`, window, []string{"shared", userKey})
	if err != nil {
		return "", err
	}
	windows := make(map[string][2]int64, 2)
	for rows.Next() {
		var scope string
		var reservedMicros, spentMicros int64
		if err := rows.Scan(&scope, &reservedMicros, &spentMicros); err != nil {
			rows.Close()
			return "", err
		}
		windows[scope] = [2]int64{reservedMicros, spentMicros}
	}
	rowsErr := rows.Err()
	rows.Close()
	if rowsErr != nil {
		return "", rowsErr
	}
	if len(windows) != 2 {
		return "", errors.New("assistant budget window rows missing after reservation lock")
	}
	monthRows, err := tx.Query(ctx, `SELECT scope_key, reserved_micros, spent_micros, response_count FROM assistant_monthly_usage WHERE month_start = $1 AND scope_key = ANY($2::text[]) ORDER BY scope_key FOR UPDATE`, month, []string{"shared", userKey})
	if err != nil {
		return "", err
	}
	monthly := make(map[string][3]int64, 2)
	for monthRows.Next() {
		var scope string
		var reservedMicros, spentMicros, responseCount int64
		if err := monthRows.Scan(&scope, &reservedMicros, &spentMicros, &responseCount); err != nil {
			monthRows.Close()
			return "", err
		}
		monthly[scope] = [3]int64{reservedMicros, spentMicros, responseCount}
	}
	monthRowsErr := monthRows.Err()
	monthRows.Close()
	if monthRowsErr != nil {
		return "", monthRowsErr
	}
	if len(monthly) != 2 {
		return "", errors.New("assistant monthly usage rows missing after reservation lock")
	}
	if !canReserve(windows["shared"], reserved, b.limits.SharedDailyMicros) ||
		!canReserve(windows[userKey], reserved, b.limits.UserDailyMicros) ||
		!canReserve([2]int64{monthly["shared"][0], monthly["shared"][1]}, reserved, b.limits.MonthlyBudgetMicros) {
		return "", ErrAllowanceExhausted
	}
	if callKind == "responses" && monthly[userKey][2] >= int64(b.limits.MonthlyResponsesPerUser) {
		return "", ErrAllowanceExhausted
	}
	id := uuid.NewString()
	if _, err := tx.Exec(ctx, `
		UPDATE assistant_budget_windows
		SET reserved_micros = reserved_micros + $3
		WHERE window_start = $1 AND scope_key = ANY($2::text[])`, window, []string{"shared", userKey}, reserved); err != nil {
		return "", err
	}
	if callKind == "responses" {
		if _, err := tx.Exec(ctx, `UPDATE assistant_monthly_usage SET response_count = response_count + 1 WHERE month_start = $1 AND scope_key = $2`, month, userKey); err != nil {
			return "", err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE assistant_monthly_usage SET reserved_micros = reserved_micros + $3 WHERE month_start = $1 AND scope_key = $2`, month, "shared", reserved); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO assistant_budget_reservations(id, conversation_id, request_id, user_id, call_kind, window_start, month_start, reserved_micros)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, id, conversationID, requestID, userID, callKind, window, month, reserved); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}

func (b *budgetStore) finalize(ctx context.Context, reservationID string, inputTokens, outputTokens int, inputRate, outputRate int64) error {
	actual, err := tokenCostMicros(inputTokens, inputRate, outputTokens, outputRate)
	if err != nil {
		return err
	}
	tx, err := b.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var (
		userID, window, month, conversationID string
		reserved                              int64
		status                                string
	)
	if err := tx.QueryRow(ctx, `SELECT user_id::text, window_start::text, month_start::text, conversation_id::text, reserved_micros, status FROM assistant_budget_reservations WHERE id = $1 FOR UPDATE`, reservationID).Scan(&userID, &window, &month, &conversationID, &reserved, &status); err != nil {
		return err
	}
	if status == "finalized" {
		return tx.Commit(ctx)
	}
	if actual > reserved {
		// Keep the full reservation if the provider reports more usage than our
		// configured maximum; releasing it would undercount a potentially billed call.
		return fmt.Errorf("provider usage exceeded reserved assistant budget")
	}
	userKey := "user:" + userID
	if _, err := tx.Exec(ctx, `
		UPDATE assistant_budget_windows
		SET reserved_micros = reserved_micros - $3, spent_micros = spent_micros + $4
		WHERE window_start = $1 AND scope_key = ANY($2::text[]) AND reserved_micros >= $3`, window, []string{"shared", userKey}, reserved, actual); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE assistant_monthly_usage SET reserved_micros = reserved_micros - $2, spent_micros = spent_micros + $3 WHERE month_start = $1 AND scope_key = 'shared' AND reserved_micros >= $2`, month, reserved, actual); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE assistant_budget_reservations
		SET status = 'finalized', actual_micros = $2, finalized_at = now()
		WHERE id = $1`, reservationID, actual); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (b *budgetStore) allowance(ctx context.Context, userID string) (*Allowance, error) {
	if b == nil || b.db == nil || b.limits.UserDailyMicros <= 0 || b.limits.SharedDailyMicros <= 0 || b.limits.MonthlyBudgetMicros <= 0 {
		return nil, nil
	}
	window := time.Now().UTC().Format("2006-01-02")
	month := time.Now().UTC().Format("2006-01") + "-01"
	userKey := "user:" + userID
	var sharedReserved, sharedSpent, userReserved, userSpent, monthlyReserved, monthlySpent, monthlyReplies int64
	err := b.db.QueryRow(ctx, `
		SELECT
			COALESCE((SELECT reserved_micros FROM assistant_budget_windows WHERE scope_key = 'shared' AND window_start = $1), 0),
			COALESCE((SELECT spent_micros FROM assistant_budget_windows WHERE scope_key = 'shared' AND window_start = $1), 0),
			COALESCE((SELECT reserved_micros FROM assistant_budget_windows WHERE scope_key = $2 AND window_start = $1), 0),
			COALESCE((SELECT spent_micros FROM assistant_budget_windows WHERE scope_key = $2 AND window_start = $1), 0),
			COALESCE((SELECT reserved_micros FROM assistant_monthly_usage WHERE scope_key = 'shared' AND month_start = $3), 0),
			COALESCE((SELECT spent_micros FROM assistant_monthly_usage WHERE scope_key = 'shared' AND month_start = $3), 0),
			COALESCE((SELECT response_count FROM assistant_monthly_usage WHERE scope_key = $2 AND month_start = $3), 0)`, window, userKey, month).Scan(&sharedReserved, &sharedSpent, &userReserved, &userSpent, &monthlyReserved, &monthlySpent, &monthlyReplies)
	if err != nil {
		return nil, err
	}
	sharedRemaining := b.limits.SharedDailyMicros - sharedReserved - sharedSpent
	userRemaining := b.limits.UserDailyMicros - userReserved - userSpent
	monthlyRemaining := b.limits.MonthlyBudgetMicros - monthlyReserved - monthlySpent
	remaining := min(sharedRemaining, userRemaining, monthlyRemaining)
	limit := min(b.limits.SharedDailyMicros, b.limits.UserDailyMicros, b.limits.MonthlyBudgetMicros)
	if b.limits.MonthlyResponsesPerUser > 0 && monthlyReplies >= int64(b.limits.MonthlyResponsesPerUser) {
		remaining = 0
	}
	if remaining < 0 {
		remaining = 0
	}
	now := time.Now().UTC()
	reset := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
	if monthlyRemaining <= 0 || b.limits.MonthlyResponsesPerUser > 0 && monthlyReplies >= int64(b.limits.MonthlyResponsesPerUser) {
		reset = time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC)
	}
	return &Allowance{Remaining: microsToUSD(remaining), Limit: microsToUSD(limit), ResetsAt: reset.Format(time.RFC3339)}, nil
}

func canReserve(window [2]int64, amount, cap int64) bool {
	if cap <= 0 || amount <= 0 || window[0] < 0 || window[1] < 0 {
		return false
	}
	return amount <= cap-window[0]-window[1]
}

func tokenCostMicros(inputTokens int, inputRate int64, outputTokens int, outputRate int64) (int64, error) {
	if inputTokens < 0 || outputTokens < 0 || inputRate < 0 || outputRate < 0 {
		return 0, errors.New("negative assistant usage or pricing")
	}
	in := mulDivCeil(int64(inputTokens), inputRate, 1_000_000)
	out := mulDivCeil(int64(outputTokens), outputRate, 1_000_000)
	if in < 0 || out < 0 || in > int64(^uint64(0)>>1)-out {
		return 0, errors.New("assistant usage cost overflow")
	}
	return in + out, nil
}

func mulDivCeil(value, rate, divisor int64) int64 {
	if value == 0 || rate == 0 {
		return 0
	}
	product := new(big.Int).Mul(big.NewInt(value), big.NewInt(rate))
	denominator := big.NewInt(divisor)
	product.Add(product, new(big.Int).Sub(denominator, big.NewInt(1)))
	product.Div(product, denominator)
	if !product.IsInt64() {
		return -1
	}
	return product.Int64()
}

func microsToUSD(value int64) float64 { return float64(value) / 1_000_000 }

var _ pgx.Tx = (pgx.Tx)(nil)
