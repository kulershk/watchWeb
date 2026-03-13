#!/usr/bin/env bash
#
# Sync production database to local dev.
#
# Usage:
#   ./scripts/sync-prod-db.sh [user@host]
#
# Defaults to root@watch.osrs.lv if no argument given.
# Requires: ssh access to prod, docker running locally with watch-dev-db container.

set -euo pipefail

REMOTE="${1:-root@watch.osrs.lv}"
DUMP_FILE="/tmp/watch_prod_dump.sql"
LOCAL_DUMP="/tmp/watch_prod_dump.sql"
DEV_CONTAINER="watch-dev-db"
DB_NAME="watch"
DB_USER="watch"

echo "==> Dumping prod database from $REMOTE..."
ssh "$REMOTE" "docker exec watch-db pg_dump -U $DB_USER -d $DB_NAME --clean --if-exists" > "$LOCAL_DUMP"

echo "==> Dump downloaded ($(wc -c < "$LOCAL_DUMP") bytes)"

# Check dev container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${DEV_CONTAINER}$"; then
  echo "ERROR: $DEV_CONTAINER is not running. Start it with:"
  echo "  cd docker/dev && docker compose up -d"
  exit 1
fi

echo "==> Importing into $DEV_CONTAINER..."
docker exec -i "$DEV_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$LOCAL_DUMP"

echo "==> Cleaning up..."
rm -f "$LOCAL_DUMP"

echo "==> Done! Dev database synced from prod."
