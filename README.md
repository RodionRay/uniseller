# Uniseller Leads

Кабинет для поиска тёплых заявок в Telegram: аккаунты, прокси, группы, лиды, рассылки и инвайты.
Два процесса: веб-приложение (vinext / React, сервер — wrangler/workerd, база — локальная Cloudflare D1)
и Telegram-воркер (Node HTTP + Python/Telethon).

## Что работает сейчас
- **Аккаунты Telegram**: импорт `tdata` и `.session` (архивы zip/rar), проверка аккаунта, профили и фото,
  назначение прокси; прокси — импорт списком, проверка SOCKS5/HTTP через воркер (`check_proxy`).
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
  (это касается и новых пользователей через OAuth/Telegram). OAuth по почте привязывается только к аккаунту
  без пароля и только с подтверждённой провайдером почтой. Вход ограничен, затем `429` (см. «IP клиента и лимиты»).
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

### Telegram-воркер (`telegram-worker/`)
- Python-зависимости закреплены в `telegram-worker/requirements.txt` (Python 3.10–3.11; Docker — 3.11).
- `telegram-worker/src/server.mjs` не стартует без `TG_WORKER_TOKEN` (≥32 символов, в том числе локально);
  приложение шлёт его как `Authorization: Bearer …`. Принимаются только `Host: 127.0.0.1:<порт>` /
  `localhost:<порт>` (дополнительные — `TG_WORKER_ALLOWED_HOSTS`) и `Content-Type: application/json`.
  `/health` без токена отдаёт только `{ok, service}`; с токеном — версию, `appUrl`, очередь и состояние автообхода.
- Лимиты (`telegram-worker/src/worker-app.mjs`): `TG_WORKER_MAX_CONCURRENCY` Python-процессов (4), сверх них
  до `TG_WORKER_MAX_QUEUE` (64) запросов ждут, дальше `429`; тело до `TG_WORKER_MAX_BODY_BYTES` (6000000, дальше `413`);
  архив аккаунта — до 5000 файлов / 200 МБ после распаковки; прокси во внутренние сети
  (loopback/private/link-local/CGNAT/multicast) отклоняются.
- Сессия распаковывается в каталог `uniseller-acc-*` (0700), который создаёт и всегда удаляет Node
  (таймаут → SIGTERM, через 5 с SIGKILL); забытые каталоги старше 10 минут удаляются при старте и каждые 5 минут.
- Автообход: `CRON_SECRET` (≥32 символов, одинаковый у кабинета и воркера, отдельный от `TG_WORKER_TOKEN`) обязателен —
  без него воркер один раз предупреждает при старте и пропускает тики. Секрет уходит только на https, loopback
  или хост из `TG_WORKER_CRON_HTTP_HOSTS` (Docker: `web`). Кабинет вызывает сам себя с сессиями владельцев
  только по `INTERNAL_APP_ORIGIN` (Docker: `http://web:5173`, иначе `APP_URL`; `lib/env.ts::internalAppOrigin`),
  не по адресу из запроса; http — только loopback или хост из того же списка.
- `npm run dev`: если `TG_WORKER_TOKEN` / `CRON_SECRET` нет ни в окружении, ни в `.env`, генерируются случайные
  значения на этот запуск (в `.env` не пишутся); воркер со старыми секретами перезапускается.

### IP клиента и лимиты
- Лимиты по IP (`login-ip`, `register-ip`, `contact-ip`, `assistant-anon-ip` в
  `lib/security/rate-limit.ts::RATE_LIMITS`) берут IP из заголовка `TRUSTED_IP_HEADER`
  (`lib/security/client-ip.ts::trustedClientIp`); без переменной (или `none`) заголовку не доверяют;
  `X-Forwarded-For` не читается.
- Прокси перед приложением **обязан перезаписывать** этот заголовок. Без такого прокси (локально, Docker/VPS через
  `wrangler dev --local`, который пропускает присланный клиентом `CF-Connecting-IP`) — `TRUSTED_IP_HEADER=none`.
  Docker так и поставляется; с Caddy из `deploy/Caddyfile` (перезаписывает `X-Real-IP`) — `TRUSTED_IP_HEADER=x-real-ip`.
- Без доверенного IP лимиты по IP пропускаются (а не сводятся в один общий ключ, которым один клиент заблокировал бы всех);
  лимиты по email (10 попыток на email + IP или email за 15 минут, 100 на email), по пользователю и общие на весь
  сервис действуют всегда: `register-global` (50 регистраций в час), `contact-global` (100 заявок в сутки),
  `assistant-anon-global` (500 вопросов без входа в сутки).
  Счётчики лежат в таблице `rate_limits` (`drizzle/0003`), ключи — хэши email/IP.
- Ассистент для вошедших: `ASSISTANT_USER_DAILY_LIMIT` вопросов в день (200), дальше `429` с `Retry-After`.

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
