# Uniseller Leads

Private administration workspace for Telegram sources and sales leads.

## Implemented
- D1 persistence, per-user server authorization, same-origin mutations.
- CRUD accounts, proxies, groups and manually entered leads.
- Proxy import, account/proxy assignment, dependency validation on removal.
- AES-GCM encrypted proxy passwords and OpenAI API keys.
- OpenAI Responses API draft generation and manual editing/copying.
- Floating AI assistant (bottom-right) for product Q&A on admin and `/site` selling page.
- Public `POST /api/assistant` with rate limit and knowledge-base fallback when no API key.
- Russian responsive UI inspired by Air on Refero Styles.

## Not implemented yet
Telegram authorization / tdata import, joining groups, proxy connectivity checks, background message collection, automatic lead qualification and Telegram sending. These require a separate long-running Telegram connector; Sites has no raw TCP support. UI labels these limitations.

## Development
Run npm install, npm run db:generate and npm run build. Apply generated migrations locally using Wrangler D1 with .wrangler/state, then npm run dev. Local sign-in is /signin-with-chatgpt?return_to=%2F.

Set ENCRYPTION_KEY to a stable, random 32-byte hex secret in local .env and hosted runtime settings. Do not rotate without migrating encrypted values. Never commit .env or Telegram sessions.

## Validation
Build and TypeScript pass. Run automated checks with `npm test` (accounts, invites, lead search, mailings, assistant chat, proxy import, auth paths, secrets). Local HTTP checks still cover authentication, origin rejection and live CRUD against D1. Set `OPENAI_API_KEY` or `ASSISTANT_OPENAI_KEY` for live assistant replies; without a key the widget answers from the product knowledge base. Live Telegram calls have not been tested.

Motion references: Fade Slide Tabs by Ruixen UI and Animate Digits by unlumen on 21st.dev. Original lightweight CSS implementations preserve existing Radix controls; all nonessential animation respects prefers-reduced-motion.
