package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

type Job struct {
	ID       string
	UserID   string
	Kind     string
	Payload  json.RawMessage
	Attempts int
}
type Handler func(context.Context, Job) error

func RetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 10 {
		attempt = 10
	}
	d := time.Duration(1<<attempt) * time.Second
	if d > time.Hour {
		return time.Hour
	}
	return d
}
func Enqueue(ctx context.Context, db *pgxpool.Pool, user, kind string, payload any) (string, error) {
	b, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	id := uuid.NewString()
	_, err = db.Exec(ctx, "INSERT INTO work_jobs(id,user_id,kind,payload) VALUES($1,$2,$3,$4)", id, user, kind, json.RawMessage(b))
	return id, err
}
func Run(ctx context.Context, db *pgxpool.Pool, handlers map[string]Handler, limit int) (int, error) {
	owner := uuid.NewString()
	done := 0
	for i := 0; i < limit; i++ {
		var j Job
		err := db.QueryRow(ctx, `UPDATE work_jobs SET state='running',lease_owner=$1,lease_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=(SELECT id FROM work_jobs WHERE (state='queued' AND available_at<=now()) OR (state='running' AND lease_until<now()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,COALESCE(user_id,''),kind,payload,attempts`, owner).Scan(&j.ID, &j.UserID, &j.Kind, &j.Payload, &j.Attempts)
		if err != nil {
			if err.Error() == "no rows in result set" {
				return done, nil
			}
			return done, err
		}
		fn, ok := handlers[j.Kind]
		if !ok {
			err = fmt.Errorf("unsupported job kind")
		} else {
			call, cancel := context.WithTimeout(ctx, 80*time.Second)
			err = fn(call, j)
			cancel()
		}
		if err == nil {
			_, err = db.Exec(ctx, "UPDATE work_jobs SET state='done',lease_until=NULL,lease_owner=NULL WHERE id=$1 AND lease_owner=$2", j.ID, owner)
			if err != nil {
				return done, err
			}
			done++
		} else {
			state := "queued"
			if j.Attempts >= 5 {
				state = "failed"
			}
			_, e := db.Exec(ctx, "UPDATE work_jobs SET state=$3,available_at=$4,lease_until=NULL,lease_owner=NULL,last_error='Job failed; retry or check source configuration.' WHERE id=$1 AND lease_owner=$2", j.ID, owner, state, time.Now().Add(RetryDelay(j.Attempts)))
			if e != nil {
				return done, e
			}
		}
	}
	return done, nil
}
