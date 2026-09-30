---
generated: 2026-09-30
source: session df53fd7f (manual; run /project-sync to regenerate)
---
# STATE — uniseller

## Now
- No leads since 2026-09-18: auto-learned stop list blocked buying intent. PR #30 `fix/lead-stoplist` (worktree `~/worktrees/wt-uniseller-fix-lead-stoplist`), gate green; next: code review → merge → stand rescan. Handoff: `docs/project/tasks/handoff-2026-09-30-085fb56e.md`.
- Security hardening: review findings fixed on `task/security-hardening-2026-09-30` (worktree `~/worktrees/wt-uniseller-security-hardening`): miniflare Local Explorer off (X_LOCAL_EXPLORER=false + Caddy `/cdn-cgi/*` 404, live-checked 200→404), global contact/register ceilings, TRUSTED_IP_HEADER unset = none, rate-limit cleanup isolated, staff invite origin = APP_URL. Cron self-calls via INTERNAL_APP_ORIGIN (compose: http://web:5173). Gate green (vitest 573/573, tsc 0, lint 0 errors, build ok, worker python 32/32). Next: security re-review → PR into `dev`. Handoff: `docs/project/tasks/handoff-2026-09-30-6f53256c.md`.
- Task MVP stability: integration branch `task/mvp-stability-2026-09-30` (worktree `~/worktrees/wt-uniseller-mvp-stability`, head 8ceb20c); PRs #20–#26 merged into it.
- Handoff: `docs/project/tasks/handoff-2026-09-30-df53fd7f.md`.
- Next: full gate → fix task-save overwrite → re-review (security + code) + verifier → one PR into `dev`.

## Blockers
- None. Docker/Caddy unverified locally (no docker).
