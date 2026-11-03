#!/bin/sh
# Entrypoint for the planned Railway "gmail-sync-trigger" service (see the
# Dockerfile in this directory) — NOT part of the main CRM web service, and
# NOT yet wired into .railway/railway.ts (adding it there, and creating the
# actual Railway service with a cronSchedule, is a deployment-phase step
# requiring explicit approval — see the Gmail inbound sync PASS/FAIL
# report). Mirrors scripts/whapi-pending-trigger/trigger.sh exactly: calls
# the CRM's /api/cron/gmail-sync route (src/app/api/cron/gmail-sync/route.ts),
# which proactively syncs every connected mailbox and renews any watch
# nearing expiry.
#
# CRON_SECRET and CRM_BASE_URL must be set as Railway environment variables
# on THIS service (Settings > Variables) once created — never hardcoded
# here and never committed anywhere. curl's default (non -v/--verbose)
# output never prints the request headers it sends, so the Authorization
# header this script builds is never written to this service's logs either.
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
  "${CRM_BASE_URL%/}/api/cron/gmail-sync"
