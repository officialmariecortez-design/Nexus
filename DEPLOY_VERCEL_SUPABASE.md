# Vercel + Supabase deployment

## Supabase
1. Create/open your Supabase project.
2. In SQL Editor, run `backend/src/db/schema.sql`.
3. Copy the PostgreSQL connection string from Supabase Database settings. Prefer the pooled connection string for serverless workloads.

## Vercel
1. Import this folder/project into Vercel.
2. Add these Environment Variables for Production (and Preview if desired):
   - `DATABASE_URL` = your Supabase PostgreSQL connection string
   - `JWT_SECRET` = a long random secret
   - `NODE_ENV` = `production`
3. Deploy.
4. Test `https://YOUR-DOMAIN/api/health` (it should return the service status; database status will be `ok` only after `DATABASE_URL` is configured).
5. Test `/register.html`, create an account, then test `/login.html`.

The frontend submits authentication requests to the same origin, so there is no separate frontend API URL to maintain.
