# PROJECT STATUS

**NOT READY FOR REAL STORE USE** — production не опубликован.

Дата checkpoint: 2026-09-15.

| Область | Статус | Основание |
|---|---|---|
| Frontend | PASS | Next.js production build |
| Backend | PASS | Fastify bundle + typecheck |
| Database design | PASS | 5 versioned PostgreSQL migrations, constraints and indexes |
| Database runtime | UNKNOWN | PostgreSQL недоступен в текущем runner |
| Auth | PARTIAL | signature/tamper/age unit PASS; runtime DB flow подготовлен, но не пройден |
| Sale totals | PASS | bigint unit tests |
| Atomic sale | UNKNOWN | код реализован, integration DB test не выполнен |
| Idempotency | UNKNOWN | код реализован, 100-request DB test не выполнен |
| Concurrent sale | UNKNOWN | locking/atomic guard реализованы, 20-request DB test не выполнен |
| Stock | UNKNOWN | constraints/movements реализованы, runtime DB test не выполнен |
| Returns | UNKNOWN | schema/constraints есть, API/UI ещё не реализованы |
| Expenses | UNKNOWN | schema есть, API/UI ещё не реализованы |
| Inventory | UNKNOWN | schema/versioning есть, workflow ещё не реализован |
| Reports/PDF | UNKNOWN | ещё не реализованы |
| Barcode | PARTIAL | cashier UI реализован, E2E не выполнен |
| Print | PARTIAL | browser print реализован, device E2E не выполнен |
| RU/UZ | PARTIAL | cashier UI реализован, полный административный UI отсутствует |
| Roles | PARTIAL | backend ADMIN guard есть, полный permissions test не выполнен |
| Audit | PARTIAL | append-only DB и ключевые события есть; все workflows отсутствуют |
| Security | PARTIAL | dependency audit 0 vulnerabilities; full security audit не выполнен |
| Backup | PARTIAL | rotation script готов, реальный dump не выполнялся |
| Restore | PARTIAL | guarded restore-test готов, PostgreSQL runtime отсутствует |
| Performance | UNKNOWN | indexes/pagination есть, load test не выполнен |
| Mobile | PARTIAL | responsive CSS/safe areas есть, device matrix не выполнен |

## Проверено

- `npm run typecheck` — PASS.
- 6 unit tests — PASS (5 money/financial, 1 Telegram initData).
- `npm run build` — PASS для API, Web, contracts, database и domain.
- `npm audit --omit=dev --audit-level=high` — 0 vulnerabilities.
- `bash -n` для backup/restore — PASS.

## Подготовлено, но не выполнено

`apps/api/tests/core.integration.ts` выполняет на настоящем PostgreSQL полный
checkpoint-gate: сравнение трёх database identity, 5 migrations, ADMIN/CASHIER,
Telegram login и повторную авторизацию, sale/stock/snapshots, 100 одинаковых
idempotency-запросов, 20 concurrent sales, rollback, restart, `pg_dump` и
`pg_restore`. В текущем runner PostgreSQL невозможно запустить: процесс имеет UID
root и не имеет capability сменить UID; `initdb` обоснованно отказывается. Защита
не обходилась, PGlite/mock не использовались и PASS не присваивался.

Для запуска без локального Docker добавлен изолированный GitHub Actions workflow
`.github/workflows/postgresql-core.yml`: PostgreSQL 16.4 service, две отдельные
test DB, закрытые CI-only credentials и отсутствие любых production secrets.

## Следующий обязательный шаг

Поднять отдельные `pos` и `pos_test` PostgreSQL 16, доказать различие database identity, применить migrations только в test DB и выполнить integration-набор: migration, atomic sale, 20 concurrent sales при остатке 1, 100 одинаковых idempotency-запросов, partial return, reports, backup и restore. До этого нельзя выдавать staging URL кассиру или подключать BotFather Mini App URL.
