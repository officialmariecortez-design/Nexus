const DEFAULT_MARKETS = {
  BTCUSD: { symbol: 'BTCUSD', providerSymbol: 'BTC/USD', name: 'Bitcoin / US Dollar', decimals: 2 },
  ETHUSD: { symbol: 'ETHUSD', providerSymbol: 'ETH/USD', name: 'Ethereum / US Dollar', decimals: 2 },
  EURUSD: { symbol: 'EURUSD', providerSymbol: 'EUR/USD', name: 'Euro / US Dollar', decimals: 5 },
  GBPUSD: { symbol: 'GBPUSD', providerSymbol: 'GBP/USD', name: 'British Pound / US Dollar', decimals: 5 },
  XAUUSD: { symbol: 'XAUUSD', providerSymbol: 'XAU/USD', name: 'Gold / US Dollar', decimals: 2 }
};

const simulated = {
  BTCUSD: 65000,
  ETHUSD: 3200,
  EURUSD: 1.085,
  GBPUSD: 1.29,
  XAUUSD: 2900
};
const steps = { BTCUSD: 250, ETHUSD: 20, EURUSD: 0.0015, GBPUSD: 0.0018, XAUUSD: 4 };
let cache = { at: 0, data: null };

function simulatedQuotes() {
  const data = Object.values(DEFAULT_MARKETS).map(m => {
    simulated[m.symbol] = Math.max(simulated[m.symbol] * 0.5, simulated[m.symbol] + (Math.random() - 0.5) * steps[m.symbol]);
    return { ...m, price: Number(simulated[m.symbol].toFixed(m.decimals)) };
  });
  return data;
}

async function twelveDataQuotes() {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error('TWELVE_DATA_API_KEY is not configured');
  const symbols = Object.values(DEFAULT_MARKETS).map(m => m.providerSymbol).join(',');
  const url = new URL('https://api.twelvedata.com/price');
  url.searchParams.set('symbol', symbols);
  url.searchParams.set('apikey', key);
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Market data provider returned HTTP ${response.status}`);
  const payload = await response.json();
  const rows = Object.values(DEFAULT_MARKETS).map(m => {
    const raw = payload[m.providerSymbol];
    const price = Number(raw?.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`No valid price returned for ${m.symbol}`);
    return { ...m, price: Number(price.toFixed(m.decimals)) };
  });
  return rows;
}

async function getMarketQuotes() {
  const mode = String(process.env.MARKET_DATA_MODE || 'simulated').toLowerCase();
  if (mode !== 'real') return { mode: 'simulated', data_source: 'simulated', markets: simulatedQuotes() };
  if (cache.data && Date.now() - cache.at < 5000) return cache.data;
  const markets = await twelveDataQuotes();
  cache = { at: Date.now(), data: { mode: 'real', data_source: 'Twelve Data', markets } };
  return cache.data;
}

module.exports = { DEFAULT_MARKETS, getMarketQuotes };
