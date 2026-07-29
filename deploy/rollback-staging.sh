#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-${SCRIPT_DIR}/.env.staging}"
RELEASE_FILE="${2:?Pass the previous non-secret release manifest}"
COMPOSE_FILE="${SCRIPT_DIR}/compose.staging.yml"
STATE_DIR="${SCRIPT_DIR}/releases"

value_from_file() {
  local key="$1" file="$2"
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

for file in "$ENV_FILE" "$RELEASE_FILE" "$COMPOSE_FILE"; do
  test -f "$file" || { echo "Required file missing: $file" >&2; exit 64; }
done

RELEASE_SHA="$(value_from_file RELEASE_COMMIT_SHA "$RELEASE_FILE")"
DOMAIN="$(value_from_file MANEFLOW_DOMAIN "$ENV_FILE")"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid rollback release SHA." >&2; exit 78; }

COMPOSE=(docker compose --env-file "$ENV_FILE" --env-file "$RELEASE_FILE" -f "$COMPOSE_FILE")
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" pull maneflow vision

# Do not reverse database migrations automatically. This rollback is safe only when the
# prior application release is documented as compatible with the current schema.
"${COMPOSE[@]}" up -d vision maneflow caddy

for attempt in $(seq 1 40); do
  if curl --fail --silent --show-error --max-time 8 "https://${DOMAIN}/api/health" > /dev/null; then
    node "${SCRIPT_DIR}/smoke-staging.mjs" "https://${DOMAIN}" "$RELEASE_SHA"
    mkdir -p "$STATE_DIR"
    printf '%s\n' "$RELEASE_SHA" > "${STATE_DIR}/CURRENT_RELEASE"
    chmod 0600 "${STATE_DIR}/CURRENT_RELEASE"
    printf 'Staging application rollback verified at %s. Database schema was not reversed.\n' "$RELEASE_SHA"
    exit 0
  fi
  sleep 3
done

echo "Rollback health verification failed. Leave services isolated and inspect logs before further action." >&2
exit 70
