import { bucket, defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "iad" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "iad", sizeMB: 50000 });
  const customerAvatars = bucket("customer-avatars", { region: "sjc" });
  const base_44 = service("base_44", {
    source: github("hassanmehmood-AI/base_44", { checkSuites: false }),
    replicas: { "iad": 1 },
    networking: { privateNetworkEndpoint: "base44" },
    env: { AUTH_SECRET: preserve(), AVATAR_STORAGE_ACCESS_KEY_ID: preserve(), AVATAR_STORAGE_BUCKET: preserve(), AVATAR_STORAGE_ENABLED: preserve(), AVATAR_STORAGE_ENDPOINT: preserve(), AVATAR_STORAGE_SECRET_ACCESS_KEY: preserve(), CRM_BASE_URL: preserve(), CRON_SECRET: preserve(), DATABASE_URL: preserve(), GOOGLE_AUTH_URL: preserve(), GOOGLE_CLIENT_ID: preserve(), GOOGLE_CLIENT_SECRET: preserve(), GOOGLE_REDIRECT_URI: preserve(), GOOGLE_TOKEN_ENCRYPTION_KEY: preserve(), GOOGLE_TOKEN_URL: preserve(), METRICOOL_API_TOKEN: preserve(), METRICOOL_USER_ID: preserve(), NEXT_PUBLIC_REALTIME_WS_URL: preserve(), WHAPI_PARTNER_TOKEN: preserve(), WHAPI_PROJECT_ID: preserve(), WHAPI_TOKEN_ENCRYPTION_KEY: preserve(), WS_AUTH_SECRET: preserve() },
  });
  const whapiPendingTrigger = service("whapi-pending-trigger", {
    source: github("hassanmehmood-AI/base_44", { checkSuites: false, rootDirectory: "scripts/whapi-pending-trigger" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "/scripts/whapi-pending-trigger/Dockerfile" },
    replicas: { "iad": 1 },
    deploy: { cronSchedule: "*/5 * * * *", restartPolicyType: "NEVER" },
    env: { CRM_BASE_URL: preserve(), CRON_SECRET: preserve() },
  });
  const metricoolSyncWorker = service("metricool-sync-worker", {
    source: github("hassanmehmood-AI/base_44", { checkSuites: false, rootDirectory: "scripts/metricool-sync-worker" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "/scripts/metricool-sync-worker/Dockerfile" },
    replicas: { "iad": 1 },
    env: { CRM_BASE_URL: preserve(), CRON_SECRET: preserve(), SYNC_INTERVAL_SECONDS: preserve() },
  });
  const realtimeWsService = service("realtime-ws-service", {
    source: github("hassanmehmood-AI/base_44", { checkSuites: false, rootDirectory: "scripts/realtime-ws-service" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "/scripts/realtime-ws-service/Dockerfile" },
    replicas: { "iad": 1 },
    env: { CRM_BASE_URL: preserve(), DATABASE_URL: preserve(), WS_AUTH_SECRET: preserve() },
  });

  return project("growth-on", {
    resources: [base_44, Postgres, whapiPendingTrigger, metricoolSyncWorker, realtimeWsService, postgresVolume, customerAvatars],
  });
});
