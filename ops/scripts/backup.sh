#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required and must be an explicit dedicated directory}"

case "$BACKUP_DIR" in
  ""|"/"|"$HOME"|"$PWD") echo "Unsafe BACKUP_DIR" >&2; exit 1 ;;
esac

mkdir -p -- "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
daily="$BACKUP_DIR/daily/pos-$timestamp.dump"
temp="$daily.partial"

cleanup() { rm -f -- "$temp"; }
trap cleanup EXIT
pg_dump --dbname="$DATABASE_URL" --format=custom --compress=9 --no-owner --no-acl --file="$temp"
pg_restore --list "$temp" >/dev/null
mv -- "$temp" "$daily"
sha256sum "$daily" > "$daily.sha256"

if [[ "$(date -u +%u)" == "7" ]]; then
  cp --preserve=timestamps -- "$daily" "$BACKUP_DIR/weekly/$(basename "$daily")"
  cp --preserve=timestamps -- "$daily.sha256" "$BACKUP_DIR/weekly/$(basename "$daily.sha256")"
fi

find "$BACKUP_DIR/daily" -type f -name 'pos-*.dump' -mtime +14 -delete
find "$BACKUP_DIR/daily" -type f -name 'pos-*.dump.sha256' -mtime +14 -delete
find "$BACKUP_DIR/weekly" -type f -name 'pos-*.dump' -mtime +84 -delete
find "$BACKUP_DIR/weekly" -type f -name 'pos-*.dump.sha256' -mtime +84 -delete
printf '%s\n' "$daily"
