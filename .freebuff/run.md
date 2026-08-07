# Happa Trademart — Run Doc

## Reproduce artifacts
This app is a plain vanilla-JS SPA (no build step, no bundler, no compiled assets).

- **No build artifacts to reproduce.** All source files (`index.html`, `css/style.css`, `js/*.js`, `server.js`) are served as-is.
- **Dependencies:** only `express`, `bcryptjs`, `jsonwebtoken`, `cors`, `dotenv` (see `package.json`). Install once with `npm install` (or `npm ci` if a lockfile exists).
- **Environment:** copy `.env.local` from the main checkout into this directory if it exists (holds `SUPABASE_URL` / `SUPABASE_ANON_KEY`). The server starts fine without it — it falls back to the local `db.json` file, but live Supabase features (cross-device data) need the keys.
- **Local data:** `db.json` in the project root is the local database; it is seeded automatically on first boot if empty.

## Run the server
```bash
PORT=54321 node server.js
```
- Default port is `9000` if `PORT` is unset; use `54321` for the live preview.
- The server listens on `http://localhost:54321` and serves the SPA + `/api/*` REST routes.
- `npm start` / `npm run dev` both run `node server.js`.
- Health check: `curl http://localhost:54321/` should return 200.
- Tests (no npm script): `node test/api.test.js`.
