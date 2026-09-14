# Nexus Pre-Launch Portfolio Controls

This build adds controlled pre-launch portfolio/accounting controls.

## Customer-facing presentation
The UI uses a professional **Staging Account** disclosure rather than exposing internal terms such as `demo trade` or `test trade` throughout the customer experience. It must remain clear that the account is not a live brokerage account.

## Admin controls
Admin → Portfolio Controls → select customer.

The admin can record:
- Profit/Loss adjustment (+/-)
- Cash balance adjustment (+/-)
- A required reason/note

Every adjustment is stored in `portfolio_adjustments` with the admin identity and timestamp.

## Market-linked P/L
Existing positions continue to use the current market quote returned by the market-data layer. Unrealized P/L is recalculated from:

`quantity × current_price - quantity × average_price`

The customer account response now exposes:
- `unrealized_pnl`
- `realized_pnl`
- `admin_adjusted_pnl`
- `total_pnl`
- `equity`

## Deposits
BTC, USDT and SOL deposit submissions remain separate from trading-account balances. An admin confirmation of a crypto deposit is not an automatic blockchain credit. Production funding must verify the transaction on-chain and apply a documented valuation/ledger policy.
