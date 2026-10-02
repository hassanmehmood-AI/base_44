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

export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const TICKET_STATUSES = ["OPEN", "IN_PROCESS", "RESOLVED", "CLOSED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const CALL_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const CALL_STATUSES = ["COMPLETED", "MISSED", "NO_ANSWER", "FAILED"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const KPI_PERIODS = ["ALL", "MONTH", "QUARTER", "YEAR"] as const;
export type KpiPeriod = (typeof KPI_PERIODS)[number];
