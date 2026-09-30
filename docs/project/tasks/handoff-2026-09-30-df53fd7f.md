# Handoff 2026-09-30 — MVP stability (session df53fd7f)

Goal: uniseller cabinet + Telegram worker stable, deployable to one VPS (docker compose). Spec: `docs/project/specs/mvp-stability.md`.
Owner decisions: VPS + Docker, D1 local via wrangler on a volume; REGISTRATION_OPEN=false by default.

## Done
- Integration branch `task/mvp-stability-2026-09-30` (worktree `~/worktrees/wt-uniseller-mvp-stability`).
- Merged into it: PR #20 worker (A), PR #21 workspace API (B), PR #22 deploy/auth/CI (C); d06db23 origin check via APP_URL.
- PRs created via `scratchpad/pr.sh` (GitHub API + git credential) — `gh` is not installed.

## In flight
- Subtask D (client: error boundaries, api() timeout/non-JSON, polling guard, tsc/lint, lazy panels) in
  `~/worktrees/wt-uniseller-mvp-client`, branch `task/mvp-client-2026-09-30`.

## Next
1. Merge D → integration; full gate: `npm run lint && npx tsc --noEmit && npx vitest run && npm run build && npm audit --audit-level=high`.
2. Independent `code-reviewer` + `security-reviewer` (auth, cron, worker token, secrets re-seal) + `verifier` on `origin/dev...task/mvp-stability-2026-09-30`.
3. One PR integration → dev; merge when green; remove worktrees.
4. Owner's local DB: `npm run build && node scripts/d1-backup.mjs && npm run db:baseline -- --dry-run && npm run db:baseline && npm run db:migrate`.

## Open questions (owner)
- Viewer role can still edit leads/chats (no read-only mode).
- With registration closed, OAuth/Telegram also refuse unknown users.

## NOT verified
Docker/Caddy (no docker locally), live Telegram, real D1 concurrency (tested on better-sqlite3), pip install of requirements.txt.
