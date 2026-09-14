const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();

const hashId = (value) => crypto.createHash('sha256').update(String(value).trim()).digest('hex');

router.get('/status', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT legal_name, date_of_birth, country, address_line1, city, postal_code,
              id_type, status, review_note, submitted_at, reviewed_at
       FROM kyc_profiles WHERE user_id = $1 LIMIT 1`,
      [req.user.sub]
    );
    if (!result.rowCount) return res.json({ status: 'not_started' });
    res.json({ kyc: result.rows[0] });
  } catch (error) {
    console.error('KYC status error:', error);
    res.status(500).json({ error: 'Unable to load KYC status' });
  }
});

router.post('/submit', auth, async (req, res) => {
  const { legal_name, date_of_birth, country, address_line1, city, postal_code, id_type, id_number } = req.body;
  if (!legal_name || !date_of_birth || !country || !address_line1 || !city || !id_type || !id_number) {
    return res.status(400).json({ error: 'All required KYC fields must be completed' });
  }

  const dob = new Date(`${date_of_birth}T00:00:00Z`);
  const today = new Date();
  const age = Number.isFinite(dob.getTime()) ? today.getUTCFullYear() - dob.getUTCFullYear() - ((today.getUTCMonth() < dob.getUTCMonth() || (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate())) ? 1 : 0) : -1;
  if (age < 18) return res.status(400).json({ error: 'The account holder must be at least 18 years old' });
  if (!Number.isFinite(dob.getTime())) return res.status(400).json({ error: 'Enter a valid date of birth' });

  try {
    const existing = await pool.query('SELECT id, status FROM kyc_profiles WHERE user_id = $1 LIMIT 1', [req.user.sub]);
    if (existing.rowCount && existing.rows[0].status === 'approved') {
      return res.status(409).json({ error: 'KYC is already approved' });
    }

    const result = await pool.query(
      `INSERT INTO kyc_profiles
       (user_id, legal_name, date_of_birth, country, address_line1, city, postal_code, id_type, id_number_hash, status, review_note, submitted_at, reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',NULL,NOW(),NULL)
       ON CONFLICT (user_id) DO UPDATE SET
         legal_name=EXCLUDED.legal_name, date_of_birth=EXCLUDED.date_of_birth, country=EXCLUDED.country,
         address_line1=EXCLUDED.address_line1, city=EXCLUDED.city, postal_code=EXCLUDED.postal_code,
         id_type=EXCLUDED.id_type, id_number_hash=EXCLUDED.id_number_hash,
         status='pending', review_note=NULL, submitted_at=NOW(), reviewed_at=NULL
       RETURNING legal_name, date_of_birth, country, address_line1, city, postal_code, id_type, status, submitted_at`,
      [req.user.sub, String(legal_name).trim(), date_of_birth, String(country).trim(), String(address_line1).trim(), String(city).trim(), postal_code ? String(postal_code).trim() : null, String(id_type).trim(), hashId(id_number)]
    );

    res.status(201).json({ kyc: result.rows[0], message: 'Your verification details have been submitted successfully and are now under review.' });
  } catch (error) {
    console.error('KYC submit error:', error);
    res.status(500).json({ error: 'Unable to submit KYC' });
  }
});

// DEMO ONLY: simulates a backend KYC decision so the workflow can be tested without a real provider.
router.post('/demo/approve', auth, async (req, res) => {
  if (process.env.DEMO_KYC_MODE !== 'true') return res.status(404).json({ error: 'Demo KYC mode is disabled' });
  try {
    const result = await pool.query(
      `UPDATE kyc_profiles SET status='approved', review_note='Demo verification approved', reviewed_at=NOW()
       WHERE user_id=$1 AND status='pending'
       RETURNING status, review_note, reviewed_at`,
      [req.user.sub]
    );
    if (!result.rowCount) return res.status(409).json({ error: 'No pending KYC submission found' });
    res.json({ kyc: result.rows[0], demo: true });
  } catch (error) {
    console.error('Demo KYC approval error:', error);
    res.status(500).json({ error: 'Unable to complete demo KYC approval' });
  }
});

module.exports = router;
