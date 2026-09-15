# PROJECT STATUS

**NOT READY FOR REAL STORE USE** — production не опубликован.

Дата checkpoint: 2026-09-15.

| Область | Статус | Основание |
|---|---|---|
| Frontend | PASS | Next.js production build |
| Backend | PASS | Fastify bundle + typecheck |
| Database design | PASS | 5 versioned PostgreSQL migrations, constraints and indexes |
| Database runtime | PASS | PostgreSQL 16.4 GitHub Actions run 34953452516 |
| Auth | PASS | Telegram signature/tamper/age, повторный login и password sessions |
| Sale totals | PASS | bigint unit tests |
| Atomic sale | PASS | sale/items/payment/stock movement в одной DB transaction |
| Idempotency | PASS | 100 одинаковых запросов создали одну продажу и одно списание |
| Concurrent sale | PASS | 20 запросов при остатке 1: один success, 19 insufficient, остаток 0 |
| Stock | PASS | атомарное списание, movement и запрет отрицательного остатка |
| Price/cost snapshots | PASS | старые sale_price_at_sale и purchase_price_at_sale не изменились |
| Rollback | PASS | корзина с отсутствующим товаром не оставила sale/request/списание |
| Restart/persistence | PASS | новая инстанция API прочитала сохранённую sale/session из PostgreSQL |
| Returns | UNKNOWN | schema/constraints есть, API/UI ещё не реализованы |
| Expenses | UNKNOWN | schema есть, API/UI ещё не реализованы |
| Inventory | UNKNOWN | schema/versioning есть, workflow ещё не реализован |
| Reports/PDF | UNKNOWN | ещё не реализованы |
| Barcode | PARTIAL | cashier UI реализован, E2E не выполнен |
| Print | PARTIAL | browser print реализован, device E2E не выполнен |
| RU/UZ | PARTIAL | cashier UI реализован, полный административный UI отсутствует |
| Roles | PASS | backend разрешил ADMIN и вернул 403 для CASHIER на admin endpoint |
| Audit | PARTIAL | append-only DB и ключевые события есть; все workflows отсутствуют |
| Security | PARTIAL | dependency audit 0 vulnerabilities; full security audit не выполнен |
| Backup | PASS | реальный `pg_dump` custom-format из test DB |
| Restore | PASS | `pg_restore` в отдельную restore test DB и сверка критических таблиц |
| Performance | UNKNOWN | indexes/pagination есть, load test не выполнен |
| Mobile | PARTIAL | responsive CSS/safe areas есть, device matrix не выполнен |

## Проверено

- `npm run typecheck` — PASS.
- 6 unit tests — PASS (5 money/financial, 1 Telegram initData).
- `npm run build` — PASS для API, Web, contracts, database и domain.
- `npm audit --omit=dev --audit-level=high` — 0 vulnerabilities.
- `bash -n` для backup/restore — PASS.
- PostgreSQL core integration — PASS: [GitHub Actions run 34953452516](https://github.com/khmrqlv-hub/-independent-pos-telegram/actions/runs/34953452516).
- Test DB identity отличается от primary и restore DB; разрушительные операции ограничены БД с суффиксами `_test` и `_restore_test`.
- 5 migrations — PASS.
- Реальная sale/stock transaction, price/cost snapshots и rollback — PASS.
- 100-request idempotency test — PASS, одна продажа.
- 20-request concurrency test — PASS, один success, 19 insufficient stock, остаток 0.
- Application restart/persistence — PASS.
- Backup/restore со сверкой critical table counts и migration count — PASS.

## PostgreSQL gate

`apps/api/tests/core.integration.ts` выполнен на настоящем PostgreSQL 16.4 в
изолированном GitHub Actions runner. Workflow использует только временные CI-БД и
CI-only credentials; production secrets и реальные данные не подключаются.

## Следующий обязательный шаг

Реализовать и проверить серверные workflows возвратов, расходов и инвентаризации,
затем отчёты. После этого нужны полноценные browser E2E, Telegram iPhone/Android
device matrix, security/load audit и staging deployment. До их PASS нельзя
подключать production BotFather Mini App URL.
