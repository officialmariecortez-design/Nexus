# Nexus Markets

Updated from the supplied website archive with the brand changed to Nexus.

The archive includes the original static frontend plus a new `backend/` Express/PostgreSQL structure. The backend is intentionally separated so it can be deployed independently or behind the same domain.

## Backend
See `backend/README.md` for setup instructions.

## Demo KYC workflow

The project now includes `/kyc.html` and backend endpoints under `/api/kyc`.

- `POST /api/kyc/submit` stores a KYC submission as `pending`.
- `GET /api/kyc/status` returns the authenticated user's KYC status.
- `POST /api/kyc/demo/approve` changes a pending record to `approved` only when `DEMO_KYC_MODE=true`.

This is intentionally a **demo backend workflow**, not a real KYC/AML verification service. It does not validate identity documents against government or third-party databases. Keep `DEMO_KYC_MODE=false` for production. The demo approval endpoint is only for controlled workflow testing and is not a substitute for a legitimate KYC/AML provider or compliance process.

## Demo trading phase
The `/trading.html` workspace is a paper-trading environment. It uses simulated quotes and a virtual USD balance. No broker/exchange orders are executed. Set `DEMO_TRADING_MODE=true` for the demo reset endpoint.

## Live crypto prices (CoinMarketCap)
`/markets.html` shows a live crypto price panel sourced from CoinMarketCap. Set `COINMARKETCAP_API_KEY` (get one at https://coinmarketcap.com/api/) in your environment. The key is only ever used server-side by `/api/market-prices/quotes`; it is never sent to the browser. Without a key the panel shows a friendly "not configured" message instead of failing silently.

## TradingView analytics
`/markets.html` and `/trading.html` embed official TradingView widgets (ticker tape, advanced chart, mini chart) using TradingView's public embed scripts. No API key is required. This replaces the broken iframe snapshots that shipped in the original scraped archive (they pointed at local "saved page" files that don't exist in a real deployment).

## AI support chatbot
A floating support-chat widget (`chatbot-widget.js`) is included on every customer-facing page. It calls `/api/chatbot/message`, which proxies to the Anthropic API server-side. Set `ANTHROPIC_API_KEY` (get one at https://console.anthropic.com/) and optionally `CHATBOT_MODEL` (defaults to `claude-sonnet-4-6`). The assistant is scoped to platform support (KYC/deposits/demo trading) and is instructed to never give financial advice or request credentials.

## Admin-controlled dashboard access
Admins can control which *dashboard sections* a signed-in customer's tier can see — the live price panel, analytics charts, the chatbot, individual deposit assets (BTC/USDT/SOL), and the demo trading workspace itself. This is deliberately scoped to feature visibility only: it never lets an admin alter what balance, positions or P&L a customer sees — those always come from the real ledger in `paper_trades`/`trading_ledger`, independent of this system.

- Assign a customer a tier (`standard`, `verified`, `vip`) from the admin dashboard's Customers tab.
- Toggle which features each tier can see from the admin dashboard's "Dashboard Access" tab.
- New customers default to `standard` with every feature visible, so nothing changes until an admin deliberately restricts something.
