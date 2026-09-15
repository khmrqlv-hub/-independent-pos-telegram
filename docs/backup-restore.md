# Backup and restore

Ежедневно запускайте `ops/scripts/backup.sh` отдельным системным пользователем. Скрипт создаёт атомарный custom-format dump, SHA-256, хранит 14 ежедневных и 12 недель еженедельных копий.

Пример cron (время сервера должно быть документировано):

```cron
15 2 * * * DATABASE_URL='…' BACKUP_DIR='/var/backups/independent-pos' /opt/pos/ops/scripts/backup.sh
```

После каждого backup запустите `ops/scripts/verify-restore.sh` на изолированной базе, имя которой заканчивается `_test`. Скрипт сравнивает identity основной и тестовой БД, полностью очищает только test schema, восстанавливает dump и проверяет критические таблицы. Restore в production выполняется только вручную по incident runbook после остановки записи и создания дополнительной копии.
