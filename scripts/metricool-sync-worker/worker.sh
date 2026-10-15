#!/bin/sh
# Entrypoint for the candidate "metricool-sync-worker" Railway service (see
# the Dockerfile in this directory) — a long-lived loop, not a single
# cron-invoked shot like scripts/metricool-sync-trigger/trigger.sh. It calls
# the exact same CRM route (src/app/api/cron/metricool-sync/route.ts) that
# the existing 5-minute cron already hits — this script only changes HOW
# OFTEN that route is called, not what it does. All sync logic, the
# Postgres advisory lock, retry/backoff, and brand caching already live
# server-side in that route from Stage 1; this script stays a thin,
# disposable trigger exactly like the one it's meant to eventually replace.
#
# CRON_SECRET and CRM_BASE_URL must be set as Railway environment variables
# on THIS service (Settings > Variables), never hardcoded here and never
# committed anywhere. curl's default (non -v/--verbose) output never prints
# the request headers it sends, so the Authorization header this script
# builds is never written to this service's logs either.
#
# SYNC_INTERVAL_SECONDS controls the poll cadence (default 75s, the middle
# of Stage 2's approved 60-90s starting range) — stepping down to 30s later
# is just changing this one Railway variable, no redeploy of this script.
set -eu

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is not set on this service." >&2
  exit 1
fi
if [ -z "${CRM_BASE_URL:-}" ]; then
  echo "CRM_BASE_URL is not set on this service." >&2
  exit 1
fi

INTERVAL_SECONDS="${SYNC_INTERVAL_SECONDS:-75}"
SYNC_URL="${CRM_BASE_URL%/}/api/cron/metricool-sync"
RESPONSE_FILE="/tmp/sync_response.json"

echo "[worker] starting — interval=${INTERVAL_SECONDS}s target=${SYNC_URL}"

# A sequential loop is itself single-flight: the next tick is never fired
# until curl for the current one has returned (success, error, or the
# --max-time 60 cap), so this script can never overlap itself. The
# server-side Postgres advisory lock (social.ts's withMetricoolSyncLock)
# remains the backstop against this worker and the still-running 5-minute
# cron overlapping each other during the parallel-testing/cutover window.
while true; do
  tick_started=$(date -u +%s)
  tick_stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  http_code=$(curl -sS --max-time 60 -o "$RESPONSE_FILE" -w "%{http_code}" \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    "$SYNC_URL" 2>/tmp/sync_curl_err.log) || http_code="curl_error"

  body=$(cat "$RESPONSE_FILE" 2>/dev/null || echo "")
  case "$http_code" in
    200) echo "[worker] $tick_stamp ok status=$http_code body=$body" ;;
    409) echo "[worker] $tick_stamp skipped(lock-held) status=$http_code body=$body" ;;
    curl_error) echo "[worker] $tick_stamp curl_error: $(cat /tmp/sync_curl_err.log 2>/dev/null)" >&2 ;;
    *) echo "[worker] $tick_stamp unexpected status=$http_code body=$body" >&2 ;;
  esac

  tick_elapsed=$(( $(date -u +%s) - tick_started ))
  sleep_for=$(( INTERVAL_SECONDS - tick_elapsed ))
  if [ "$sleep_for" -lt 1 ]; then
    sleep_for=1
  fi
  sleep "$sleep_for"
done
