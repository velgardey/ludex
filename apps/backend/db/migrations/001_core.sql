CREATE TABLE users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  email text,
  bio text NOT NULL DEFAULT '',
  roles text[] NOT NULL DEFAULT ARRAY['user']::text[],
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE google_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text,
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject),
  UNIQUE (user_id, issuer)
);

CREATE INDEX google_identities_user_idx ON google_identities(user_id);

CREATE TABLE local_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_normalized text NOT NULL UNIQUE,
  salt bytea NOT NULL,
  password_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invitations (
  code_hash bytea PRIMARY KEY,
  uses_limit integer NOT NULL DEFAULT 1 CHECK (uses_limit > 0),
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= uses_limit),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  client_kind text NOT NULL DEFAULT 'native' CHECK (client_kind IN ('native', 'web', 'local'))
);

CREATE INDEX sessions_user_expiry_idx ON sessions(user_id, expires_at DESC);

CREATE TABLE oauth_states (
  state_hash bytea PRIMARY KEY,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  invite_code_hash bytea,
  client_kind text NOT NULL CHECK (client_kind IN ('web', 'native')),
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE titles (
  id text PRIMARY KEY,
  media text NOT NULL CHECK (media IN ('movie', 'show', 'game')),
  title text NOT NULL,
  provider_ids jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_ids) = 'object'),
  episodes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(episodes) = 'array'),
  body jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(body) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  region char(2) NOT NULL DEFAULT 'US' CHECK (region ~ '^[A-Z]{2}$'),
  time_zone text NOT NULL DEFAULT 'UTC',
  default_audience text NOT NULL DEFAULT 'private' CHECK (default_audience IN ('private', 'public', 'friends')),
  low_data boolean NOT NULL DEFAULT false,
  reduced_motion boolean NOT NULL DEFAULT false,
  haptics boolean NOT NULL DEFAULT true,
  notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(notification_preferences) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE library_entries (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id text NOT NULL REFERENCES titles(id),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  state text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'active', 'paused', 'dropped', 'completed')),
  rating smallint CHECK (rating BETWEEN 1 AND 10),
  liked boolean,
  note text,
  owned boolean,
  archived boolean,
  played_on date,
  emulator text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, title_id)
);

CREATE INDEX library_entries_user_updated_idx ON library_entries(user_id, updated_at DESC, title_id);

CREATE TABLE library_runs (
  user_id uuid NOT NULL,
  title_id text NOT NULL,
  run_id text NOT NULL,
  movie_viewed boolean NOT NULL DEFAULT false,
  story_completed boolean NOT NULL DEFAULT false,
  minutes integer NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  session_active boolean NOT NULL DEFAULT false,
  played_on date,
  emulator text,
  PRIMARY KEY (user_id, title_id, run_id),
  FOREIGN KEY (user_id, title_id) REFERENCES library_entries(user_id, title_id) ON DELETE CASCADE
);

CREATE TABLE run_episode_progress (
  user_id uuid NOT NULL,
  title_id text NOT NULL,
  run_id text NOT NULL,
  episode_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('watched', 'skipped')),
  PRIMARY KEY (user_id, title_id, run_id, episode_id),
  FOREIGN KEY (user_id, title_id, run_id) REFERENCES library_runs(user_id, title_id, run_id) ON DELETE CASCADE
);

CREATE TABLE run_milestones (
  user_id uuid NOT NULL,
  title_id text NOT NULL,
  run_id text NOT NULL,
  milestone_id text NOT NULL,
  label text NOT NULL,
  PRIMARY KEY (user_id, title_id, run_id, milestone_id),
  FOREIGN KEY (user_id, title_id, run_id) REFERENCES library_runs(user_id, title_id, run_id) ON DELETE CASCADE
);

CREATE TABLE game_achievements (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id text NOT NULL REFERENCES titles(id),
  provider_game_id text NOT NULL,
  achievement_id text NOT NULL,
  mode text NOT NULL DEFAULT 'casual' CHECK (mode IN ('casual', 'hardcore')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, title_id, provider_game_id, achievement_id, mode)
);

CREATE TABLE progress_events (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  title_id text NOT NULL REFERENCES titles(id),
  command_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  active boolean NOT NULL DEFAULT true,
  change jsonb NOT NULL CHECK (jsonb_typeof(change) = 'object'),
  command jsonb NOT NULL CHECK (jsonb_typeof(command) = 'object'),
  occurred_at jsonb NOT NULL CHECK (jsonb_typeof(occurred_at) = 'object'),
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id),
  UNIQUE (user_id, command_id),
  UNIQUE (user_id, title_id, sequence)
);

CREATE INDEX progress_events_replay_idx ON progress_events(user_id, title_id, sequence);

CREATE TABLE progress_corrections (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  correction_id text NOT NULL,
  target_event_id text NOT NULL,
  command_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, correction_id),
  UNIQUE (user_id, command_id),
  FOREIGN KEY (user_id, target_event_id) REFERENCES progress_events(user_id, event_id)
);

