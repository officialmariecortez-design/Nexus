const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const router = express.Router();

function issueAdminToken(admin) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ sub: 'admin', email: admin.email, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '8h' });
}

function adminAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !process.env.JWT_SECRET) return res.status(401).json({ error: 'Admin authentication required' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired admin session' });
  }
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if (!adminEmail || !adminPassword) return res.status(503).json({ error: 'Admin credentials are not configured. Add ADMIN_EMAIL and ADMIN_PASSWORD in Vercel.' });
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (String(email).trim().toLowerCase() !== adminEmail || String(password) !== adminPassword) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }
  res.json({ token: issueAdminToken({ email: adminEmail }), admin: { email: adminEmail, role: 'admin' } });
});

router.get('/me', adminAuth, (_req, res) => res.json({ admin: { email: process.env.ADMIN_EMAIL, role: 'admin' } }));

router.get('/stats', adminAuth, async (_req, res) => {
  try {
    const [users, accounts, kyc] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM users'),
      pool.query('SELECT COUNT(*)::int AS count FROM accounts'),
      pool.query(`SELECT status, COUNT(*)::int AS count FROM kyc_profiles GROUP BY status`)
    ]);
    const kycCounts = Object.fromEntries(kyc.rows.map(r => [r.status, r.count]));
    res.json({ users: users.rows[0].count, accounts: accounts.rows[0].count, kyc: kycCounts });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Unable to load admin statistics' });
  }
});

router.get('/users', adminAuth, async (_req, res) => {
  try {
    // Best-effort, idempotent: makes sure the tier column exists even if the
    // dashboard-access route hasn't initialized its schema yet.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'standard'`);
    const result = await pool.query(`
      SELECT u.id, u.username, u.full_name, u.email, u.phone, u.created_at,
             COALESCE(u.tier, 'standard') AS tier,
             a.account_number, a.status AS account_status,
             k.status AS kyc_status
      FROM users u
      LEFT JOIN accounts a ON a.user_id = u.id
      LEFT JOIN kyc_profiles k ON k.user_id = u.id
      ORDER BY u.created_at DESC LIMIT 200
    `);
    res.json({ users: result.rows });
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Unable to load users' });
  }
});

