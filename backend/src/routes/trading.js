const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const router = express.Router();
const { DEFAULT_MARKETS, getMarketQuotes } = require('./market-data');
const MARKETS = DEFAULT_MARKETS;

let schemaPromise;
function ensureTradingTables() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS cash_balance NUMERIC(20,8) NOT NULL DEFAULT 10000`);
    await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS realized_pnl NUMERIC(20,8) NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await pool.query(`CREATE TABLE IF NOT EXISTS paper_positions (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      symbol VARCHAR(20) NOT NULL,
      quantity NUMERIC(30,10) NOT NULL DEFAULT 0,
      average_price NUMERIC(30,10) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(account_id, symbol)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS paper_trades (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      client_order_id UUID NOT NULL,
      symbol VARCHAR(20) NOT NULL,
      side VARCHAR(4) NOT NULL CHECK(side IN ('buy','sell')),
      quantity NUMERIC(30,10) NOT NULL,
      price NUMERIC(30,10) NOT NULL,
      notional NUMERIC(30,10) NOT NULL,
      realized_pnl NUMERIC(30,10) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'filled',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(account_id, client_order_id)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS trading_ledger (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      client_order_id UUID,
      entry_type VARCHAR(40) NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'USD',
      amount NUMERIC(30,10) NOT NULL,
      balance_after NUMERIC(30,10),
      description VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ledger_account_created ON trading_ledger(account_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_paper_positions_account ON paper_positions(account_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_paper_trades_account ON paper_trades(account_id, created_at DESC)`);
  })().catch(err => { schemaPromise = null; throw err; });
  return schemaPromise;
}

async function getAccount(client, userId) {
  const result = await client.query(
    `SELECT id, account_number, base_currency, cash_balance, realized_pnl, COALESCE(admin_adjusted_pnl,0) AS admin_adjusted_pnl, status
     FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1 FOR UPDATE`, [userId]
  );
  return result.rows[0] || null;
}

function maxOrderNotional() {
  const n = Number(process.env.DEMO_MAX_ORDER_NOTIONAL || 100000);
  return Number.isFinite(n) && n > 0 ? n : 100000;
}

router.get('/markets', async (_req, res) => {
  try {
    const quotes = await getMarketQuotes();
    res.json({ ...quotes, disclaimer: quotes.mode === 'real'
      ? 'Market prices are provided for paper-trading purposes. No real orders are executed.'
      : 'Demo prices only. No real orders are executed.' });
  } catch (error) {
    console.error('Market data error:', error.message);
    res.status(503).json({ error: 'Market prices are temporarily unavailable. Please try again shortly.' });
  }
});

router.get('/account', auth, async (req, res) => {
  await ensureTradingTables();
  const client = await pool.connect();
  try {
    const account = await getAccount(client, req.user.sub);
    if (!account) return res.status(404).json({ error: 'Trading account not found' });
    const positions = await client.query(
      `SELECT symbol, quantity, average_price, updated_at FROM paper_positions
       WHERE account_id=$1 AND quantity>0 ORDER BY symbol`, [account.id]
    );
    const quotes = await getMarketQuotes();
    const quoteMap = Object.fromEntries(quotes.markets.map(m => [m.symbol, m.price]));
    const enriched = positions.rows.map(p => {
      const currentPrice = quoteMap[p.symbol];
      if (!Number.isFinite(currentPrice)) throw new Error(`No current price available for ${p.symbol}`);
      const quantity = Number(p.quantity), averagePrice = Number(p.average_price);
      const marketValue = quantity * currentPrice;
      return { ...p, quantity, average_price: averagePrice, current_price: currentPrice,
        market_value: marketValue, unrealized_pnl: marketValue - (quantity * averagePrice) };
    });
    const equity = Number(account.cash_balance) + enriched.reduce((sum, p) => sum + p.market_value, 0);
    const unrealized = enriched.reduce((sum,p)=>sum+p.unrealized_pnl,0);
    const totalPnl = Number(account.realized_pnl) + unrealized + Number(account.admin_adjusted_pnl || 0);
    res.json({ mode: 'paper', account: { ...account, cash_balance: Number(account.cash_balance), realized_pnl: Number(account.realized_pnl), admin_adjusted_pnl: Number(account.admin_adjusted_pnl||0), unrealized_pnl: unrealized, total_pnl: totalPnl, equity }, positions: enriched });
  } catch (error) {
    console.error('Trading account error:', error);
    res.status(500).json({ error: 'Unable to load your trading account right now.' });
  } finally { client.release(); }
});

router.get('/trades', auth, async (req, res) => {
  await ensureTradingTables();
  try {
    const result = await pool.query(
      `SELECT id, client_order_id, symbol, side, quantity, price, notional, realized_pnl, status, created_at
       FROM paper_trades WHERE account_id=(SELECT id FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1)
       ORDER BY created_at DESC LIMIT 100`, [req.user.sub]
    );
    res.json({ trades: result.rows.map(r => ({ ...r, quantity:Number(r.quantity), price:Number(r.price), notional:Number(r.notional), realized_pnl:Number(r.realized_pnl) })) });
  } catch (error) {
    console.error('Trade history error:', error);
    res.status(500).json({ error: 'Unable to load trade history right now.' });
  }
});

router.get('/ledger', auth, async (req, res) => {
  await ensureTradingTables();
  try {
    const result = await pool.query(
      `SELECT entry_type, currency, amount, balance_after, description, created_at
       FROM trading_ledger WHERE account_id=(SELECT id FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1)
       ORDER BY created_at DESC LIMIT 200`, [req.user.sub]
    );
    res.json({ ledger: result.rows.map(r => ({ ...r, amount:Number(r.amount), balance_after:r.balance_after == null ? null : Number(r.balance_after) })) });
  } catch (error) {
    console.error('Ledger error:', error);
    res.status(500).json({ error: 'Unable to load account activity right now.' });
  }
});

router.post('/orders', auth, async (req, res) => {
  if (process.env.DEMO_TRADING_MODE !== 'true') return res.status(404).json({ error: 'Demo trading is currently unavailable' });
  await ensureTradingTables();
  const { symbol, side } = req.body || {};
  const quantity = Number(req.body?.quantity);
  const suppliedOrderId = req.body?.client_order_id;
  const clientOrderId = suppliedOrderId || crypto.randomUUID();
  if (!MARKETS[symbol]) return res.status(400).json({ error: 'Select a supported demo market' });
  if (!['buy','sell'].includes(side)) return res.status(400).json({ error: 'Order side must be buy or sell' });
  if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Enter a valid quantity' });
  if (quantity > 1000000) return res.status(400).json({ error: 'Quantity is above the demo limit' });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientOrderId)) return res.status(400).json({ error: 'Invalid order reference' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT id, client_order_id, symbol, side, quantity, price, notional, realized_pnl, status, created_at FROM paper_trades WHERE account_id=(SELECT id FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1) AND client_order_id=$2`, [req.user.sub, clientOrderId]);
    if (existing.rowCount) {
      await client.query('COMMIT');
      return res.status(200).json({ mode:'paper', idempotent:true, message:'This demo order was already processed.', trade: existing.rows[0], disclaimer:'This is simulated trading. No real order was sent to a broker or exchange.' });
    }
    const account = await getAccount(client, req.user.sub);
    if (!account) throw Object.assign(new Error('Trading account not found'), { status:404 });
    if (account.status !== 'active') throw Object.assign(new Error('Your trading account is not active'), { status:403 });
    const quotes = await getMarketQuotes();
    const price = quotes.markets.find(m => m.symbol === symbol)?.price;
    if (!Number.isFinite(price)) throw Object.assign(new Error('Market price is temporarily unavailable'), { status:503 });
    const notional = quantity * price;
    if (notional > maxOrderNotional()) throw Object.assign(new Error(`This demo order exceeds the ${maxOrderNotional().toLocaleString()} USD order limit`), { status:400 });
    const posResult = await client.query(`SELECT id, quantity, average_price FROM paper_positions WHERE account_id=$1 AND symbol=$2 FOR UPDATE`, [account.id, symbol]);
    const position = posResult.rows[0];
    let realized = 0;
    if (side === 'buy') {
      if (Number(account.cash_balance) < notional) throw Object.assign(new Error('Insufficient demo cash balance'), { status:400 });
      if (position) {
        const oldQty = Number(position.quantity), oldAvg = Number(position.average_price), newQty = oldQty + quantity;
        const newAvg = ((oldQty * oldAvg) + notional) / newQty;
        await client.query(`UPDATE paper_positions SET quantity=$1, average_price=$2, updated_at=NOW() WHERE id=$3`, [newQty, newAvg, position.id]);
      } else await client.query(`INSERT INTO paper_positions(account_id,symbol,quantity,average_price) VALUES($1,$2,$3,$4)`, [account.id, symbol, quantity, price]);
      const updated = await client.query(`UPDATE accounts SET cash_balance=cash_balance-$1, updated_at=NOW() WHERE id=$2 RETURNING cash_balance`, [notional, account.id]);
      await client.query(`INSERT INTO trading_ledger(account_id,client_order_id,entry_type,amount,balance_after,description) VALUES($1,$2,'trade_debit',$3,$4,$5)`, [account.id, clientOrderId, -notional, Number(updated.rows[0].cash_balance), `Demo purchase of ${quantity} ${symbol}`]);
    } else {
      if (!position || Number(position.quantity) + 1e-10 < quantity) throw Object.assign(new Error('You do not have enough of this position to sell'), { status:400 });
      realized = (price - Number(position.average_price)) * quantity;
      const remaining = Number(position.quantity) - quantity;
      if (remaining <= 1e-10) await client.query(`DELETE FROM paper_positions WHERE id=$1`, [position.id]);
      else await client.query(`UPDATE paper_positions SET quantity=$1, updated_at=NOW() WHERE id=$2`, [remaining, position.id]);
      const updated = await client.query(`UPDATE accounts SET cash_balance=cash_balance+$1, realized_pnl=realized_pnl+$2, updated_at=NOW() WHERE id=$3 RETURNING cash_balance`, [notional, realized, account.id]);
      await client.query(`INSERT INTO trading_ledger(account_id,client_order_id,entry_type,amount,balance_after,description) VALUES($1,$2,'trade_credit',$3,$4,$5)`, [account.id, clientOrderId, notional, Number(updated.rows[0].cash_balance), `Demo sale of ${quantity} ${symbol}`]);
    }
    const trade = await client.query(`INSERT INTO paper_trades(account_id,client_order_id,symbol,side,quantity,price,notional,realized_pnl) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,client_order_id,symbol,side,quantity,price,notional,realized_pnl,status,created_at`, [account.id,clientOrderId,symbol,side,quantity,price,notional,realized]);
    await client.query('COMMIT');
    res.status(201).json({ mode:'paper', message:`Demo ${side.toUpperCase()} order filled`, trade: trade.rows[0], disclaimer:'This is simulated trading. No real order was sent to a broker or exchange.' });
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    const status = error.status || 500;
    if (status === 500) console.error('Paper order error:', error);
    res.status(status).json({ error: error.message || 'Unable to place demo order' });
  } finally { client.release(); }
});

router.post('/reset', auth, async (req, res) => {
  if (process.env.DEMO_TRADING_MODE !== 'true') return res.status(404).json({ error:'Demo trading is disabled' });
  await ensureTradingTables();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await getAccount(client, req.user.sub);
    if (!account) throw Object.assign(new Error('Trading account not found'), { status:404 });
    await client.query('DELETE FROM paper_positions WHERE account_id=$1', [account.id]);
    await client.query('DELETE FROM paper_trades WHERE account_id=$1', [account.id]);
    await client.query('DELETE FROM trading_ledger WHERE account_id=$1', [account.id]);
    await client.query('UPDATE accounts SET cash_balance=10000, realized_pnl=0, updated_at=NOW() WHERE id=$1', [account.id]);
    await client.query('COMMIT');
    res.json({ message:'Demo account reset successfully', balance:10000 });
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    res.status(e.status || 500).json({error:e.message || 'Unable to reset demo account'});
  } finally { client.release(); }
});

module.exports = router;
