#!/bin/sh
# Entrypoint for the separate Railway "whapi-pending-trigger" service (see
# the Dockerfile in this directory) — NOT part of the main CRM web service.
# Railway's Cron Schedule runs this service's start command on a timer and
# expects it to exit when done (it does not just "hit a URL" itself), so
# this tiny script is the thing that actually calls the CRM's
# /api/cron/whapi-process-pending route
# (src/app/api/cron/whapi-process-pending/route.ts), which sweeps up any
# whapi_inbound_events left PENDING by a crash — a safety net only, since
# the webhook route's own after() callback already processes events on the
# normal path. Mirrors scripts/metricool-sync-trigger/trigger.sh exactly.
#
# CRON_SECRET and CRM_BASE_URL must be set as Railway environment variables
# on THIS service (Settings > Variables), never hardcoded here and never
# committed anywhere. curl's default (non -v/--verbose) output never prints
# the request headers it sends, so the Authorization header this script
# builds is never written to this service's logs either.
set -eu

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is not set on this service." >&2
  exit 1
fi
if [ -z "${CRM_BASE_URL:-}" ]; then
  echo "CRM_BASE_URL is not set on this service." >&2
  exit 1
fi

curl -sS -f --max-time 60 \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "${CRM_BASE_URL%/}/api/cron/whapi-process-pending"
