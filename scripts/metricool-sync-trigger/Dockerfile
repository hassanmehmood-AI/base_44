# Isolated image for Railway's "metricool-sync-trigger" scheduled service.
# Deliberately NOT the main app's Dockerfile/Nixpacks build — this is a
# separate Railway service (Root Directory = scripts/metricool-sync-trigger)
# so it builds and runs independently of the CRM web service, satisfying
# "keep the existing CRM deployment unchanged." Just curl + a shell, nothing
# else — builds in seconds.
FROM curlimages/curl:8.11.0
COPY trigger.sh /trigger.sh
ENTRYPOINT ["/bin/sh", "/trigger.sh"]
