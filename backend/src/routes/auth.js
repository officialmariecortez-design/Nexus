const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();

function issueToken(user) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    created_at: row.created_at
  };
}

router.post('/register', async (req, res) => {
  const { username, name, email, phone, password, password_confirmation, agree } = req.body;
  if (!username || !name || !email || !password) return res.status(400).json({ error: 'Username, name, email and password are required' });
  if (password !== password_confirmation) return res.status(400).json({ error: 'Passwords do not match' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (agree === undefined || agree === false || agree === 'false' || agree === '0') return res.status(400).json({ error: 'You must accept the terms to create an account' });

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedUsername = String(username).trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) return res.status(400).json({ error: 'Enter a valid email address' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE email = $1 OR username = $2 LIMIT 1', [normalizedEmail, normalizedUsername]);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A user with that email or username already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await client.query(
      `INSERT INTO users (username, full_name, email, phone, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, full_name, email, phone, created_at`,
      [normalizedUsername, String(name).trim(), normalizedEmail, phone ? String(phone).trim() : null, passwordHash]
    );
    const user = result.rows[0];
    const accountNumber = `NX${String(user.id).padStart(8, '0')}`;
    await client.query(
      `INSERT INTO accounts (user_id, account_number, account_type, base_currency, status)
       VALUES ($1, $2, 'standard', 'USD', 'active')`,
      [user.id, accountNumber]
    );
    await client.query('COMMIT');
    res.status(201).json({ user: publicUser(user), token: issueToken(user), account: { account_number: accountNumber, status: 'active' } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Register error:', error);
    res.status(500).json({ error: 'Unable to create account' });
  } finally {
    client.release();
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email/username and password are required' });
  try {
    const identifier = String(email).trim().toLowerCase();
    const result = await pool.query(
      `SELECT id, username, full_name, email, phone, password_hash, created_at
       FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $1 LIMIT 1`,
      [identifier]
    );
    if (!result.rowCount) return res.status(401).json({ error: 'Invalid credentials' });
    const row = result.rows[0];
    if (!(await bcrypt.compare(password, row.password_hash))) return res.status(401).json({ error: 'Invalid credentials' });
    const user = publicUser(row);
    res.json({ user, token: issueToken(user) });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Unable to sign in' });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, full_name, email, phone, created_at FROM users WHERE id = $1 LIMIT 1`,
      [req.user.sub]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'User not found' });
    res.json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'Unable to load account' });
  }
});

module.exports = router;
