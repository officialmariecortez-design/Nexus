-- Nexus: individual dashboard/portfolio visibility overrides.
-- Run in Supabase SQL Editor. This is additive and safe to run more than once.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'standard';

CREATE TABLE IF NOT EXISTS user_feature_visibility (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key VARCHAR(60) NOT NULL,
  visible BOOLEAN NOT NULL,
  updated_by VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_user_feature_visibility_user
  ON user_feature_visibility(user_id);
