# Uniseller Leads

Private administration workspace for Telegram sources and sales leads.

## Implemented
- D1 persistence, per-user server authorization, same-origin mutations.
- CRUD accounts, proxies, groups and manually entered leads.
- Proxy import, account/proxy assignment, dependency validation on removal.
- AES-GCM encrypted proxy passwords and OpenAI API keys.
- OpenAI Responses API draft generation and manual editing/copying.
- Russian responsive UI inspired by Air on Refero Styles.

## Not implemented yet
Telegram authorization / tdata import, joining groups, proxy connectivity checks, background message collection, automatic lead qualification and Telegram sending. These require a separate long-running Telegram connector; Sites has no raw TCP support. UI labels these limitations.

## Development
1. Copy `.env.example` to `.env` and set secrets:
   - `ENCRYPTION_KEY` — 64 hex chars (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `SESSION_SECRET` — at least 32 random chars
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` — hash via `npm run auth:hash -- 'your-password'` (colon-separated `pbkdf2:...`, no `$`)
2. `npm run install:ci`
3. `npm run build`
4. Apply D1 migration once (local wrangler state):
   `node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --persist-to .wrangler/state --config dist/server/wrangler.json --file drizzle/0000_even_hydra.sql`
5. `npm run dev -- --host 127.0.0.1 --port 5173`
6. Open http://localhost:5173/login

Runtime DB is Cloudflare D1 (local file under `.wrangler/state`). `better-sqlite3` is only for optional Node scripts (`npm run db:migrate`).

## Not implemented yet
Telegram authorization / tdata import, joining groups, proxy connectivity checks, background message collection, automatic lead qualification and Telegram sending. These require a separate long-running Telegram connector; Sites has no raw TCP support. UI labels these limitations.

## Validation
Build and TypeScript pass. Local HTTP checks cover authentication, origin rejection, input validation, secret redaction, CRUD, references and missing AI configuration. Live Telegram and OpenAI calls have not been tested.

Motion references: Fade Slide Tabs by Ruixen UI and Animate Digits by unlumen on 21st.dev. Admin visual language inspired by Spike (WrapPixel): Plus Jakarta Sans, `#0085db`, light paper cards on `#F0F5F9`.

