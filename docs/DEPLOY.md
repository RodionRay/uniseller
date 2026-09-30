# Развёртывание на VPS

Схема: один Linux-сервер (x86_64, Ubuntu 22.04/24.04 или Debian 12), `docker compose` поднимает два
контейнера — `web` (кабинет, порт 5173 только на `127.0.0.1` хоста) и `worker` (Telegram-воркер, порт 8790
только внутри сети compose). Снаружи — Caddy на хосте с автоматическим HTTPS. База — локальная D1
(sqlite-файл wrangler) на docker-томе `uniseller-data` (`/data/wrangler`), бэкапы — там же в `/data/backups`.

Файлы: `Dockerfile` (цели `web` и `worker`), `docker-compose.yml`, `deploy/Caddyfile`,
`deploy/backup.sh`, `deploy/cron.example`, `scripts/d1-*.mjs`.

## 1. Сервер
```sh
# Docker Engine + compose plugin: https://docs.docker.com/engine/install/
sudo apt install -y caddy git            # Caddy: https://caddyserver.com/docs/install
sudo usermod -aG docker "$USER"          # перелогиниться
sudo ufw allow 22,80,443/tcp && sudo ufw enable
```
DNS: A-запись домена (например `leads.example.com`) → IP сервера.

## 2. Код и секреты
```sh
sudo mkdir -p /opt/uniseller && sudo chown "$USER" /opt/uniseller
git clone <repo-url> /opt/uniseller && cd /opt/uniseller
cp .env.example .env && chmod 600 .env
openssl rand -hex 32        # → ENCRYPTION_KEY (ровно 64 hex-символа)
openssl rand -base64 48     # → SESSION_SECRET
openssl rand -hex 32        # → TG_WORKER_TOKEN
openssl rand -hex 32        # → CRON_SECRET
```
В `.env` обязательно: `ENCRYPTION_KEY`, `SESSION_SECRET`, `TG_WORKER_TOKEN`, `CRON_SECRET`,
`APP_URL=https://leads.example.com`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`
(хэш: `docker compose run --rm --no-deps web node scripts/hash-password.mjs 'пароль'` после сборки или
`npm run auth:hash -- 'пароль'` на своей машине). `REGISTRATION_OPEN=false` — регистрация закрыта.

**`ENCRYPTION_KEY` сохранить отдельно от сервера** (менеджер паролей). Бэкап базы без ключа бесполезен:
пароли прокси, ключи и сессии в ней зашифрованы.

`TELEGRAM_WORKER_URL`, `HOST`, `D1_PERSIST_DIR` задаются в `docker-compose.yml` и перекрывают `.env`.

`web` читает весь `.env`. **Воркер `.env` целиком не получает** (он разбирает чужие `tdata`): compose
передаёт ему только `TG_WORKER_TOKEN`, `CRON_SECRET` (без них `docker compose` откажется стартовать),
`APP_URL=http://web:5173` (cron ходит по сети compose, не через публичный домен) и необязательные
`TG_WORKER_CONCURRENCY` (4), `AUTO_RESCAN_EVERY_MS` (300000), `TG_WORKER_KILL_GRACE_MS`,
`TG_WORKER_MAX_OUTPUT_BYTES`, `TG_WORKER_TIMEOUT_MS`. Новую переменную для воркера нужно добавить в
`environment:` сервиса `worker`. Python-процесс получает ещё меньше: только окружение интерпретатора
(`PATH`, `HOME`, `LANG`/`LC_*`, `TMPDIR`, `PYTHON*`, `SSL_CERT_*`) и каталог сессии; дополнительные имена —
через `TG_WORKER_PYTHON_ENV=ИМЯ1,ИМЯ2` (`telegram-worker/src/python-runner.mjs::childEnv`).
`TG_WORKER_ALLOW_NO_TOKEN=1` в продакшене не ставить: без `TG_WORKER_TOKEN` воркер не запустится.

Лимиты воркера (`telegram-worker/src/python-runner.mjs`): не больше `TG_WORKER_CONCURRENCY` Python-процессов,
запросы одного аккаунта идут по очереди; stdout — 1 МиБ для проверки прокси, для действий с аккаунтом —
не меньше 8 МиБ (ответ может содержать перепакованный архив сессии), для сбора аудитории — 32 МиБ.
Если приложение оборвало запрос, воркер убивает уже запущенный процесс только для чтения (проверка,
скан, сбор аудитории, входящие); отправка, инвайт и вступление доживают до своего таймаута.

