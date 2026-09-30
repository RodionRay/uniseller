# Handoff 2026-09-30 — MVP stability (session df53fd7f)

Goal: uniseller cabinet + Telegram worker stable, deployable to one VPS (docker compose). Spec: `docs/project/specs/mvp-stability.md`.
Owner decisions: VPS + Docker, D1 local via wrangler on a volume; REGISTRATION_OPEN=false by default.

## Done (all merged into integration `task/mvp-stability-2026-09-30`, worktree `~/worktrees/wt-uniseller-mvp-stability`, head 8ceb20c)
- Wave 1: PR #20 worker, #21 workspace API (locks, partial writes, staff access), #22 deploy/auth/CI, #23 client; d06db23 origin via APP_URL.
- Review round 1 (code-reviewer REQUEST_CHANGES, security BLOCK, verifier GAPS_FOUND) → fixes: #24 security (session leak,
  open redirect, login throttle, constant-time, OAuth verified email), #25 worker/infra (output caps, abort kill, flood
  classes, env allowlist, Caddy blocks /api/cron, CI python, Sites cleanup), #26 API (flood cooldown, tick budget 100 s +
  more:true, per-send progress, timeouts, logging).
- PRs via `/private/tmp/claude-501/-Users-rodiontipcov/df53fd7f-c5ee-4241-a9e7-035d282d350b/scratchpad/pr.sh create|merge`
  (GitHub API + git credential; `gh` not installed). If scratchpad is gone: recreate (curl POST /repos/RodionRay/uniseller/pulls).

## Next (atomic steps)
1. Full gate in integration worktree: `npm run lint && npx tsc --noEmit && npx vitest run && python3 -m unittest discover -s telegram-worker/tests && npm run build && npm audit --audit-level=high`.
2. Known open (from #26): UI "save" of a mailing/invite task writes the whole record → can overwrite tick progress (duplicate DM risk) → field-level save excluding progress fields; upload_account_photos / apply_account_profiles / tick_audience have no time budget.
3. Re-run `security-reviewer` + `code-reviewer` on `origin/dev...HEAD` (fix delta) and `verifier`; fix blockers.
4. One PR integration → dev (body: REQ matrix + NOT verified), merge when green; remove worktrees wt-uniseller-mvp-*; delete memory handoffs `~/.claude/projects/-Users-rodiontipcov/memory/handoff-2026-09-30-df53fd7f*.md` (belong in repo).
5. Owner local DB after merge: `npm run build && node scripts/d1-backup.mjs && npm run db:baseline -- --dry-run && npm run db:baseline && npm run db:migrate`.

## Open questions (owner)
- Viewer role can still edit leads/chats (no read-only mode).
- With registration closed, OAuth/Telegram also refuse unknown users.
- A subagent ran `pkill -f cat` (may have killed unrelated user processes); 5180/8790 confirmed alive.

## NOT verified
Docker/Caddy (no docker locally), live Telegram, real OAuth logins, CI on GitHub, pip install of requirements.txt.
