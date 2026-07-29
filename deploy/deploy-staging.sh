#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-${SCRIPT_DIR}/.env.staging}"
RELEASE_FILE="${2:-${SCRIPT_DIR}/.release.staging}"
COMPOSE_FILE="${SCRIPT_DIR}/compose.staging.yml"
STATE_DIR="${SCRIPT_DIR}/releases"
BACKUP_DIR="${SCRIPT_DIR}/backups"

value_from_file() {
  local key="$1" file="$2"
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

for file in "$ENV_FILE" "$RELEASE_FILE" "$COMPOSE_FILE" "${SCRIPT_DIR}/Caddyfile"; do
  test -f "$file" || { echo "Required file missing: $file" >&2; exit 64; }
done

if command -v stat >/dev/null 2>&1; then
  mode="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || true)"
  test "$mode" = "600" || { echo "$ENV_FILE must have mode 0600; found ${mode:-unknown}." >&2; exit 77; }
fi

if grep -Eq 'REPLACE|example\.invalid|URL_ENCODED' "$ENV_FILE" "$RELEASE_FILE"; then
  echo "Staging configuration still contains placeholders." >&2
  exit 78
fi

RELEASE_SHA="$(value_from_file RELEASE_COMMIT_SHA "$RELEASE_FILE")"
DOMAIN="$(value_from_file MANEFLOW_DOMAIN "$ENV_FILE")"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "RELEASE_COMMIT_SHA must be a full 40-character lowercase SHA." >&2; exit 78; }
[[ "$DOMAIN" =~ ^[a-z0-9.-]+$ ]] || { echo "MANEFLOW_DOMAIN is invalid." >&2; exit 78; }

for image_key in MANEFLOW_IMAGE_REF MANEFLOW_VISION_IMAGE_REF POSTGRES_IMAGE_REF REDIS_IMAGE_REF CADDY_IMAGE_REF; do
  image_ref="$(value_from_file "$image_key" "$RELEASE_FILE")"
  [[ "$image_ref" == *@sha256:* ]] || { echo "$image_key must be digest pinned." >&2; exit 78; }
done

mkdir -p "$STATE_DIR" "$BACKUP_DIR"
chmod 0700 "$STATE_DIR" "$BACKUP_DIR"
COMPOSE=(docker compose --env-file "$ENV_FILE" --env-file "$RELEASE_FILE" -f "$COMPOSE_FILE")
"${COMPOSE[@]}" config --quiet

# Preserve the previous non-secret release manifest for application rollback.
if test -f "${STATE_DIR}/CURRENT_RELEASE"; then
  PREVIOUS_SHA="$(cat "${STATE_DIR}/CURRENT_RELEASE")"
  test -f "${STATE_DIR}/${PREVIOUS_SHA}.env" || { echo "Previous release manifest is missing." >&2; exit 66; }
  cp "${STATE_DIR}/${PREVIOUS_SHA}.env" "${STATE_DIR}/PREVIOUS_RELEASE.env"
  chmod 0600 "${STATE_DIR}/PREVIOUS_RELEASE.env"
fi
cp "$RELEASE_FILE" "${STATE_DIR}/${RELEASE_SHA}.env"
chmod 0600 "${STATE_DIR}/${RELEASE_SHA}.env"

"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d postgres redis

# Back up an existing staging state before migrations. First deployment has nothing to back up.
if test -n "$("${COMPOSE[@]}" ps -q postgres)" && test -f "${STATE_DIR}/CURRENT_RELEASE"; then
  "${SCRIPT_DIR}/backup-staging.sh" "$ENV_FILE" "$RELEASE_FILE" "$BACKUP_DIR"
fi

"${COMPOSE[@]}" run --rm migrate
"${COMPOSE[@]}" up -d vision maneflow caddy

HEALTH_URL="https://${DOMAIN}/api/health"
FOLDER_URL="https://${DOMAIN}/bulk-upload.html"
health_ok=false
for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 8 "$HEALTH_URL" > "${STATE_DIR}/health-${RELEASE_SHA}.json"; then
    health_ok=true
    break
  fi
  sleep 3
done

if [[ "$health_ok" != true ]]; then
  echo "Staging health check failed. Production is unchanged because this is staging." >&2
  echo "Inspect: ${COMPOSE[*]} logs --tail=300 maneflow vision caddy" >&2
  if test -f "${STATE_DIR}/PREVIOUS_RELEASE.env"; then
    echo "Application rollback: ${SCRIPT_DIR}/rollback-staging.sh '$ENV_FILE' '${STATE_DIR}/PREVIOUS_RELEASE.env'" >&2
  fi
  exit 70
fi

curl --fail --silent --show-error --max-time 8 "$FOLDER_URL" > /dev/null
node "${SCRIPT_DIR}/smoke-staging.mjs" "https://${DOMAIN}" "$RELEASE_SHA"

printf '%s\n' "$RELEASE_SHA" > "${STATE_DIR}/CURRENT_RELEASE"
chmod 0600 "${STATE_DIR}/CURRENT_RELEASE"

printf 'Staging deployment verified.\nDomain: https://%s\nCommit: %s\n' "$DOMAIN" "$RELEASE_SHA"
