export const ROLE_KEYS = [
  "SUPERUSER",
  "DIRECTOR",
  "CALL_CENTER_LEAD",
  "CALL_CENTER_AGENT",
  "MARKETING",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

// Matches src/lib/mock-data.ts `allowedModules` (one key per sidebar-gated module)
export const MODULE_KEYS = [
  "PROSPECTING",
  "CRM",
  "CHANNELS",
  "KPIS",
  "USER_ROLE_MANAGEMENT",
  "MANAGE_CAMPAIGNS",
  "ACTIVE_CAMPAIGNS",
  "TECHNICAL_SUPPORT",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
