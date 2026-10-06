CREATE TABLE assistant_conversations (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assistant_messages (
    id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    request_id text NOT NULL,
    role text NOT NULL CHECK (role IN ('user', 'assistant')),
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 12000),
    citations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(citations) = 'array'),
    fallback boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, request_id, role)
);

CREATE INDEX assistant_messages_history_idx
    ON assistant_messages (conversation_id, created_at DESC, id DESC);

CREATE TABLE assistant_requests (
    id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    request_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
    user_message_id uuid NOT NULL REFERENCES assistant_messages(id),
    assistant_message_id uuid REFERENCES assistant_messages(id),
    failure_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (conversation_id, request_id)
);

CREATE TABLE assistant_action_proposals (
    id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id uuid NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
    label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
    summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 500),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    payload_hash text NOT NULL,
    target_version integer NOT NULL CHECK (target_version >= 0),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirming', 'confirmed', 'rejected', 'expired')),
    expires_at timestamptz NOT NULL,
    confirmation_lease_until timestamptz,
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz,
    rejected_at timestamptz
);

CREATE INDEX assistant_action_owner_idx
    ON assistant_action_proposals (user_id, status, expires_at);

CREATE TABLE assistant_budget_windows (
    scope_key text NOT NULL CHECK (scope_key = 'shared' OR scope_key LIKE 'user:%'),
    window_start date NOT NULL,
    reserved_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
    spent_micros bigint NOT NULL DEFAULT 0 CHECK (spent_micros >= 0),
    PRIMARY KEY (scope_key, window_start)
);

CREATE TABLE assistant_budget_reservations (
    id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    request_id text NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    call_kind text NOT NULL CHECK (call_kind IN ('responses', 'embeddings')),
    window_start date NOT NULL,
    month_start date NOT NULL,
    reserved_micros bigint NOT NULL CHECK (reserved_micros > 0),
    actual_micros bigint CHECK (actual_micros >= 0),
    status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'finalized')),
    created_at timestamptz NOT NULL DEFAULT now(),
    finalized_at timestamptz,
    UNIQUE (conversation_id, request_id, call_kind, window_start)
);

CREATE TABLE assistant_monthly_usage (
    scope_key text NOT NULL CHECK (scope_key = 'shared' OR scope_key LIKE 'user:%'),
    month_start date NOT NULL,
    reserved_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
    spent_micros bigint NOT NULL DEFAULT 0 CHECK (spent_micros >= 0),
    response_count integer NOT NULL DEFAULT 0 CHECK (response_count >= 0),
    PRIMARY KEY (scope_key, month_start)
);

CREATE TABLE assistant_embeddings (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id text NOT NULL,
    content_hash text NOT NULL,
    deployment text NOT NULL,
    dimensions integer NOT NULL CHECK (dimensions > 0),
    vector jsonb NOT NULL CHECK (jsonb_typeof(vector) = 'array'),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, document_id, deployment)
);
