# Happa Trademart — Run Doc

## Reproduce artifacts
This app is a plain vanilla-JS SPA (no build step, no bundler, no compiled assets).

- **No build artifacts to reproduce.** All source files (`index.html`, `css/style.css`, `js/*.js`, `server.js`) are served as-is.
- **Dependencies:** only `express`, `bcryptjs`, `jsonwebtoken`, `cors`, `dotenv` (see `package.json`). Install once with `npm install` (or `npm ci` if a lockfile exists).
- **Environment:** The repo ships a `.env` that points at the Supabase project (`SUPABASE_URL` + `SUPABASE_KEY`). For a safe local-only preview, override both to local-only values so the server never touches the production Supabase project:
  - `SUPABASE_URL=http://localhost:9000`
  - `SUPABASE_KEY=local-anon-key-for-preview`
  - `PORT=9000`
  Append these lines to `.env` (do NOT copy real Supabase keys into a preview worktree).
- **Local data:** `db.json` in the project root is the local database; it is seeded automatically on first boot if empty.

## Run the server
```bash
PORT=9000 node server.js
```
- The server listens on `http://localhost:9000` and serves the SPA + `/api/*` REST routes.
- `npm start` / `npm run dev` both run `node server.js`.
- Health check: `curl http://localhost:9000/` should return 200.
- The `/api/settings` endpoint confirms the server is wired up: `curl http://localhost:9000/api/settings` returns a JSON array of settings.
- Tests (no npm script): `node test/api.test.js`.
- **Detach (Windows):** use the `Start-Process` recipe from `.freebuff/run.md` with `node.exe server.js`.
  Name the executable exactly (`node.exe`) — `Start-Process` does not resolve shell shims.
  stdout and stderr must go to DIFFERENT files; PowerShell fails if both point at one path.
  Confirm the listener pid with `netstat -ano | findstr :9000 | findstr LISTENING`, then `Get-Process -Id <pid>`.
  Note: the detach prints a pid, but node may restart under a new pid; always register the LISTENING pid, not necessarily the printed one.
