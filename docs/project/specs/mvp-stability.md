---
slug: mvp-stability
status: in-progress
size: full
model: claude-opus-5-5 (inherit)
budget: 600M tokens
branch: task/mvp-stability-2026-09-30 (integration, base dev)
owner-decisions: 2026-09-30 — target = one VPS, docker-compose (web + telegram worker), D1 local via wrangler; self-registration off by flag
---

# MVP stability & launch readiness

Goal: cabinet (`/app`) + Telegram worker run without crashes, data races or silent failures, and deploy to one VPS
with `docker compose up -d` (HTTPS, restart, healthcheck, backups). Source: 3 audits 2026-09-30 (gates, runtime, deploy).

## Baseline (origin/dev 6bdc99c)
lint 270 errors · tsc 52 errors · vitest 85/85 · build OK (733 kB chunk) · npm audit 9 high · Docker broken.

## Requirements (EARS)
Worker (wave 1, subtask A — `telegram-worker/**`, `scripts/dev-local.mjs`)
- REQ-W1 When the Python child fails to spawn or dies before reading stdin, the worker shall answer `{ok:false}` and stay up.
- REQ-W2 The worker shall log and survive unhandledRejection/uncaughtException; on EADDRINUSE it shall exit cleanly if its own /health answers.
- REQ-W3 On timeout the worker shall SIGTERM then SIGKILL after grace; temp dirs `uniseller-acc-*` older than 10 min shall be removed.
- REQ-W4 The worker shall cap concurrent Python processes (default 4) and serialise per account; stdout/stderr capped at 1 MB.
- REQ-W5 Auto-rescan catch-up shall re-fire only when work was done or is queued; backoff otherwise.
- REQ-W6 FloodWait shall be reported as status `flood` + waitSec (no substring "420"/"flood" misclassification); flood_sleep_threshold=0.
- REQ-W7 A refreshed session (CreateNewSession) shall be returned to the app and re-sealed, never silently discarded.
- REQ-W8 `telegram-worker/requirements.txt` pinned; dev-local restarts web and worker with backoff reset after 60 s uptime and a max-attempts stop; stale reused worker (version/appUrl mismatch) restarted.

Workspace API (wave 1, subtask B — `app/api/workspace/**`, `app/api/cron/**`, `lib/processes/**`, `lib/server-store.ts`, `tests/*` it touches)
- REQ-B1 Every worker call for an account shall hold an atomic per-account lease (CAS UPDATE, changes=1).
- REQ-B2 tick_mailing / tick_invite / tick_audience / scan_group shall take an atomic CAS lock; concurrent tick → no duplicate DMs/invites/leads.
- REQ-B3 Long operations shall write only the fields they own (json_set), never the whole blob read before the call.
- REQ-B4 Workspace POST shall enforce staff `access` per action (403 otherwise).
- REQ-B5 Staff lookup failure → 503, never fallback to own owner id; one corrupt row → skipped + logged, not 503 for all.
- REQ-B6 All API catch blocks shall log action + owner + stack; responses stay JSON.
- REQ-B7 Cron: round-robin over all owners (persisted cursor); poll_dm bounded by remaining budget; server-side tick lock.
- REQ-B8 poll_dm_replies ≤2 accounts per call with a total time budget.

Platform & deploy (wave 1, subtask C — Docker, CI, auth, health, config, docs, package.json)
- REQ-C1 `docker compose up -d` on a clean Linux VPS starts web + worker, D1 state on a volume, migrations applied via `wrangler d1 migrations apply`, HEALTHCHECK on both, `restart: unless-stopped`, log rotation; Caddy HTTPS example.
- REQ-C2 Required env validated at startup/health (ENCRYPTION_KEY, SESSION_SECRET, TG_WORKER_TOKEN, CRON_SECRET, APP_URL); worker refuses empty token outside dev; dedicated CRON_SECRET.
- REQ-C3 `REGISTRATION_OPEN` (default false) gates `/api/auth/register`; per-IP+email login throttle; contact endpoint rate limit + fetch timeout; cookie `secure` when APP_URL is https; OAuth callbacks from APP_URL.
- REQ-C4 Schema drift fixed: runtime-created tables in `db/schema.ts` + migrations journal consistent.
- REQ-C5 Backup script: nightly D1 export + restore doc; ENCRYPTION_KEY stored separately.
- REQ-C6 CI workflow: lint, tsc, vitest, build, `npm audit --audit-level=high`; high vulns fixed.
- REQ-C7 README / deploy doc rewritten to reality; `uniseller-project.zip`, Sites leftovers removed.

Client (wave 1, subtask D — `app/app/**`, `components/**`, `hooks/**`, `app/error.tsx`)
- REQ-D1 `app/app/error.tsx` + `app/global-error.tsx`: a render throw shows a recoverable error, not a blank page.
- REQ-D2 Client `api()` tolerates non-JSON responses and has a timeout; polling does not stack.
- REQ-D3 tsc/lint errors in client files fixed (incl. onClick passing the event as `preferredMarket`).
- REQ-D4 Heavy panels lazy-loaded; main chunk < 500 kB if feasible without behaviour change.

Gate (integration): lint 0 errors (`no-explicit-any` → warn, ratchet later — DECISIONS), tsc 0, vitest green, build, audit high = 0.

## Verification
Per REQ: unit tests (vitest) for locks/CAS, error handling, throttles; worker tests via node test with a fake python;
`docker compose build && up` smoke if Docker is available locally, else NOT_VERIFIED (no docker); live Telegram = NOT verified.
