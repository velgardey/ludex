CREATE TABLE IF NOT EXISTS connector_accounts (
 id text PRIMARY KEY, user_id text NOT NULL, source text NOT NULL,
 provider_user text NOT NULL, sealed_credential bytea,
 share_completions boolean NOT NULL DEFAULT false,
 presence_audience text NOT NULL DEFAULT 'private',
 last_success timestamptz, last_error text, next_sync timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,source)
);
CREATE TABLE IF NOT EXISTS connector_observations (
 id text PRIMARY KEY, user_id text NOT NULL, source text NOT NULL,
 provider_record text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'needs-review',
 observed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,source,provider_record)
);
CREATE TABLE IF NOT EXISTS import_batches (
 id text PRIMARY KEY,user_id text NOT NULL,source text NOT NULL,rows jsonb NOT NULL,
 status text NOT NULL DEFAULT 'preview',created_at timestamptz NOT NULL DEFAULT now(),
 committed_at timestamptz
);
CREATE TABLE IF NOT EXISTS work_jobs (
 id text PRIMARY KEY,user_id text,kind text NOT NULL,payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued',available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,lease_owner text,attempts integer NOT NULL DEFAULT 0,
 last_error text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_jobs_due ON work_jobs(state,available_at);
CREATE TABLE IF NOT EXISTS shared_plans (
 id text PRIMARY KEY,owner_id text NOT NULL,title text NOT NULL,
 starts_at timestamptz,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plan_members (
 plan_id text NOT NULL REFERENCES shared_plans(id) ON DELETE CASCADE,user_id text NOT NULL,
 rsvp text NOT NULL DEFAULT 'pending',PRIMARY KEY(plan_id,user_id)
);
CREATE TABLE IF NOT EXISTS plan_candidates (
 plan_id text NOT NULL REFERENCES shared_plans(id) ON DELETE CASCADE,title_id text NOT NULL,
 added_by text NOT NULL,PRIMARY KEY(plan_id,title_id)
);
CREATE TABLE IF NOT EXISTS plan_messages (
 id text PRIMARY KEY,plan_id text NOT NULL REFERENCES shared_plans(id) ON DELETE CASCADE,
 user_id text NOT NULL,body text NOT NULL,scope jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notification_inbox (
 id text PRIMARY KEY,user_id text NOT NULL,kind text NOT NULL,body jsonb NOT NULL,
 read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbox_owner ON notification_inbox(user_id,created_at DESC);
