CREATE TABLE IF NOT EXISTS billing_customers (
  account_id TEXT PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  account_id TEXT PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_price_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('beta', 'starter', 'pro', 'enterprise')),
  subscription_state TEXT NOT NULL CHECK (
    subscription_state IN ('inactive', 'beta', 'trialing', 'active', 'past_due', 'canceled')
  ),
  trial_ends_at TIMESTAMPTZ,
  current_period_ends_at TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_subscriptions_customer_idx
  ON billing_subscriptions(stripe_customer_id);

CREATE TABLE IF NOT EXISTS billing_checkout_sessions (
  checkout_session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT NOT NULL,
  url TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'completed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_checkout_sessions_account_idx
  ON billing_checkout_sessions(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS account_entitlements (
  account_id TEXT PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
  access_state TEXT NOT NULL CHECK (
    access_state IN ('inactive', 'beta', 'trialing', 'active', 'past_due', 'canceled')
  ),
  can_generate BOOLEAN NOT NULL,
  can_use_evidence BOOLEAN NOT NULL,
  requires_upgrade BOOLEAN NOT NULL,
  message TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_magic_links (
  magic_link_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS auth_magic_links_email_idx
  ON auth_magic_links(email, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_device_codes (
  device_code TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  client TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  account_id TEXT REFERENCES accounts(account_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS auth_device_codes_user_code_idx
  ON auth_device_codes(user_code);

CREATE INDEX IF NOT EXISTS auth_device_codes_account_idx
  ON auth_device_codes(account_id, created_at DESC);
