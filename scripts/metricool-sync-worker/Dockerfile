# Candidate Stage 2 replacement for "metricool-sync-trigger" — NOT yet wired
# up as a Railway service. Deliberately its own directory, sibling to
# scripts/metricool-sync-trigger (left completely untouched): this is a
# parallel candidate to test and approve before any cutover, not an edit to
# the service that's currently running the production 5-minute cron.
#
# Same minimal base as the existing trigger (just curl + a shell — no new
# dependency), but run as a long-lived loop instead of a single cron-invoked
# shot, since sub-minute cadence has no clean cron representation (standard
# cron syntax bottoms out at 1-minute granularity).
FROM curlimages/curl:8.11.0
COPY worker.sh /worker.sh
ENTRYPOINT ["/bin/sh", "/worker.sh"]
