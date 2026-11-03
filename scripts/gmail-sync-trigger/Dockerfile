# Isolated image for Railway's planned "gmail-sync-trigger" scheduled
# service (NOT yet wired into .railway/railway.ts — adding it there is a
# deployment-phase step requiring explicit approval, see the Gmail inbound
# sync PASS/FAIL report). Deliberately NOT the main app's Dockerfile/
# Nixpacks build — mirrors scripts/whapi-pending-trigger/Dockerfile exactly.
FROM curlimages/curl:8.11.0
COPY trigger.sh /trigger.sh
ENTRYPOINT ["/bin/sh", "/trigger.sh"]
