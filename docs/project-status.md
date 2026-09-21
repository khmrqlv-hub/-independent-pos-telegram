# Independent Telegram POS — verification checkpoint

SYSTEM STATUS — NOT READY FOR REAL STORE USE
PRODUCTION — NOT PUBLISHED

Updated 2026-09-21. Independent Next.js frontend, Fastify backend and PostgreSQL.
No Floot or connections to the previous shop.

## Verified scope

- Typecheck, build and 6 unit tests pass.
- PostgreSQL integration gate passes on isolated PostgreSQL 16 CI databases: 6 migrations, server-side roles,
  transactions, stock, price/cost snapshots, rollback, 100-request sale idempotency,
  20-way last-item concurrency, partial returns, expenses, inventory conflicts,
  financial report control delta of 2,500,000 UZS, day/month/year PDF responses,
  API-instance restart and pg_dump/pg_restore into a separate restore database.
- Browser gate passed on commit 3a7cd720d08a7b59c82736596095800e0a8cee99:
  https://github.com/khmrqlv-hub/-independent-pos-telegram/actions/runs/35562584983
  Two browser scenarios across desktop Chromium, emulated iPhone WebKit and Android Chromium.
- Receipt now reads immutable item snapshots through an authenticated endpoint; purchase costs are excluded.
- Telegram SDK is loaded before interaction. Additional browser tests exercise backend validation of signed
  test initData and rejection of forged data; these use a simulated Telegram bridge, not physical devices.

## Remaining release blockers

- Complete user-facing return, expense and inventory workflows; product/category editing and archiving,
  user updates, settings, report drilldown, low-stock views and pagination.
- Persist the exact pending sale payload across network failures, recover its status after reopening,
  and prevent editing an unresolved operation. Add network-loss browser coverage.
- Add server idempotency and UI submission locking to restocking and other critical admin creates.
- Complete receipt focus/keyboard/print-layout review. A mocked window.print call is not a physical print test.
- Finish RU/UZ coverage including server errors and report/PDF language selection.
- Check real Telegram iPhone/Android: light/dark themes, safe areas, keyboard, close/reopen and session renewal.
- Full security review, load tests at the requested volume, and database-process restart testing.
- Operational backup scheduling, retention, off-host storage and restore drills; CI restore success does not
  establish a production backup service.
- Separate HTTPS staging hosting, fresh database, independent bot configuration and secure credentials.
  No staging URL has been created. Never reuse the previous shop's credentials or data.

## Evidence limits

A passing build is not full frontend acceptance. Integration assertions are contained in one broad test;
this is not dozens of independently reported test cases. Financial PDF runtime checks verify format and
summary header consistency; full visual PDF review and the requested sale table are still required.
Do not mark overall SECURITY, PERFORMANCE, MOBILE or TELEGRAM MINI APP as PASS yet.
