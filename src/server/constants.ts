export const ROLE_KEYS = [
  "SUPERUSER",
  "DIRECTOR",
  "CALL_CENTER_LEAD",
  "CALL_CENTER_AGENT",
  "MARKETING",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

// Roles eligible to receive automatic Round Robin lead assignment — confirmed
// with the product owner (Call Center Agent only; Superuser is explicitly
// excluded by design even though it has implicit company access everywhere).
export const ROUND_ROBIN_ELIGIBLE_ROLES: RoleKey[] = ["CALL_CENTER_AGENT"];

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

// KPI "Department" filter — there's no department column anywhere in the
// schema, so a contact's department is derived from the role of its
// assigned agent. SALES covers both Call Center roles (the only roles that
// actually work leads day to day); MARKETING is the dedicated Marketing
// role. A contact with no assigned agent matches neither.
export const KPI_DEPARTMENTS = ["SALES", "MARKETING"] as const;
export type KpiDepartment = (typeof KPI_DEPARTMENTS)[number];
export const DEFAULT_KPI_DEPARTMENT: KpiDepartment = "SALES";
export const KPI_DEPARTMENT_ROLE_KEYS: Record<KpiDepartment, RoleKey[]> = {
  SALES: ["CALL_CENTER_LEAD", "CALL_CENTER_AGENT"],
  MARKETING: ["MARKETING"],
};

// "Reset by role" baseline module grants — there's no prior stored or
// enforced default anywhere else in the codebase (every non-Superuser
// role requires fully explicit per-user module grants today, see
// authorization.ts's assertModuleAccess); these are a product decision,
// not something inferred from existing code. Derived from the role
// descriptions already shown on the Roles tab (src/app/(dashboard)/
// configuracion/ConfiguracionClient.tsx's roleDescByKey) and confirmed as
// the approved baseline before use. SUPERUSER is intentionally absent —
// it has implicit access to everything and "Reset by role" never applies
// to a Superuser target (same guard as the rest of the permissions panel).
export const DEFAULT_MODULES_BY_ROLE: Record<Exclude<RoleKey, "SUPERUSER">, ModuleKey[]> = {
  DIRECTOR: ["KPIS", "MANAGE_CAMPAIGNS", "ACTIVE_CAMPAIGNS"],
  CALL_CENTER_LEAD: ["CHANNELS", "MANAGE_CAMPAIGNS", "ACTIVE_CAMPAIGNS"],
  CALL_CENTER_AGENT: ["CRM", "CHANNELS"],
  MARKETING: ["PROSPECTING", "MANAGE_CAMPAIGNS", "KPIS"],
};
