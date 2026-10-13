#!/bin/sh
# Entrypoint for the separate Railway "metricool-sync-trigger" service (see
# the Dockerfile in this directory) — NOT part of the main CRM web service.
# Railway's Cron Schedule runs this service's start command on a timer and
# expects it to exit when done (it does not just "hit a URL" itself), so
# this tiny script is the thing that actually calls the CRM's
# /api/cron/metricool-sync route (src/app/api/cron/metricool-sync/route.ts),
# which does the real work of polling Metricool per connected company.
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
  "${CRM_BASE_URL%/}/api/cron/metricool-sync"
