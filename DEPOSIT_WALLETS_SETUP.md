# Nexus Crypto Deposit Setup

Nexus now supports customer deposit records for exactly three asset types:

- BTC on the Bitcoin network
- USDT on an explicitly configured network (initial admin option: TRC20)
- SOL on the Solana network

## Important security rule
Only public receiving addresses belong in Nexus. Never enter a private key, seed phrase, signing key, exchange secret, or wallet password into the admin dashboard or database.

## First deployment
1. Deploy this build to Vercel with the existing Supabase `DATABASE_URL` and `JWT_SECRET`.
2. Open `/admin-login.html`.
3. Open **Deposit Wallets** in the admin dashboard.
4. Replace each inactive `SET_IN_ADMIN` placeholder with your real public receiving address.
5. Activate the wallet.
6. For USDT, confirm the network displayed to customers exactly matches the address you control.

## Customer flow
Customer -> Trading Dashboard -> Deposit Funds -> BTC / USDT / SOL -> exact network -> wallet address -> transaction hash -> submission for verification.

A submitted transaction hash does not automatically credit the customer's trading balance.

## Admin flow
Admin -> Deposits -> review transaction -> submitted / under review / confirmed / rejected.

The current build intentionally does NOT convert crypto deposits into USD trading balance merely because an admin clicks Confirm. Production crediting needs verified on-chain settlement plus a trusted valuation/conversion policy and reconciliation process.
