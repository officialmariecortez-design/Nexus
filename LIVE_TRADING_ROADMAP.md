# Nexus Live Trading Roadmap

The current build is a paper-trading environment only. It must not be represented as live execution.

## Completed in this build
- Authenticated demo trading workspace
- Virtual USD balance
- Buy/sell simulation
- Position management
- Average entry price
- Realized and unrealized P&L
- Trade history
- Transaction-safe order updates
- Demo account reset

## Next engineering stage: real market data
Introduce a provider abstraction so market quotes come from a licensed/appropriate market-data provider. Keep paper execution separate from live execution.

## Live execution stage
Before enabling live orders, add:
- Broker/exchange adapter with explicit order states
- Idempotency keys for order submission
- Execution/fill records
- Position and cash ledger with immutable transaction entries
- Fees, spreads and financing where applicable
- Risk checks and account permissions
- Reconciliation jobs
- Audit logs
- Rate limiting and fraud controls
- Webhook signature verification
- Secrets management
- Monitoring and alerting
- Production KYC/AML/sanctions/PEP workflow
- Jurisdiction-specific legal/compliance review

Only after these controls are tested should live execution be enabled.

## Newly completed engineering stage
- Demo order idempotency keys.
- Cash activity ledger for paper trades.
- Configurable demo order limits.
- Cached schema initialization.
- Explicit live-execution feature gate.

## Immediate next stage
- Implement a broker/exchange adapter interface without enabling live orders.
- Add order states (created, submitted, accepted, partially_filled, filled, canceled, rejected).
- Add execution/fill records and reconciliation model.
- Add risk pre-trade checks and account permission states.
- Replace localStorage JWT sessions with secure HttpOnly cookies before production use.