CREATE TABLE library_edit_events (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  title_id text NOT NULL REFERENCES titles(id),
  command_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  patch jsonb NOT NULL CHECK (jsonb_typeof(patch) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id),
  UNIQUE (user_id, command_id),
  UNIQUE (user_id, title_id, sequence)
);

CREATE TABLE command_receipts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command_id text NOT NULL,
  payload_hash bytea NOT NULL,
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, command_id)
);

CREATE TABLE follows (
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, target_id),
  CHECK (follower_id <> target_id)
);

CREATE INDEX follows_target_idx ON follows(target_id, follower_id);

CREATE TABLE friendships (
  user_low uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low, user_high),
  CHECK (user_low < user_high),
  CHECK (requested_by IN (user_low, user_high))
);

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE circles (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE circle_members (
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, user_id)
);

CREATE TABLE showcases (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  theme text NOT NULL DEFAULT 'lounge' CHECK (theme IN ('lounge', 'matinee', 'midnight')),
  featured_title_id text REFERENCES titles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE showcase_shelves (
  user_id uuid NOT NULL REFERENCES showcases(user_id) ON DELETE CASCADE,
  shelf_id text NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
  layout text NOT NULL CHECK (layout IN ('covers', 'spread', 'milestones')),
  audience_kind text NOT NULL CHECK (audience_kind IN ('private', 'public', 'friends', 'circle')),
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (user_id, shelf_id),
  CHECK ((audience_kind = 'circle') = (circle_id IS NOT NULL))
);

CREATE TABLE showcase_shelf_items (
  user_id uuid NOT NULL,
  shelf_id text NOT NULL,
  title_id text NOT NULL REFERENCES titles(id),
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (user_id, shelf_id, title_id),
  UNIQUE (user_id, shelf_id, position),
  FOREIGN KEY (user_id, shelf_id) REFERENCES showcase_shelves(user_id, shelf_id) ON DELETE CASCADE
);

CREATE TABLE collections (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  description text,
  audience_kind text NOT NULL CHECK (audience_kind IN ('private', 'public', 'friends', 'circle')),
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((audience_kind = 'circle') = (circle_id IS NOT NULL))
);

CREATE INDEX collections_owner_updated_idx ON collections(user_id, updated_at DESC);

CREATE TABLE collection_titles (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  title_id text NOT NULL REFERENCES titles(id),
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (collection_id, title_id),
  UNIQUE (collection_id, position)
);

CREATE TABLE activities (
  id text PRIMARY KEY,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id text NOT NULL REFERENCES titles(id),
  caption text NOT NULL,
  note text,
  rating smallint CHECK (rating BETWEEN 1 AND 10),
  audience_kind text NOT NULL CHECK (audience_kind IN ('private', 'public', 'friends', 'circle')),
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  spoiler_kind text NOT NULL CHECK (spoiler_kind IN ('none', 'episodes', 'milestone', 'hidden')),
  spoiler_title_id text,
  required_spoiler_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(required_spoiler_ids) = 'array'),
  occurred_at jsonb NOT NULL CHECK (jsonb_typeof(occurred_at) = 'object'),
  published_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('progress', 'review')),
  progress_event_id text,
  draft_id text,
  retracted boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  payload_hash bytea,
  FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
  CHECK ((audience_kind = 'circle') = (circle_id IS NOT NULL)),
  CHECK ((spoiler_kind = 'none') = (spoiler_title_id IS NULL)),
  CHECK (kind <> 'progress' OR progress_event_id IS NOT NULL)
);

CREATE INDEX activities_feed_idx ON activities(published_at DESC, id DESC) WHERE NOT retracted;
CREATE INDEX activities_author_idx ON activities(author_id, published_at DESC, id DESC);

CREATE TABLE activity_reactions (
  activity_id text NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);

CREATE TABLE activity_replies (
  id text PRIMARY KEY,
  activity_id text NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command_id text NOT NULL,
  payload_hash bytea NOT NULL,
  text text NOT NULL CHECK (length(text) <= 2000),
  spoiler_kind text NOT NULL CHECK (spoiler_kind IN ('none', 'episodes', 'milestone', 'hidden')),
  spoiler_title_id text,
  required_spoiler_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(required_spoiler_ids) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (activity_id, user_id, command_id)
);

CREATE TABLE review_drafts (
  id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id text NOT NULL REFERENCES titles(id),
  text text NOT NULL CHECK (length(text) <= 10000),
  rating smallint CHECK (rating BETWEEN 1 AND 10),
  version bigint NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE reports (
  id uuid PRIMARY KEY,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('spam', 'harassment', 'spoiler', 'other')),
  note text CHECK (length(note) <= 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'removed', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE moderation_audit (
  id uuid PRIMARY KEY,
  moderator_id uuid NOT NULL REFERENCES users(id),
  target_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('remove', 'suspend')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

INSERT INTO account_policy(singleton, revision) VALUES (true, 0);
