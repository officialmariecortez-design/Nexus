const express = require('express');
const pool = require('../db/pool');
const { adminAuth } = require('./admin');

const router = express.Router();

const defaults = {
  markets: { title: 'Markets', subtitle: 'Explore global markets from one platform.', body: 'Nexus Markets provides access to market information across currencies, indices, commodities and digital assets. Market availability and pricing are subject to the applicable account and risk disclosures.' },
  about: { title: 'About Nexus Markets', subtitle: 'A modern platform built around access, education and disciplined market participation.', body: 'Nexus Markets is designed to give clients a clear digital experience for account access, market information and financial education. We focus on transparency, security and responsible participation.' },
  careers: { title: 'Careers', subtitle: 'Build the next generation of market technology with us.', body: 'We welcome professionals interested in financial technology, software engineering, customer experience, research, compliance and education. Send your CV and a short introduction through our contact page for future opportunities.' },
  contact: { title: 'Contact Us', subtitle: 'We are here to help.', body: 'For account assistance, general enquiries or partnership discussions, contact the Nexus Markets team. Please do not send passwords, one-time codes or other confidential credentials by email.' },
  education: { title: 'Education', subtitle: 'Learn the foundations before you trade.', body: 'Our education area is intended to help users understand market terminology, risk management, charts and disciplined decision-making. Educational material is not personal investment advice or a guarantee of returns.' }
};

async function ensureTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS site_content (
    page_key VARCHAR(40) PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    subtitle VARCHAR(400) NOT NULL,
    body TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

async function seed() {
  await ensureTable();
  for (const [key, value] of Object.entries(defaults)) {
    await pool.query(`INSERT INTO site_content(page_key,title,subtitle,body) VALUES($1,$2,$3,$4) ON CONFLICT(page_key) DO NOTHING`, [key, value.title, value.subtitle, value.body]);
  }
}

router.get('/:page', async (req, res) => {
  const page = String(req.params.page).toLowerCase();
  if (!defaults[page]) return res.status(404).json({ error: 'Page content not found' });
  try {
    await seed();
    const result = await pool.query('SELECT page_key, title, subtitle, body, updated_at FROM site_content WHERE page_key=$1', [page]);
    res.json({ content: result.rows[0] });
  } catch (error) {
    console.error('Content read error:', error);
    res.json({ content: { page_key: page, ...defaults[page] } });
  }
});

router.put('/:page', adminAuth, async (req, res) => {
  const page = String(req.params.page).toLowerCase();
  if (!defaults[page]) return res.status(404).json({ error: 'Page content not found' });
  const { title, subtitle, body } = req.body || {};
  if (!title || !subtitle || !body) return res.status(400).json({ error: 'Title, subtitle and body are required' });
  try {
    await ensureTable();
    const result = await pool.query(`INSERT INTO site_content(page_key,title,subtitle,body) VALUES($1,$2,$3,$4)
      ON CONFLICT(page_key) DO UPDATE SET title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, body=EXCLUDED.body, updated_at=NOW()
      RETURNING page_key,title,subtitle,body,updated_at`, [page, String(title).trim(), String(subtitle).trim(), String(body).trim()]);
    res.json({ content: result.rows[0] });
  } catch (error) {
    console.error('Content update error:', error);
    res.status(500).json({ error: 'Unable to update page content' });
  }
});

module.exports = router;
