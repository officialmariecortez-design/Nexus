require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./routes/auth');
const kycRoutes = require('./routes/kyc');
const { router: adminRoutes } = require('./routes/admin');
const contentRoutes = require('./routes/content');
const tradingRoutes = require('./routes/trading');
const { router: fundingRoutes } = require('./routes/funding');
const marketPricesRoutes = require('./routes/market-prices');
const chatbotRoutes = require('./routes/chatbot');
const { router: accessRoutes } = require('./routes/access');

const app = express();

app.set('trust proxy', 1);

// Live execution remains deliberately disabled until a broker adapter, risk controls,
// reconciliation, funding controls and compliance checks are implemented.
if (process.env.LIVE_TRADING_ENABLED === 'true') {
  console.warn('LIVE_TRADING_ENABLED is set, but this build has no live execution adapter. Live orders remain unavailable.');
}
const allowedOrigins = String(process.env.CORS_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : false,
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.get('/api/config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ demoKycMode: process.env.DEMO_KYC_MODE === 'true', demoTradingMode: process.env.DEMO_TRADING_MODE === 'true' });
});

app.get('/api/health', async (_req, res) => {
  try {
    const pool = require('./db/pool');
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'ok', service: 'nexus-markets-api' });
  } catch (error) {
    console.error('Health check database error:', error.message);
    res.status(503).json({ status: 'degraded', database: 'unreachable', service: 'nexus-markets-api' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/funding', fundingRoutes);
app.use('/api/market-prices', marketPricesRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/access', accessRoutes);

// Local development: serve the supplied static frontend.
const frontendRoot = path.resolve(__dirname, '..', '..');
app.use(express.static(frontendRoot));

// BUGFIX: this previously pointed at 'Home - NexusMarkets.html', a file that
// does not exist anywhere in the project (the real homepage is index.html),
// so any unmatched route crashed with ENOENT in local/dev mode. The route
// pattern is also updated for Express 5's path-to-regexp syntax, which
// requires wildcards to be named and prefixed with '/'.
app.get('/*splat', (_req, res) => {
  res.sendFile(path.join(frontendRoot, 'index.html'));
});

if (require.main === module) {
  const port = process.env.PORT || 4000;
  app.listen(port, () => console.log(`Nexus Markets API listening on http://localhost:${port}`));
}

module.exports = app;
