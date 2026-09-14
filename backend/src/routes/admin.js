```js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const router = express.Router();

function issueAdminToken(admin) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }

  return jwt.sign(
    {
      sub: 'admin',
      email: admin.email,
      role: 'admin'
    },
    process.env.JWT_SECRET,
    {
      expiresIn: '8h'
    }
  );
}

function adminAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : '';

  if (!token || !process.env.JWT_SECRET) {
    return res.status(401).json({
      error: 'Admin authentication required'
    });
  }

  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    if (payload.role !== 'admin') {
      return res.status(403).json({
        error: 'Admin access required'
      });
    }

    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({
      error: 'Invalid or expired admin session'
    });
  }
}


/* =========================
   ADMIN LOGIN
========================= */

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  const adminEmail = String(
    process.env.ADMIN_EMAIL || ''
  ).trim().toLowerCase();

  const adminPassword =
    process.env.ADMIN_PASSWORD || '';

  if (!adminEmail || !adminPassword) {
    return res.status(503).json({
      error:
        'Admin credentials are not configured. Add ADMIN_EMAIL and ADMIN_PASSWORD in Vercel.'
    });
  }

  if (!email || !password) {
    return res.status(400).json({
      error: 'Email and password are required'
    });
  }

  if (
    String(email).trim().toLowerCase() !== adminEmail ||
    String(password) !== adminPassword
  ) {
    return res.status(401).json({
      error: 'Invalid admin credentials'
    });
  }

  res.json({
    token: issueAdminToken({
      email: adminEmail
    }),
    admin: {
      email: adminEmail,
      role: 'admin'
    }
  });
});


router.get('/me', adminAuth, (_req, res) => {
  res.json({
    admin: {
      email: process.env.ADMIN_EMAIL,
      role: 'admin'
    }
  });
});


/* =========================
   ADMIN STATS
========================= */

router.get('/stats', adminAuth, async (_req, res) => {
  try {
    const [users, accounts, kyc] =
      await Promise.all([
        pool.query(
          'SELECT COUNT(*)::int AS count FROM users'
        ),

        pool.query(
          'SELECT COUNT(*)::int AS count FROM accounts'
        ),

        pool.query(`
          SELECT status, COUNT(*)::int AS count
          FROM kyc_profiles
          GROUP BY status
        `)
      ]);

    const kycCounts = Object.fromEntries(
      kyc.rows.map(row => [
        row.status,
        row.count
      ])
    );

    res.json({
      users: users.rows[0].count,
      accounts: accounts.rows[0].count,
      kyc: kycCounts
    });

  } catch (error) {
    console.error(
      'Admin stats error:',
      error
    );

    res.status(500).json({
      error: 'Unable to load admin statistics'
    });
  }
});


/* =========================
   USERS
========================= */

router.get('/users', adminAuth, async (_req, res) => {
  try {

    await pool.query(`
      ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS tier
      VARCHAR(20)
      NOT NULL
      DEFAULT 'standard'
    `);

    const result = await pool.query(`
      SELECT
        u.id,
        u.username,
        u.full_name,
        u.email,
        u.phone,
        u.created_at,
        COALESCE(u.tier, 'standard') AS tier,
        a.account_number,
        a.status AS account_status,
        k.status AS kyc_status
      FROM users u
      LEFT JOIN accounts a
        ON a.user_id = u.id
      LEFT JOIN kyc_profiles k
        ON k.user_id = u.id
      ORDER BY u.created_at DESC
      LIMIT 200
    `);

    res.json({
      users: result.rows
    });

  } catch (error) {

    console.error(
      'Admin users error:',
      error
    );

    res.status(500).json({
      error: 'Unable to load users'
    });
  }
});


/* =========================
   KYC LIST
========================= */

router.get('/kyc', adminAuth, async (_req, res) => {
  try {

    const result = await pool.query(`
      SELECT
        k.id,
        k.user_id,
        k.legal_name,
        k.date_of_birth,
        k.country,
        k.city,
        k.id_type,
        k.status,
        k.review_note,
        k.submitted_at,
        k.reviewed_at,
        u.email,
        u.username
      FROM kyc_profiles k
      JOIN users u
        ON u.id = k.user_id
      ORDER BY k.submitted_at DESC
      LIMIT 200
    `);

    res.json({
      kyc: result.rows
    });

  } catch (error) {

    console.error(
      'Admin KYC error:',
      error
    );

    res.status(500).json({
      error: 'Unable to load KYC records'
    });
  }
});


/* =========================
   UPDATE KYC STATUS
========================= */

async function updateKycStatus(req, res) {

  const id = Number.parseInt(
    req.params.id,
    10
  );

  const status = String(
    req.body?.status || ''
  )
    .trim()
    .toLowerCase();

  const reviewNote =
    req.body?.review_note == null
      ? null
      : String(
          req.body.review_note
        )
          .trim()
          .slice(0, 2000);

  if (
    !Number.isInteger(id) ||
    id < 1
  ) {
    return res.status(400).json({
      error: 'Invalid KYC record ID'
```
