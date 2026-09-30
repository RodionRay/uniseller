# Uniseller Leads

Кабинет для поиска тёплых заявок в Telegram: аккаунты, прокси, группы, лиды, рассылки и инвайты.
Два процесса: веб-приложение (vinext / React, сервер — wrangler/workerd, база — локальная Cloudflare D1)
и Telegram-воркер (Node HTTP + Python/Telethon).

## Что работает сейчас
- **Аккаунты Telegram**: импорт `tdata` и `.session` (архивы zip/rar), проверка аккаунта, профили и фото,
  назначение прокси; прокси — импорт списком, проверка SOCKS5/HTTP (`lib/proxy-check.ts`).
- **Группы и лиды**: вступление в группы (`lib/processes/join-flow.ts`), сканирование сообщений и отбор
  лидов (`lib/processes/scan-flow.ts`, `lib/lead-*.ts`), AI-черновики ответов и отправка после подтверждения.
- **Рассылки и инвайты**: `lib/processes/mailing-tick.ts`, `lib/processes/invite-tick.ts`, сбор аудитории.
- **Автообход**: воркер каждые 5 минут вызывает `POST /api/cron/auto-rescan` (Bearer `CRON_SECRET`);
  в продакшене — по сети compose, снаружи Caddy закрывает `/api/cron/*`.
- **Воркер**: один Python-процесс на запрос, лимит параллельных процессов, очередь на аккаунт, таймауты
  SIGTERM → SIGKILL; Python получает только окружение интерпретатора, без секретов приложения;
  FloodWait возвращается как `status: "flood"` + `waitSec` (инвайт пока — `status: "floodwait"` + `flood`).
- **Вход**: email + пароль, Google / Яндекс / VK OAuth, Telegram Login; администратор из env.
  Самостоятельная регистрация закрыта, пока `REGISTRATION_OPEN` не равен `true`
  (это касается и новых пользователей через OAuth/Telegram). Вход ограничен: 10 неудачных попыток на пару
  IP + email за 15 минут, затем `429`.
- **Сотрудники**: приглашения в кабинет с ролями и доступами (`lib/staff.ts`).
- **Здоровье**: `GET /api/health` — D1, обязательные переменные окружения (только имена, без значений),
  доступность воркера; `503`, если что-то не так.

Секретные поля записей (`records.secret`: пароли прокси, ключи, данные сессий) шифруются AES-GCM ключом
`ENCRYPTION_KEY` — без него данные из бэкапа не расшифровать.

## Локальный запуск
1. `cp .env.example .env` и заполнить обязательные переменные (команды генерации — в `.env.example`).
   Пароль администратора: `npm run auth:hash -- 'пароль'` → `ADMIN_PASSWORD_HASH`.
2. `npm install`
3. Воркер: `cd telegram-worker && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt`
4. База: `npm run build && npm run db:migrate` (локальная D1 в `.wrangler/state`).
5. `npm run dev` — кабинет (http://localhost:5173) и воркер одной командой.

Продакшн-сборка локально: `npm run build && npm start` (тот же сервер, что в Docker).

## База данных и миграции
Схема — `db/schema.ts`, миграции генерирует `npm run db:generate` (drizzle-kit) в `drizzle/`.
Применяются одной командой: **`npm run db:migrate`** (`wrangler d1 migrations apply DB --local`, учёт в
таблице `d1_migrations`; каталог задан `migrations_dir` в `vite.config.ts`). Все миграции написаны как
`CREATE ... IF NOT EXISTS`, поэтому безопасны на базе, где таблицы уже есть.

Существующая локальная база, созданная до этой схемы (0000 вручную, остальные таблицы — во время работы):
```sh
npm run build
npm run db:baseline -- --dry-run   # покажет, какие миграции будут отмечены применёнными
npm run db:baseline                # отметит их в d1_migrations (только если все их таблицы уже есть)
npm run db:migrate                 # применит оставшиеся (0002 при отсутствии таблиц, 0003 rate_limits)
```
Резервную копию перед этим — `node scripts/d1-backup.mjs` (см. `docs/DEPLOY.md`).

## Проверки
`npm run lint` · `npx tsc --noEmit` · `npx vitest run` ·
`python3 -m unittest discover -s telegram-worker/tests` (без Telethon) · `npm run build` ·
`npm audit --audit-level=high` — то же выполняет CI (`.github/workflows/ci.yml`).

Служебные скрипты локальной D1 (`D1_PERSIST_DIR`, по умолчанию `.wrangler/state`):
`node scripts/d1-backup.mjs`, `npm run heal:joinstate`, `npm run seed:tgstat-catalog` (см. `docs/DEPLOY.md`).

## Развёртывание
Один Linux VPS, `docker compose` (web + worker), Caddy для HTTPS, ежедневный бэкап D1:
**[docs/DEPLOY.md](docs/DEPLOY.md)**.