## 3. Запуск
```sh
docker compose up -d --build
docker compose ps                     # оба сервиса healthy через ~1–2 минуты
curl -s http://127.0.0.1:5173/api/health
```
Контейнер `web` при каждом старте применяет миграции (`node scripts/d1-migrate.mjs` →
`wrangler d1 migrations apply DB --local --persist-to /data/wrangler`), затем запускает сервер.
Ответ `/api/health`: `{"ok":true,"db":"up","config":{"ok":true,"missing":[],"invalid":[]},"worker":"up"}`.
`503` → смотреть `config.missing` / `config.invalid` (имена переменных) и `worker`.

Воркер собирается только под `linux/amd64` (колёса TgCrypto и PyQt5-Qt5, Python 3.11). На ARM-сервере
нужна эмуляция (`qemu-user-static`) — не рекомендуется.

## 4. HTTPS (Caddy)
```sh
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/leads.example.com/ВАШ-ДОМЕН/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```
Сертификат выпускается автоматически. `Caddyfile` отвечает `404` на `/api/cron/*` снаружи: cron вызывает
только воркер внутри сети compose; `/api/health` остаётся доступным. Для OAuth в консолях Google/Яндекс/VK указать redirect URI
`https://ВАШ-ДОМЕН/api/auth/<google|yandex|vk>/callback` — приложение строит его из `APP_URL`.

## 5. Бэкап и восстановление
Ручной бэкап: `./deploy/backup.sh` — онлайн-копия sqlite-файла D1 (SQLite backup API, `integrity_check`)
в `/data/backups/uniseller-d1-<дата>.sqlite`, хранится `BACKUP_KEEP` (14) последних.
С `OFFSITE_DIR=/mnt/backup ./deploy/backup.sh` копии дублируются на хост (подключённый диск / rclone mount).

Ежедневно: `crontab -e` и строка из `deploy/cron.example` (03:15). Хотя бы одну копию держать вне сервера:
`docker compose cp web:/data/backups/. ./backups/` и забрать через `scp`.

Восстановление (файл бэкапа лежит в текущем каталоге хоста):
```sh
cd /opt/uniseller
docker compose stop web
docker compose run --rm --no-deps --user root \
  -v "$PWD/uniseller-d1-YYYYMMDD-HHMMSS.sqlite:/restore.sqlite:ro" --entrypoint sh web -c '
  set -e; d=/data/wrangler/v3/d1/miniflare-D1DatabaseObject
  f=$(ls "$d"/*.sqlite | grep -v metadata.sqlite)
  mv "$f" "$f.before-restore"; rm -f "$f-wal" "$f-shm"
  cp /restore.sqlite "$f"; chown node:node "$f"'
docker compose start web && curl -s http://127.0.0.1:5173/api/health
```
Если том пустой (новый сервер): сначала `docker compose up -d web` (создаст базу и применит миграции),
затем шаги выше. `ENCRYPTION_KEY` в `.env` должен совпадать с ключом исходного сервера.

## 6. Обновление
```sh
cd /opt/uniseller
./deploy/backup.sh
git pull
docker compose up -d --build          # миграции применятся при старте web
docker compose ps && curl -s http://127.0.0.1:5173/api/health
docker image prune -f
```
Откат: `git checkout <предыдущий-коммит> && docker compose up -d --build`; если новая миграция успела
изменить схему — восстановить бэкап (раздел 5).

## 7. Логи и диагностика
```sh
docker compose logs -f web            # или worker; ротация json-file 5×10 MB на сервис
docker compose logs --since 1h worker
docker compose exec web node scripts/d1-migrate.mjs      # повторно применить миграции
journalctl -u caddy -f
```
Служебные скрипты работают с тем же sqlite-файлом D1 (`scripts/wrangler-local.mjs::locateD1File`,
учитывают `D1_PERSIST_DIR`): `npm run heal:joinstate` — разовая починка битых `joinStateError` в группах,
`npm run seed:tgstat-catalog` — залить проверенный каталог групп владельцу `SEED_OWNER` (только локально,
после `npm run db:migrate`). В контейнере: `docker compose exec web npm run heal:joinstate`.

Перенос существующей локальной базы на сервер: `npm run build && node scripts/d1-backup.mjs` локально
(после `npm run db:baseline && npm run db:migrate`, см. README), затем восстановление (раздел 5) с этим файлом.
