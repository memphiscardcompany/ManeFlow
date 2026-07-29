#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-${SCRIPT_DIR}/.env.staging}"
RELEASE_FILE="${2:-${SCRIPT_DIR}/.release.staging}"
BACKUP_DIR="${3:-${SCRIPT_DIR}/backups}"
COMPOSE_FILE="${SCRIPT_DIR}/compose.staging.yml"

for file in "$ENV_FILE" "$RELEASE_FILE" "$COMPOSE_FILE"; do
  test -f "$file" || { echo "Required file missing: $file" >&2; exit 64; }
done

mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DATABASE_BACKUP="${BACKUP_DIR}/maneflow-staging-${TIMESTAMP}.dump"
SCAN_BACKUP="${BACKUP_DIR}/maneflow-scan-jobs-${TIMESTAMP}.tar.gz"
CHECKSUM_FILE="${BACKUP_DIR}/SHA256SUMS-${TIMESTAMP}"

COMPOSE=(docker compose --env-file "$ENV_FILE" --env-file "$RELEASE_FILE" -f "$COMPOSE_FILE")
"${COMPOSE[@]}" config --quiet

test -n "$("${COMPOSE[@]}" ps -q postgres)" || {
  echo "PostgreSQL is not running; refusing to create an empty backup." >&2
  exit 69
}

"${COMPOSE[@]}" exec -T postgres sh -Eeuc \
  'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$DATABASE_BACKUP"
test -s "$DATABASE_BACKUP"
chmod 0600 "$DATABASE_BACKUP"

# Run a one-off container with the same private scan volume. No image bytes leave the host.
"${COMPOSE[@]}" run --rm --no-deps --user 0 \
  -v "${BACKUP_DIR}:/backup" \
  maneflow sh -Eeuc \
  "tar -C /var/lib/maneflow -czf /backup/$(basename "$SCAN_BACKUP") scan-jobs"
test -s "$SCAN_BACKUP"
chmod 0600 "$SCAN_BACKUP"

(
  cd "$BACKUP_DIR"
  sha256sum "$(basename "$DATABASE_BACKUP")" "$(basename "$SCAN_BACKUP")" > "$(basename "$CHECKSUM_FILE")"
  sha256sum --check "$(basename "$CHECKSUM_FILE")"
)
chmod 0600 "$CHECKSUM_FILE"

# Retain 14 days by default. Operators may archive encrypted copies before pruning.
find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'maneflow-staging-*.dump' -o -name 'maneflow-scan-jobs-*.tar.gz' -o -name 'SHA256SUMS-*' \) \
  -mtime +14 -delete

printf 'Database backup: %s\nScan-job backup: %s\nChecksums: %s\n' \
  "$DATABASE_BACKUP" "$SCAN_BACKUP" "$CHECKSUM_FILE"
