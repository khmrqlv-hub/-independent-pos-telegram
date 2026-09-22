# GadgetCashier staging deployment

Status: Railway staging provisioned on 2026-09-21; deployment acceptance is recorded below.
Do not use this as permission to launch a real store. See project-status.md for release blockers.

## Isolation

Create a NEW hosting project, staging environment and PostgreSQL database exclusively for this repository.
Do not reuse the GadgetShop/Floot services, credentials, catalog, bot or databases.
Do not run integration tests against staging: they recreate the test schema.

## Images and routing

Build from repository root using Dockerfile targets:

- `api`: Fastify on port 4000, accessible only to the web service/private network.
- `web`: Next.js on port 3000, with one public HTTPS domain.
- `migrations`: one-shot migration command with a database owner credential.

For Railway, the final runtime defaults to `api`; set the non-secret build variable
`POS_SERVICE=web` for the frontend. API uses `PORT=4000` and `API_PORT=4000`;
web uses `PORT=3000`. API listens on `::` for private IPv6 and local IPv4.

The web build requires `API_INTERNAL_URL` (e.g. `http://api:4000`, replaced with the
actual private service hostname). Next.js embeds the rewrite destination during build.
There must be no secrets in this build argument. Rebuild web when the API hostname changes.
Forward `/api/*` and `/health` through Next.js; no public database port is needed.

API runtime variables, entered through the hosting provider's secret settings:

- `DATABASE_URL`: the NEW staging PostgreSQL URL, using a restricted runtime role.
- `APP_ORIGIN`: exact public HTTPS origin, no trailing slash.
- `TELEGRAM_BOT_TOKEN`: freshly rotated token for @GadgetCashierbot.
- `NODE_ENV=production`: enables secure cookies even in the staging environment.
- `API_PORT=4000` and `SESSION_COOKIE_NAME=gadgetcashier_staging`.

Never put bot tokens or database passwords in GitHub, Docker build arguments, frontend
NEXT_PUBLIC variables, logs or chat. The previously pasted token must be revoked first.

Run the migrations target once against the NEW database before starting API/web.
Only the migration job should have DDL privileges. Confirm all six migrations are present.
Create the first administrator with the existing `npm run admin:create` command,
using temporary secret variables ADMIN_BOOTSTRAP_LOGIN, ADMIN_BOOTSTRAP_NAME and
ADMIN_BOOTSTRAP_PASSWORD. It refuses to bootstrap a database that already has users.
Remove those temporary variables after bootstrap. No seeded default password is supplied.

## Telegram and acceptance

Sign in as ADMIN and link the owner's verified numeric Telegram ID using the authenticated
`POST /api/admin/telegram/link` endpoint. A username is not a numeric Telegram ID.
Never grant ADMIN to the first arbitrary person opening the bot.

After staging health and authentication checks, set the bot menu Mini App URL to the HTTPS
web origin using BotFather. Only @GadgetCashierbot is in scope. Test with fake stock and money.
Real-device Telegram checks, network-loss recovery, security review and remaining workflows
must pass before any production rollout.

## Verification still required

- Docker images, typecheck, unit, PostgreSQL integration/restore and E2E passed in
  GitHub Actions run 35617356173 for commit 7153258f33a0496747235712b61d8fa16eac9ad1.
- Verify private connectivity, migrations, least-privilege runtime role and HTTPS cookie flow.
- Verify Telegram account link, signed login and access denial for unapproved accounts.
- Configure separate backup storage and scheduled restore drills; CI backup tests alone are insufficient.

## Provisioned environment (no production deployment)

- Railway project: `88ffae3e-c84d-4aca-aece-7e15b978b0d2`.
- Staging environment: `5f624b56-e2ba-44b5-b1a4-d5ffbcd817ea` (display name has a trailing space).
- Postgres: `6ee25dc1-70a0-45dd-a3d9-1323463831df`, PostgreSQL 18, persistent 500 MB volume.
- API: `7826cc93-a4b2-42d7-8939-f2c3b733915f`, private network only.
- Web: `31a84cc6-9de3-4e30-8bbf-f655a2e215e7`.
- Assigned web origin: https://pos-web-staging.up.railway.app.
- API pre-deploy runs `npm run db:migrate`; logs confirm 0001 through 0006 applied.
- No old database, service, Floot API or shop bot used. No real data imported.
- Initial administrator provisioned on 2026-09-22. Live password login, ADMIN role, session and logout verified (HTTP 200); cookie Secure/HttpOnly/SameSite=Strict verified. Telegram token remains unconfigured.
- Current staging DATABASE_URL references Postgres's owner credential. A restricted
  runtime role remains REQUIRED before real use; do not treat this setup as security PASS.
- API deployment `f342a25c-1bf7-4fc1-9d41-f739fcaed6fb`: SUCCESS.
- Web deployment `c32bc8dd-db6f-4e44-82c3-214727cadb6b`: SUCCESS.
- Live HTTPS `/health` verified: `{"app":"ok","database":"ok"}`.
- Both deployed services use code commit `7153258f33a0496747235712b61d8fa16eac9ad1`.
- Bootstrap values cleared after account creation; pre-deploy restored to migrations only. Credentials are not stored in this repository.
- Next: securely configure a freshly rotated bot token and link the verified owner Telegram ID,
  restrict the runtime DB role, then verify real Telegram login. Never reuse the chat token.
