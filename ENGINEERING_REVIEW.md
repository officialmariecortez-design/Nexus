# Nexus Engineering Review — 2026-08-19

## Fixed in this build
- Fixed paper-trading schema mismatch: `accounts.updated_at` was used by order/reset code but was not defined in the base schema.
- Added `accounts.realized_pnl` and trading columns to the base schema for consistent fresh deployments.
- Added a market-data abstraction with simulated mode and optional Twelve Data real quotes.
- Added 5-second quote caching for the external provider to reduce repeated requests.
- Removed the fragile legacy KYC PATCH router recursion and routed PATCH/POST through the same update handler.
- Tightened CORS: no cross-origin access is enabled unless `CORS_ORIGIN` is explicitly configured.
- Tightened production PostgreSQL TLS validation by default.
- Removed legacy standalone HTML entry pages that could confuse navigation.

## Remaining production blockers
- Real broker/exchange execution adapter.
- Order idempotency and broker-side reconciliation.
- Double-entry or equivalent immutable transaction ledger.
- Margin/leverage/risk engine.
- Funding and withdrawal controls.
- Real KYC provider, document handling, AML/sanctions/PEP screening.
- Password reset/email verification/MFA.
- Rate limiting and abuse controls.
- HttpOnly secure session cookies rather than localStorage JWTs.
- Audit logging and security monitoring.
- Regulatory/legal review before offering live financial services.

## Market data
Set `MARKET_DATA_MODE=real` and provide `TWELVE_DATA_API_KEY` to use Twelve Data quotes. The paper engine remains simulated execution; no broker order is created by this mode.

## Additional fixes in this stage
- Trading schema initialization is cached per application instance instead of issuing DDL on every request.
- Added demo-order idempotency using a client order UUID to prevent accidental duplicate fills on retries.
- Added a trading ledger for cash debits/credits associated with simulated orders.
- Added a configurable maximum demo order notional.
- Added an explicit LIVE_TRADING_ENABLED guard; this build still has no live execution adapter.
- Added clearer trading account error handling and trade-history/ledger endpoints.
