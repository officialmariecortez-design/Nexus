ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS admin_adjusted_pnl NUMERIC(30,10) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS portfolio_adjustments (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  adjustment_type VARCHAR(30) NOT NULL CHECK (adjustment_type IN ('cash','profit_loss')),
  amount NUMERIC(30,10) NOT NULL,
  note TEXT NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_adjustments_account
  ON portfolio_adjustments(account_id, created_at DESC);
