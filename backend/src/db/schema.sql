CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(40),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_number VARCHAR(40) NOT NULL UNIQUE,
  account_type VARCHAR(40) NOT NULL DEFAULT 'standard',
  base_currency CHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  cash_balance NUMERIC(20,8) NOT NULL DEFAULT 10000,
  realized_pnl NUMERIC(20,8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE TABLE IF NOT EXISTS kyc_profiles (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  legal_name VARCHAR(160) NOT NULL,
  date_of_birth DATE NOT NULL,
  country VARCHAR(100) NOT NULL,
  address_line1 VARCHAR(255) NOT NULL,
  city VARCHAR(120) NOT NULL,
  postal_code VARCHAR(30),
  id_type VARCHAR(50) NOT NULL,
  id_number_hash TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  review_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_profiles(status);

-- Editable public-site content used by the admin dashboard.
CREATE TABLE IF NOT EXISTS site_content (
  page_key VARCHAR(40) PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  subtitle VARCHAR(400) NOT NULL,
  body TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Paper trading tables. These are for simulation/testing only.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS cash_balance NUMERIC(20,8) NOT NULL DEFAULT 10000;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS realized_pnl NUMERIC(20,8) NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE TABLE IF NOT EXISTS paper_positions (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  quantity NUMERIC(30,10) NOT NULL DEFAULT 0,
  average_price NUMERIC(30,10) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, symbol)
);
CREATE TABLE IF NOT EXISTS paper_trades (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  side VARCHAR(4) NOT NULL CHECK(side IN ('buy','sell')),
  quantity NUMERIC(30,10) NOT NULL,
  price NUMERIC(30,10) NOT NULL,
  notional NUMERIC(30,10) NOT NULL,
  realized_pnl NUMERIC(30,10) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'filled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Order idempotency and immutable-ish account activity ledger for the paper engine.
ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS client_order_id UUID;
UPDATE paper_trades SET client_order_id = md5(random()::text || clock_timestamp()::text)::uuid WHERE client_order_id IS NULL;
ALTER TABLE paper_trades ALTER COLUMN client_order_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_paper_trades_account_order ON paper_trades(account_id, client_order_id);
CREATE TABLE IF NOT EXISTS trading_ledger (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_order_id UUID,
  entry_type VARCHAR(40) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  amount NUMERIC(30,10) NOT NULL,
  balance_after NUMERIC(30,10),
  description VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_account_created ON trading_ledger(account_id, created_at DESC);


-- Crypto deposit funding layer. Store public receiving addresses only; never private keys or seed phrases.
CREATE TABLE IF NOT EXISTS deposit_wallets (
  id BIGSERIAL PRIMARY KEY,
  asset VARCHAR(12) NOT NULL,
  network VARCHAR(30) NOT NULL,
  address VARCHAR(255) NOT NULL,
  label VARCHAR(120),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(asset, network)
);
CREATE TABLE IF NOT EXISTS crypto_deposits (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  asset VARCHAR(12) NOT NULL,
  network VARCHAR(30) NOT NULL,
  wallet_address VARCHAR(255) NOT NULL,
  amount NUMERIC(30,10),
  tx_hash VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','under_review','confirmed','rejected')),
  review_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE(network, tx_hash)
);
CREATE INDEX IF NOT EXISTS idx_deposits_account_created ON crypto_deposits(account_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON crypto_deposits(status);


INSERT INTO deposit_wallets(asset,network,address,label,is_active)
VALUES
('BTC','BITCOIN','SET_IN_ADMIN','Bitcoin receiving wallet',FALSE),
('USDT','TRC20','SET_IN_ADMIN','USDT TRC20 receiving wallet',FALSE),
('SOL','SOLANA','SET_IN_ADMIN','Solana receiving wallet',FALSE)
ON CONFLICT (asset,network) DO NOTHING;

-- Admin-controlled dashboard visibility. Governs which dashboard *sections*
-- (price panel, analytics charts, chatbot, individual deposit assets) a
-- signed-in user's tier can see. This never touches balances, positions,
-- P&L or KYC status — those are driven only by the real ledger.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'standard';
CREATE TABLE IF NOT EXISTS feature_visibility (
  tier VARCHAR(20) NOT NULL,
  feature_key VARCHAR(60) NOT NULL,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tier, feature_key)
);

-- Individual dashboard/portfolio visibility overrides.
CREATE TABLE IF NOT EXISTS user_feature_visibility (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key VARCHAR(60) NOT NULL,
  visible BOOLEAN NOT NULL,
  updated_by VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, feature_key)
);
CREATE INDEX IF NOT EXISTS idx_user_feature_visibility_user ON user_feature_visibility(user_id);

-- Controlled pre-launch portfolio adjustments. Every adjustment is audited.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS admin_adjusted_pnl NUMERIC(30,10) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS portfolio_adjustments (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  adjustment_type VARCHAR(30) NOT NULL CHECK(adjustment_type IN ('cash','profit_loss')),
  amount NUMERIC(30,10) NOT NULL,
  note TEXT NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portfolio_adjustments_account ON portfolio_adjustments(account_id, created_at DESC);
