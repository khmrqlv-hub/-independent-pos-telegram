# GadgetCashier staging deployment

Status: configuration prepared; container build and live deployment NOT VERIFIED.
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

- Build all Docker targets on a Docker-capable runner (Docker is unavailable in this workspace).
- Verify private connectivity, migrations, least-privilege runtime role and HTTPS cookie flow.
- Verify Telegram account link, signed login and access denial for unapproved accounts.
- Configure separate backup storage and scheduled restore drills; CI backup tests alone are insufficient.
- No staging URL, service or database has been created by adding these files.
