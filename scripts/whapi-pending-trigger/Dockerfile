# Isolated image for Railway's "whapi-pending-trigger" scheduled service.
# Deliberately NOT the main app's Dockerfile/Nixpacks build — this is a
# separate Railway service (Root Directory = scripts/whapi-pending-trigger)
# so it builds and runs independently of the CRM web service. Just curl + a
# shell, nothing else — builds in seconds. Mirrors
# scripts/metricool-sync-trigger/Dockerfile exactly.
FROM curlimages/curl:8.11.0
COPY trigger.sh /trigger.sh
ENTRYPOINT ["/bin/sh", "/trigger.sh"]
