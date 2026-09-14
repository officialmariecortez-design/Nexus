# Nexus Markets backend

This backend is wired to the supplied static frontend and is ready for a Vercel + Supabase deployment.

## Local setup
1. Copy `.env.example` to `.env`.
2. Put your Supabase PostgreSQL connection string in `DATABASE_URL` and a long random value in `JWT_SECRET`.
3. Run `backend/src/db/schema.sql` in the Supabase SQL Editor.
4. Run `npm install` from the project root.
5. Run `npm start`.
6. Open `http://localhost:4000/`.

## API
- `GET /api/health` — API + database health.
- `POST /api/auth/register` — creates a user and a default trading account.
- `POST /api/auth/login` — signs in by email or username.
- `GET /api/auth/me` — returns the authenticated user using a Bearer token.

## Production
Vercel uses `api/index.js` and `vercel.json`. Supabase supplies PostgreSQL. Keep the database connection string and JWT secret in Vercel Environment Variables; never put them in the HTML or JavaScript.

This is an authentication/account foundation, not a complete brokerage engine. Do not connect real customer funds or live order execution until the required financial-services compliance, KYC/AML, authorization, audit logging, rate limiting, monitoring, and security review are complete.
