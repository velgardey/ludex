ALTER TABLE oauth_states
  DROP CONSTRAINT oauth_states_client_kind_check;
ALTER TABLE oauth_states
  ADD CONSTRAINT oauth_states_client_kind_check
  CHECK (client_kind IN ('web', 'native', 'native-browser'));
ALTER TABLE oauth_states
  ADD COLUMN app_code_challenge text;

CREATE TABLE oauth_handoffs (
  code_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_handoffs_expiry_idx ON oauth_handoffs(expires_at);

CREATE TABLE native_auth_rate_limits (
  client_key_hash bytea NOT NULL,
  action text NOT NULL CHECK (action IN ('start', 'exchange')),
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (client_key_hash, action, window_start)
);

CREATE TABLE account_exports (
  download_id_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_exports_owner_idx ON account_exports(user_id, expires_at);

CREATE TABLE account_deletion_receipts (
  request_id uuid PRIMARY KEY,
  user_hash bytea NOT NULL,
  requested_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL
);
