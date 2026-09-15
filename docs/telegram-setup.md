# Telegram Mini App setup

1. Создайте нового приватного бота через `@BotFather` (`/newbot`).
2. Не отправляйте token в чат. Сохраните его только как серверную переменную `TELEGRAM_BOT_TOKEN`.
3. После staging укажите HTTPS URL Mini App через `/newapp` или Bot Settings → Menu Button.
4. Создайте первого ADMIN командой `npm run admin:create --workspace=@pos/database` с переменными `ADMIN_BOOTSTRAP_LOGIN`, `ADMIN_BOOTSTRAP_NAME`, `ADMIN_BOOTSTRAP_PASSWORD`.
5. ADMIN связывает Telegram ID сотрудника через защищённый endpoint `/api/admin/telegram/link`.
6. Сотрудник открывает Mini App только из нового бота. Backend проверяет подпись, возраст `initData`, одноразовый hash и allowlist.

До HTTPS staging Telegram-вход нельзя считать проверенным. Парольный session login остаётся резервным.
