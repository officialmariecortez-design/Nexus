const express = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();
let schemaPromise;

function ensureFundingTables() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS deposit_wallets (
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
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS crypto_deposits (
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
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deposits_account_created ON crypto_deposits(account_id, submitted_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deposits_status ON crypto_deposits(status)`);
    await pool.query(`INSERT INTO deposit_wallets(asset,network,address,label,is_active) VALUES
      ('BTC','BITCOIN','SET_IN_ADMIN','Bitcoin receiving wallet',FALSE),
      ('USDT','TRC20','SET_IN_ADMIN','USDT TRC20 receiving wallet',FALSE),
      ('SOL','SOLANA','SET_IN_ADMIN','Solana receiving wallet',FALSE)
      ON CONFLICT (asset,network) DO NOTHING`);
  })().catch(err => { schemaPromise = null; throw err; });
  return schemaPromise;
}

router.get('/wallets', auth, async (_req, res) => {
  try {
    await ensureFundingTables();
    const result = await pool.query(`SELECT asset, network, address, label FROM deposit_wallets WHERE is_active=true ORDER BY CASE asset WHEN 'BTC' THEN 1 WHEN 'USDT' THEN 2 WHEN 'SOL' THEN 3 ELSE 9 END, network`);
    res.json({ wallets: result.rows });
  } catch (error) {
    console.error('Deposit wallets error:', error);
    res.status(500).json({ error: 'Unable to load deposit options right now.' });
  }
});

router.get('/deposits', auth, async (req, res) => {
  try {
    await ensureFundingTables();
    const result = await pool.query(`SELECT id, asset, network, wallet_address, amount, tx_hash, status, review_note, submitted_at, reviewed_at FROM crypto_deposits WHERE account_id=(SELECT id FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1) ORDER BY submitted_at DESC LIMIT 100`, [req.user.sub]);
    res.json({ deposits: result.rows });
  } catch (error) {
    console.error('Deposit history error:', error);
    res.status(500).json({ error: 'Unable to load deposit history right now.' });
  }
});

router.post('/deposits', auth, async (req, res) => {
  try {
    await ensureFundingTables();
    const asset = String(req.body?.asset || '').trim().toUpperCase();
    const network = String(req.body?.network || '').trim().toUpperCase();
    const txHash = String(req.body?.tx_hash || '').trim();
    const amount = req.body?.amount == null || req.body.amount === '' ? null : Number(req.body.amount);
    if (!['BTC','USDT','SOL'].includes(asset)) return res.status(400).json({ error: 'Select BTC, USDT or SOL.' });
    if (!network) return res.status(400).json({ error: 'Select a deposit network.' });
    if (!txHash || txHash.length > 255) return res.status(400).json({ error: 'Enter a valid transaction hash.' });
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) return res.status(400).json({ error: 'Enter a valid deposit amount.' });
    const wallet = await pool.query(`SELECT address FROM deposit_wallets WHERE asset=$1 AND network=$2 AND is_active=true LIMIT 1`, [asset, network]);
    if (!wallet.rowCount) return res.status(400).json({ error: 'That deposit method is currently unavailable.' });
    const account = await pool.query(`SELECT id FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1`, [req.user.sub]);
    if (!account.rowCount) return res.status(404).json({ error: 'Trading account not found.' });
    const result = await pool.query(`INSERT INTO crypto_deposits(account_id,asset,network,wallet_address,amount,tx_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,asset,network,amount,tx_hash,status,submitted_at`, [account.rows[0].id,asset,network,wallet.rows[0].address,amount,txHash]);
    res.status(201).json({ deposit: result.rows[0], message: 'Deposit submitted for verification. Your trading balance will not be credited until the deposit is confirmed.' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That transaction hash has already been submitted.' });
    console.error('Deposit submission error:', error);
    res.status(500).json({ error: 'Unable to submit your deposit right now.' });
  }
});

module.exports = { router, ensureFundingTables };
