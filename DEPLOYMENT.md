# MetalMundi — Deployment & Operations Guide

Monorepo (npm workspaces): `client/` React + Vite, `server/` Express + Prisma + PostgreSQL.
Production deployment is a **single Render Web Service** (free tier): the Express server
mounts the API at `/api/v1` **and serves the built React app** from `client/dist`
(SPA fallback in `server/src/app.js`). There is no separate frontend host.

## Environment variables

### Client (build time, `client/.env` — gitignored, read by `vite build`)

| Var | Value | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | **unset** for the single-service deployment | Defaults to relative `/api/v1`. Only set a full `https://…` URL if client and API become separate services. |

> ⚠️ **Never set `VITE_API_BASE_URL=http://localhost:5000/api/v1` and then run `npm run build`.**
> Vite bakes it into `client/dist`, `client/dist` is committed, and production browsers then call
> their own localhost — every API list renders empty. Dev does not need it: `vite.config.js` proxies
> `/api`, `/socket.io` and `/uploads` to `:5000`. After any rebuild, verify:
> `grep -c "localhost:5000" client/dist/assets/index-*.js` → must be `0`.

### Server (runtime, Render dashboard or `server/.env` locally)

| Var | Required | Example | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | Render Postgres **internal** URL | Server refuses to start in production without real secrets. |
| `PORT` | provided by Render | `10000` | Local default 5000. |
| `JWT_SECRET`, `COOKIE_SECRET` | yes | long random strings | Dev fallbacks are rejected when `NODE_ENV=production`. |
| `JWT_EXPIRES_IN` | no | `7d` | |
| `CLIENT_URL`, `CORS_ORIGINS`, `API_PUBLIC_URL` | yes | `https://matalmundi.onrender.com` | `CORS_ORIGINS` is comma-separated. Also feeds the helmet CSP `connect-src`. Same-origin requests are always allowed. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | yes | real prod credentials | `seed:admin` runs on every boot and re-applies these. |
| `CLOUDINARY_*` | no | | Empty ⇒ local-disk `/uploads`, which is **ephemeral on free tier** (wiped on redeploy). |
| `ML_SERVICE_URL` | no | | AI-image screening microservice. |
| `NODE_ENV` | **do not set as a build-time env var** | | npm would skip devDeps (vite/prisma CLI) and break the build. It is applied inline in the Start Command only. |

## Render configuration (free tier — no Pre-Deploy Command, no Shell)

- Root Directory: repo root. Health check path: `/api/v1/health`.
- **Build Command**

```
npm --prefix server install --include=dev && npm --prefix client install --include=dev && npm --prefix client run build
```

- **Start Command** (everything in it is idempotent and safe on every boot)

```
npm run prisma:deploy && npm run seed:admin && npm run seed:categories && NODE_ENV=production npm start
```

`prisma:deploy` applies migrations (`table 'public.users' does not exist` = this step missing),
`seed:admin` ensures the admin + original pricing rules, `seed:categories` upserts the
10 material categories by slug.

## Local development

```
docker compose up -d db          # PostgreSQL 16 in container `metalmundi`
npm run seed:admin && npm run seed:categories
npm run dev                      # API :5000 + Vite :5173 (proxied)
```

## Test & verification commands

```
npm test                 # server Jest suite (uses separate metalmundi_test DB)
npm run test:client      # client Vitest + React Testing Library
npm run smoke -- https://matalmundi.onrender.com   # production smoke checks
```

`scripts/smoke-test.js` verifies: `/health`, `/health/db`, the 10 categories present,
401 on protected routes, JSON 404 on unknown API routes, CORS preflight from the
frontend origin, SPA HTML loads, and **the served JS bundle contains no localhost URL**.

### Post-deploy checklist

1. `npm run smoke -- https://matalmundi.onrender.com` — all green.
2. Render logs show the startup banner, `PostgreSQL connected`, no migration errors.
3. Sign up / log in in a browser (remember ~30–60 s cold start on free tier — the UI now
   shows a "server may be waking up" message instead of a silent empty list).
4. Break something deliberately (e.g. request `/api/v1/nope`) and confirm the JSON 404
   and the client error state render.

## Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| Lists empty only in production, network tab shows `localhost:5000` | Absolute `VITE_API_BASE_URL` baked into `client/dist` | Unset it, `npm run build`, commit dist; verify with smoke check #8 |
| Console: CSP `connect-src` blocked | helmet CSP default (`'self'`) with a cross-origin API | Keep same-origin deployment, or add the API origin to `API_PUBLIC_URL`/`CORS_ORIGINS` (they feed `connect-src`) |
| `Origin not allowed by CORS` on login | `CORS_ORIGINS`/`CLIENT_URL` missing the real frontend origin | Set them to the Render URL |
| `The table 'public.users' does not exist` / API 503 `DB_SCHEMA` | Migrations never applied | `prisma:deploy` in the Start Command (see above) |
| Categories endpoint returns `[]` | Seed not run | Add `npm run seed:categories` to the Start Command; it is idempotent |
| Login/register 500 after deploy | `JWT_SECRET`/`COOKIE_SECRET` unset (dev fallback refused in prod) | Set both secrets and restart |
| First request after idle hangs or fails | Render free-tier cold start (~30–60 s) | Expected; client shows the "waking up" message; upgrade tier to remove |
| Uploaded images vanish after redeploy | Free-tier filesystem is ephemeral | Configure `CLOUDINARY_*` |
