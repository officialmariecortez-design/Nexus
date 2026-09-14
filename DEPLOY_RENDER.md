# Deploying to Render

This project no longer needs `vercel.json` or `api/index.js` — those were only there to wrap
the Express app as a Vercel serverless function. Render runs `backend/src/server.js` directly
as a normal, always-on Node process (it already calls `app.listen()` and reads `process.env.PORT`).

## 1. Push to GitHub
Render deploys from a GitHub repo, same as Vercel. Push this project to a repo if it isn't there already.

## 2. Create the service
1. In the Render dashboard: **New > Web Service**.
2. Connect your GitHub repo.
3. Render should auto-detect `render.yaml` in the repo root and pre-fill everything (build command
   `npm install`, start command `npm start`, Node runtime). If it doesn't pick it up automatically,
   choose "Apply render.yaml" or set Build Command / Start Command manually to match.
4. Pick the **Starter** plan (not Free) if this will have real users — the Free tier spins down after
   15 minutes of inactivity, which means KYC submissions and deposit checks would hit a ~1 minute cold
   start on the first request. Starter (~$7/mo) is always-on.

## 3. Set environment variables
`render.yaml` lists every variable the app uses. The ones marked `sync: false` need to be entered
manually in the Render dashboard (Environment tab) — same values you'd have used on Vercel:
- `DATABASE_URL` — your Supabase **pooled** connection string (same one you were already using)
- `JWT_SECRET`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- `CORS_ORIGIN` — your final domain, e.g. `https://www.yourdomain.com`
- `COINMARKETCAP_API_KEY`, `ANTHROPIC_API_KEY`, `TWELVE_DATA_API_KEY` as needed

## 4. Deploy and test
- Test `https://YOUR-RENDER-URL/api/health` first — should return `database: "ok"` once
  `DATABASE_URL` is set correctly.
- Test `/register.html`, then `/login.html`, then `/admin-login.html`.

## 5. Custom domain
See the "Connecting your existing domain" section below — no registrar transfer needed.
