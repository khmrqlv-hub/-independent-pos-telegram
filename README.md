# Independent POS Telegram

Новая независимая кассовая система для магазина электроники. Проект не использует Floot,
старые API, старые базы или код других проектов. Telegram Mini App является только
защищённым каналом входа для сотрудников; денежное и складское ядро работает независимо.

## Архитектура

- `apps/web` — Next.js/React интерфейс кассира, RU/UZ, responsive и print.
- `apps/api` — Fastify API, session auth, Telegram `initData`, бизнес-транзакции.
- `packages/domain` — детерминированные расчёты денег и скидок на `bigint`.
- `packages/contracts` — Zod-контракты API.
- `packages/database` — PostgreSQL migrations и runner.
- `ops` — локальная PostgreSQL, backup/restore и deployment-конфигурация.

## Правила безопасности

- Деньги хранятся только как `BIGINT` в минимальных единицах UZS.
- Остаток не может стать отрицательным.
- Продажа, позиции, платежи, stock movements и уменьшение остатка — одна транзакция.
- Исторические таблицы append-only.
- Telegram `initData` проверяется только backend; доступ выдаётся только allowlist-пользователям.
- Парольный session login сохраняется как резервный способ доступа на ПК.
- Production и test используют разные базы.

## Локальный запуск

1. Скопировать `.env.example` в `.env` и заменить секреты.
2. `docker compose up -d postgres`
3. `npm install`
4. `npm run db:migrate`
5. Задать bootstrap-переменные из `.env.example` и выполнить `npm run admin:create`.
6. `npm run dev`

Настройка Telegram описана в `docs/telegram-setup.md`, backup/restore — в
`docs/backup-restore.md`.

Production пока не опубликован.

## PostgreSQL core integration

Integration-тест намеренно не использует mock/PGlite. Нужны три отдельные PostgreSQL
базы: основная development-база только для сравнения identity, очищаемая `pos_test`
и очищаемая `pos_restore_test`. Имена двух последних обязаны заканчиваться на
`_test` и `_restore_test`; при совпадении identity тест немедленно прекращается.

```bash
PRIMARY_DATABASE_URL='postgresql://…/pos' \
TEST_DATABASE_URL='postgresql://…/pos_test' \
RESTORE_TEST_DATABASE_URL='postgresql://…/pos_restore_test' \
npm run test:integration
```

Сценарий применяет все пять migrations, выполняет 100 idempotent и 20 concurrent
запросов, проверяет snapshots/rollback/restart, затем делает настоящий `pg_dump`
и `pg_restore`. Использовать только с отдельными одноразовыми test DB.
