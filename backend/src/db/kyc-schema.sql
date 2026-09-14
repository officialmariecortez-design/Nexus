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
