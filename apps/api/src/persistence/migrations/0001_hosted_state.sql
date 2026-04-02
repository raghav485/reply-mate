CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL CHECK (plan IN ('beta', 'starter', 'pro', 'enterprise')),
  subscription_state TEXT NOT NULL CHECK (
    subscription_state IN ('inactive', 'beta', 'trialing', 'active', 'past_due', 'canceled')
  ),
  beta_access BOOLEAN NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS sessions_account_id_idx ON sessions(account_id);
CREATE INDEX IF NOT EXISTS sessions_refresh_token_hash_idx ON sessions(refresh_token_hash);

CREATE TABLE IF NOT EXISTS account_preferences (
  account_id TEXT PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
  default_tone_preset TEXT NOT NULL CHECK (
    default_tone_preset IN ('professional', 'friendly', 'concise', 'empathetic', 'confident')
  ),
  default_cost_mode TEXT NOT NULL CHECK (
    default_cost_mode IN ('local_only', 'hybrid_low_cost', 'cloud_quality')
  ),
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_jobs (
  job_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('context_only', 'intended_attachment')),
  mention_in_reply BOOLEAN NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'processing', 'ready', 'failed')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  result_json JSONB,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS evidence_jobs_account_created_idx
  ON evidence_jobs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS evidence_jobs_incomplete_idx
  ON evidence_jobs(state, created_at ASC);

CREATE TABLE IF NOT EXISTS generation_records (
  generation_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  site_id TEXT NOT NULL CHECK (site_id IN ('slack_web', 'gmail_web', 'generic_web')),
  action_mode TEXT NOT NULL CHECK (
    action_mode IN (
      'improve_current_draft',
      'draft_from_context',
      'reply_from_scratch',
      'make_shorter',
      'make_more_professional',
      'make_more_empathetic'
    )
  ),
  tone_preset TEXT NOT NULL CHECK (
    tone_preset IN ('professional', 'friendly', 'concise', 'empathetic', 'confident')
  ),
  provider_path TEXT NOT NULL CHECK (provider_path IN ('local_model', 'cloud')),
  warning_count INTEGER NOT NULL,
  used_voice_input BOOLEAN NOT NULL,
  context_scope_used TEXT NOT NULL CHECK (
    context_scope_used IN ('thread', 'channel', 'page', 'mixed', 'none')
  ),
  evidence_ids_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  primary_draft TEXT NOT NULL,
  alternate_draft TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS generation_records_account_created_idx
  ON generation_records(account_id, created_at DESC);
