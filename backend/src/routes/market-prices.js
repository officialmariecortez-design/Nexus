const express = require('express');
const router = express.Router();

// Server-side proxy for CoinMarketCap. The API key must never be sent to the
// browser, so the frontend calls this route instead of CoinMarketCap directly.
const CMC_BASE = 'https://pro-api.coinmarketcap.com';
const DEFAULT_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'USDT', 'ADA', 'DOGE'];

let cache = { at: 0, key: '', data: null };
const CACHE_MS = 30000; // CoinMarketCap free tier is rate-limited; cache briefly.

function parseSymbols(raw) {
  if (!raw) return DEFAULT_SYMBOLS;
  const list = String(raw)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 30);
  return list.length ? list : DEFAULT_SYMBOLS;
}

router.get('/quotes', async (req, res) => {
  const apiKey = process.env.COINMARKETCAP_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Live crypto prices are not configured yet. Add COINMARKETCAP_API_KEY in the environment.' });
  }
  const symbols = parseSymbols(req.query.symbols);
  const cacheKey = symbols.join(',');
  if (cache.data && cache.key === cacheKey && Date.now() - cache.at < CACHE_MS) {
    return res.json(cache.data);
  }
  try {
    const url = new URL(`${CMC_BASE}/v2/cryptocurrency/quotes/latest`);
    url.searchParams.set('symbol', cacheKey);
    url.searchParams.set('convert', 'USD');
    const response = await fetch(url, {
      headers: { 'X-CMC_PRO_API_KEY': apiKey, Accept: 'application/json' }
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail?.status?.error_message || `CoinMarketCap returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    const assets = symbols
      .map((symbol) => {
        const entries = payload.data?.[symbol];
        const entry = Array.isArray(entries) ? entries[0] : entries;
        const quote = entry?.quote?.USD;
        if (!entry || !quote) return null;
        return {
          symbol,
          name: entry.name,
          price: quote.price,
          percent_change_1h: quote.percent_change_1h,
          percent_change_24h: quote.percent_change_24h,
          percent_change_7d: quote.percent_change_7d,
          market_cap: quote.market_cap,
          volume_24h: quote.volume_24h,
          last_updated: quote.last_updated
        };
      })
      .filter(Boolean);
    const data = { source: 'CoinMarketCap', updated_at: new Date().toISOString(), assets };
    cache = { at: Date.now(), key: cacheKey, data };
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (error) {
    console.error('CoinMarketCap quotes error:', error.message);
    res.status(502).json({ error: 'Unable to load live crypto prices right now. Please try again shortly.' });
  }
});

module.exports = router;
