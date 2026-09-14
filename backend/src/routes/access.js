const express = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const { adminAuth } = require('./admin');

const router = express.Router();

const TIERS = ['standard', 'verified', 'vip'];
const FEATURES = [
  { key: 'crypto_prices', label: 'Live crypto price panel (CoinMarketCap)' },
  { key: 'analytics_charts', label: 'TradingView analytics charts' },
  { key: 'ai_chatbot', label: 'AI support chatbot' },
  { key: 'deposits_btc', label: 'BTC deposits' },
  { key: 'deposits_usdt', label: 'USDT deposits' },
  { key: 'deposits_sol', label: 'SOL deposits' },
  { key: 'demo_trading', label: 'Demo trading workspace' },
  { key: 'portfolio_summary', label: 'Portfolio summary / balances' },
  { key: 'open_positions', label: 'Open positions' },
  { key: 'trade_history', label: 'Trade history' },
  { key: 'funding_history', label: 'Funding / deposit history' }
];

let schemaPromise;
function defaultFeatures() { return Object.fromEntries(FEATURES.map(f => [f.key, true])); }
async function ensureAccessTables() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'standard'`);
    await pool.query(`CREATE TABLE IF NOT EXISTS feature_visibility (
      tier VARCHAR(20) NOT NULL,
      feature_key VARCHAR(60) NOT NULL,
      visible BOOLEAN NOT NULL DEFAULT TRUE,
      updated_by VARCHAR(255),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tier, feature_key)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_feature_visibility (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      feature_key VARCHAR(60) NOT NULL,
      visible BOOLEAN NOT NULL,
      updated_by VARCHAR(255),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, feature_key)
    )`);
    for (const tier of TIERS) for (const feature of FEATURES) {
      await pool.query(`INSERT INTO feature_visibility(tier, feature_key, visible) VALUES ($1,$2,TRUE) ON CONFLICT (tier, feature_key) DO NOTHING`, [tier, feature.key]);
    }
  })().catch(err => { schemaPromise = null; throw err; });
  return schemaPromise;
}

// Effective access for the signed-in user. Individual overrides take precedence over tier defaults.
router.get('/me', auth, async (req, res) => {
  try {
    await ensureAccessTables();
    const userResult = await pool.query('SELECT tier FROM users WHERE id=$1 LIMIT 1', [req.user.sub]);
    const tier = TIERS.includes(userResult.rows[0]?.tier) ? userResult.rows[0].tier : 'standard';
    const [tierRows, userRows] = await Promise.all([
      pool.query('SELECT feature_key, visible FROM feature_visibility WHERE tier=$1', [tier]),
      pool.query('SELECT feature_key, visible FROM user_feature_visibility WHERE user_id=$1', [req.user.sub])
    ]);
    const features = defaultFeatures();
    for (const row of tierRows.rows) features[row.feature_key] = row.visible;
    for (const row of userRows.rows) features[row.feature_key] = row.visible;
    res.json({ tier, features, overrides: userRows.rows.map(r => r.feature_key) });
  } catch (error) {
    console.error('Access lookup error:', error);
    res.json({ tier: 'standard', features: defaultFeatures(), overrides: [] });
  }
});

router.get('/admin/matrix', adminAuth, async (_req, res) => {
  try {
    await ensureAccessTables();
    const rows = await pool.query('SELECT tier, feature_key, visible FROM feature_visibility');
    const matrix = Object.fromEntries(TIERS.map(t => [t, defaultFeatures()]));
    for (const row of rows.rows) if (matrix[row.tier]) matrix[row.tier][row.feature_key] = row.visible;
    res.json({ tiers: TIERS, features: FEATURES, matrix });
  } catch (error) {
    console.error('Admin access matrix error:', error);
    res.status(500).json({ error: 'Unable to load dashboard access settings' });
  }
});

router.put('/admin/matrix', adminAuth, async (req, res) => {
  const tier = String(req.body?.tier || '');
  const featureKey = String(req.body?.feature_key || '');
  const visible = req.body?.visible !== false;
  if (!TIERS.includes(tier)) return res.status(400).json({ error: 'Unknown tier' });
  if (!FEATURES.some(f => f.key === featureKey)) return res.status(400).json({ error: 'Unknown feature' });
  try {
    await ensureAccessTables();
    await pool.query(`INSERT INTO feature_visibility(tier, feature_key, visible, updated_by, updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (tier, feature_key) DO UPDATE SET visible=$3, updated_by=$4, updated_at=NOW()`, [tier, featureKey, visible, req.admin.email]);
    res.json({ tier, feature_key: featureKey, visible });
  } catch (error) { console.error('Admin access update error:', error); res.status(500).json({ error: 'Unable to update dashboard access setting' }); }
});

router.put('/admin/users/:id/tier', adminAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10), tier = String(req.body?.tier || '');
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid user ID' });
  if (!TIERS.includes(tier)) return res.status(400).json({ error: 'Unknown tier' });
  try { await ensureAccessTables(); const result = await pool.query('UPDATE users SET tier=$1 WHERE id=$2 RETURNING id, tier', [tier,id]); if (!result.rowCount) return res.status(404).json({error:'User not found'}); res.json({user:result.rows[0]}); }
  catch(e){ console.error(e); res.status(500).json({error:'Unable to update user tier'}); }
});

// Admin: read one user's effective access and explicit overrides.
router.get('/admin/users/:id', adminAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid user ID' });
  try {
    await ensureAccessTables();
    const user = await pool.query('SELECT id, username, full_name, email, tier FROM users WHERE id=$1', [id]);
    if (!user.rowCount) return res.status(404).json({ error: 'User not found' });
    const tier = TIERS.includes(user.rows[0].tier) ? user.rows[0].tier : 'standard';
    const [tierRows, overrides] = await Promise.all([
      pool.query('SELECT feature_key, visible FROM feature_visibility WHERE tier=$1', [tier]),
      pool.query('SELECT feature_key, visible FROM user_feature_visibility WHERE user_id=$1', [id])
    ]);
    const effective = defaultFeatures();
    for (const row of tierRows.rows) effective[row.feature_key] = row.visible;
    for (const row of overrides.rows) effective[row.feature_key] = row.visible;
    const overrideMap = Object.fromEntries(overrides.rows.map(r => [r.feature_key, r.visible]));
    res.json({ user:user.rows[0], features:FEATURES, effective, overrides:overrideMap });
  } catch(e){ console.error('Admin user access lookup error:',e); res.status(500).json({error:'Unable to load user dashboard access'}); }
});

// Admin: set or clear an individual user's feature override.
router.put('/admin/users/:id/features', adminAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const featureKey = String(req.body?.feature_key || '');
  const mode = String(req.body?.mode || 'override');
  const visible = req.body?.visible !== false;
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({error:'Invalid user ID'});
  if (!FEATURES.some(f => f.key === featureKey)) return res.status(400).json({error:'Unknown feature'});
  if (!['override','inherit'].includes(mode)) return res.status(400).json({error:'Mode must be override or inherit'});
  try {
    await ensureAccessTables();
    const exists = await pool.query('SELECT id FROM users WHERE id=$1', [id]);
    if (!exists.rowCount) return res.status(404).json({error:'User not found'});
    if (mode === 'inherit') {
      await pool.query('DELETE FROM user_feature_visibility WHERE user_id=$1 AND feature_key=$2', [id,featureKey]);
      return res.json({user_id:id, feature_key:featureKey, mode:'inherit'});
    }
    await pool.query(`INSERT INTO user_feature_visibility(user_id,feature_key,visible,updated_by,updated_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(user_id,feature_key) DO UPDATE SET visible=$3,updated_by=$4,updated_at=NOW()`, [id,featureKey,visible,req.admin.email]);
    res.json({user_id:id, feature_key:featureKey, visible, mode:'override'});
  } catch(e){ console.error('Admin user feature update error:',e); res.status(500).json({error:'Unable to update individual dashboard access'}); }
});

module.exports = { router, TIERS, FEATURES };