router.get('/kyc', adminAuth, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT k.id, k.user_id, k.legal_name, k.date_of_birth, k.country, k.city,
             k.id_type, k.status, k.review_note, k.submitted_at, k.reviewed_at,
             u.email, u.username
      FROM kyc_profiles k JOIN users u ON u.id = k.user_id
      ORDER BY k.submitted_at DESC LIMIT 200
    `);
    res.json({ kyc: result.rows });
  } catch (error) {
    console.error('Admin KYC error:', error);
    res.status(500).json({ error: 'Unable to load KYC records' });
  }
});

async function updateKycStatus(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const status = String(req.body?.status || '').trim().toLowerCase();

  const reviewNote =
    req.body?.review_note == null
      ? null
      : String(req.body.review_note).trim().slice(0, 2000);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      error: 'Invalid KYC record ID'
    });
  }

  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({
      error: 'Invalid KYC status'
    });
  }

  try {
    const result = await pool.query(
      `
      UPDATE public.kyc_profiles
      SET
        status = $1,
        review_note = $2,
        reviewed_at = CASE
          WHEN $1 = 'pending' THEN NULL
          ELSE NOW()
        END
      WHERE id = $3
      RETURNING
        id,
        user_id,
        status,
        review_note,
        submitted_at,
        reviewed_at
      `,
      [status, reviewNote, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'KYC record not found'
      });
    }

    return res.json({
      success: true,
      message:
        status === 'approved'
          ? 'Customer KYC approved successfully'
          : status === 'rejected'
            ? 'Customer KYC rejected'
            : 'Customer KYC returned to pending',
      kyc: result.rows[0]
    });

  } catch (error) {
    console.error('Admin KYC update error:', error);

    return res.status(500).json({
      error: 'Unable to update KYC record',
      code: error.code || null,
      detail: error.detail || null,
      constraint: error.constraint || null
    });
  }
}

router.post('/kyc/:id/status', adminAuth, updateKycStatus);
router.patch('/kyc/:id', adminAuth, updateKycStatus);


router.get('/wallets', adminAuth, async (_req, res) => {
  try {
    const result = await pool.query(`SELECT id, asset, network, address, label, is_active, updated_by, updated_at FROM deposit_wallets ORDER BY CASE asset WHEN 'BTC' THEN 1 WHEN 'USDT' THEN 2 WHEN 'SOL' THEN 3 ELSE 9 END, network`);
    res.json({ wallets: result.rows });
  } catch (error) {
    console.error('Admin wallets error:', error);
    res.status(500).json({ error: 'Unable to load deposit wallets' });
  }
});

router.put('/wallets/:id', adminAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const address = String(req.body?.address || '').trim();
  const label = req.body?.label == null ? null : String(req.body.label).trim();
  const isActive = req.body?.is_active !== false;
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid wallet ID' });
  if (!address || address.length > 255) return res.status(400).json({ error: 'A valid public wallet address is required' });
  try {
    const result = await pool.query(`UPDATE deposit_wallets SET address=$1,label=$2,is_active=$3,updated_by=$4,updated_at=NOW() WHERE id=$5 RETURNING id,asset,network,address,label,is_active,updated_by,updated_at`, [address,label,isActive,req.admin.email,id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Deposit wallet not found' });
    res.json({ wallet: result.rows[0] });
  } catch (error) {
    console.error('Admin wallet update error:', error);
    res.status(500).json({ error: 'Unable to update deposit wallet' });
  }
});

router.post('/wallets', adminAuth, async (req, res) => {
  const asset = String(req.body?.asset || '').trim().toUpperCase();
  const network = String(req.body?.network || '').trim().toUpperCase();
  const address = String(req.body?.address || '').trim();
  const label = req.body?.label == null ? null : String(req.body.label).trim();
  if (!['BTC','USDT','SOL'].includes(asset)) return res.status(400).json({ error: 'Only BTC, USDT and SOL deposit wallets are supported' });
  if (!network || !address) return res.status(400).json({ error: 'Network and public wallet address are required' });
  try {
    const result = await pool.query(`INSERT INTO deposit_wallets(asset,network,address,label,updated_by) VALUES($1,$2,$3,$4,$5) RETURNING id,asset,network,address,label,is_active,updated_by,updated_at`, [asset,network,address,label,req.admin.email]);
    res.status(201).json({ wallet: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A wallet for that asset and network already exists' });
    console.error('Admin wallet create error:', error);
    res.status(500).json({ error: 'Unable to create deposit wallet' });
  }
});

router.get('/deposits', adminAuth, async (_req, res) => {
  try {
    const result = await pool.query(`SELECT d.id,d.asset,d.network,d.wallet_address,d.amount,d.tx_hash,d.status,d.review_note,d.submitted_at,d.reviewed_at,u.email,u.username,a.account_number FROM crypto_deposits d JOIN accounts a ON a.id=d.account_id JOIN users u ON u.id=a.user_id ORDER BY d.submitted_at DESC LIMIT 200`);
    res.json({ deposits: result.rows });
  } catch (error) {
    console.error('Admin deposits error:', error);
    res.status(500).json({ error: 'Unable to load deposits' });
  }
});

router.post('/deposits/:id/status', adminAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const { status, review_note } = req.body || {};
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid deposit ID' });
  if (!['submitted','under_review','confirmed','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid deposit status' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`SELECT id,status,amount,asset,network,account_id FROM crypto_deposits WHERE id=$1 FOR UPDATE`, [id]);
    if (!current.rowCount) throw Object.assign(new Error('Deposit not found'), {status:404});
    const d=current.rows[0];
    if (d.status === 'confirmed' && status !== 'confirmed') throw Object.assign(new Error('A confirmed deposit cannot be moved back to another status'), {status:409});
    if (status === 'confirmed' && (d.amount == null || Number(d.amount) <= 0)) throw Object.assign(new Error('A deposit amount is required before confirmation'), {status:400});
    // Confirmation records that the submitted deposit has passed the current admin review.
    // It intentionally does NOT credit the trading balance yet: the amount is denominated in the deposited crypto asset,
    // and a production credit requires verified on-chain settlement plus a trusted USD valuation/conversion policy.
    const updated=await client.query(`UPDATE crypto_deposits SET status=$1,review_note=$2,reviewed_at=CASE WHEN $1 IN ('confirmed','rejected') THEN NOW() ELSE NULL END WHERE id=$3 RETURNING id,asset,network,amount,tx_hash,status,review_note,reviewed_at`, [status,review_note?String(review_note).trim():null,id]);
    await client.query('COMMIT');
    res.json({deposit:updated.rows[0]});
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('Admin deposit status error:',error);
    res.status(error.status||500).json({error:error.message||'Unable to update deposit'});
  } finally { client.release(); }
});


// Staging portfolio controls. These are administrative accounting adjustments for
// controlled pre-launch testing; they are always audited and do not represent
// broker execution or on-chain settlement.
router.get('/portfolio/:userId', adminAuth, async (req,res)=>{
  const userId=Number.parseInt(req.params.userId,10);
  if(!Number.isInteger(userId)||userId<1) return res.status(400).json({error:'Invalid user ID'});
  try{
    await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS admin_adjusted_pnl NUMERIC(30,10) NOT NULL DEFAULT 0`);
    await pool.query(`CREATE TABLE IF NOT EXISTS portfolio_adjustments (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      adjustment_type VARCHAR(30) NOT NULL CHECK(adjustment_type IN ('cash','profit_loss')),
      amount NUMERIC(30,10) NOT NULL,
      note TEXT,
      created_by VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const r=await pool.query(`SELECT u.id,u.email,u.full_name,u.username,a.id account_id,a.account_number,a.cash_balance,a.realized_pnl,a.admin_adjusted_pnl,a.status FROM users u JOIN accounts a ON a.user_id=u.id WHERE u.id=$1 ORDER BY a.id LIMIT 1`,[userId]);
    if(!r.rowCount) return res.status(404).json({error:'Customer account not found'});
    const adj=await pool.query(`SELECT id,adjustment_type,amount,note,created_by,created_at FROM portfolio_adjustments WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100`,[r.rows[0].account_id]);
    res.json({account:r.rows[0],adjustments:adj.rows});
  }catch(e){console.error('Portfolio control load:',e);res.status(500).json({error:'Unable to load portfolio controls'});}
});

router.post('/portfolio/:userId/adjust', adminAuth, async (req,res)=>{
  const userId=Number.parseInt(req.params.userId,10);
  const type=String(req.body?.adjustment_type||'').trim();
  const amount=Number(req.body?.amount);
  const note=String(req.body?.note||'').trim().slice(0,500);
  if(!Number.isInteger(userId)||userId<1) return res.status(400).json({error:'Invalid user ID'});
  if(!['cash','profit_loss'].includes(type)) return res.status(400).json({error:'Adjustment type must be cash or profit_loss'});
  if(!Number.isFinite(amount)||amount===0) return res.status(400).json({error:'Enter a non-zero adjustment amount'});
  if(!note) return res.status(400).json({error:'A reason is required for every portfolio adjustment'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS admin_adjusted_pnl NUMERIC(30,10) NOT NULL DEFAULT 0`);
    await client.query(`CREATE TABLE IF NOT EXISTS portfolio_adjustments (id BIGSERIAL PRIMARY KEY,account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,adjustment_type VARCHAR(30) NOT NULL CHECK(adjustment_type IN ('cash','profit_loss')),amount NUMERIC(30,10) NOT NULL,note TEXT,created_by VARCHAR(255) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const a=await client.query(`SELECT id,cash_balance,realized_pnl FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1 FOR UPDATE`,[userId]);
    if(!a.rowCount) throw Object.assign(new Error('Customer account not found'),{status:404});
    const account=a.rows[0];
    if(type==='cash'){
      const next=Number(account.cash_balance)+amount;
      if(next<0) throw Object.assign(new Error('Cash balance cannot become negative'),{status:400});
      await client.query(`UPDATE accounts SET cash_balance=$1,updated_at=NOW() WHERE id=$2`,[next,account.id]);
    }else{
      await client.query(`UPDATE accounts SET admin_adjusted_pnl=admin_adjusted_pnl+$1,updated_at=NOW() WHERE id=$2`,[amount,account.id]);
    }
    const ins=await client.query(`INSERT INTO portfolio_adjustments(account_id,adjustment_type,amount,note,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *`,[account.id,type,amount,note,req.admin.email]);
    await client.query('COMMIT');
    res.json({adjustment:ins.rows[0],message:'Portfolio adjustment recorded and audited.'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('Portfolio adjustment:',e);res.status(e.status||500).json({error:e.message||'Unable to adjust portfolio'});}finally{client.release();}
});

module.exports = { router, adminAuth };
