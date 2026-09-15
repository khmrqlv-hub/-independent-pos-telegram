#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"

[[ -f "$BACKUP_FILE" ]] || { echo "Backup file not found" >&2; exit 1; }
prod_identity="$(psql "$DATABASE_URL" -Atqc "select coalesce(inet_server_addr()::text,'local')||':'||inet_server_port()||'/'||current_database()")"
test_identity="$(psql "$TEST_DATABASE_URL" -Atqc "select coalesce(inet_server_addr()::text,'local')||':'||inet_server_port()||'/'||current_database()")"
test_name="$(psql "$TEST_DATABASE_URL" -Atqc 'select current_database()')"

[[ "$prod_identity" != "$test_identity" ]] || { echo "Refusing restore: production and test DB identities match" >&2; exit 1; }
[[ "$test_name" == *_test ]] || { echo "Refusing restore: test database name must end with _test" >&2; exit 1; }

pg_restore --list "$BACKUP_FILE" >/dev/null
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
pg_restore --dbname="$TEST_DATABASE_URL" --no-owner --no-acl --exit-on-error "$BACKUP_FILE"

psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users','products','categories','stock_movements','sales','sale_items',
    'returns','return_items','expenses','inventory_sessions','audit_log'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      RAISE EXCEPTION 'restore verification failed: missing table %', table_name;
    END IF;
  END LOOP;
END $$;
SELECT count(*) AS migration_count FROM schema_migrations;
SELECT count(*) AS users FROM users;
SELECT count(*) AS products FROM products;
SELECT count(*) AS sales FROM sales;
SELECT count(*) AS sale_items FROM sale_items;
SQL

echo "Restore verification PASS on $test_identity"
