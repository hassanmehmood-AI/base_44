import type { RoleKey } from "@/server/constants";

// CALL_CENTER_LEAD is displayed as "Call Center Manager" per the hierarchy
// redesign (Superuser → Director → Call Center Manager → Agent) — the DB
// role key is unchanged to avoid a data migration; this is a label-only
// rename, see plan.md §1.
export const ROLE_LABEL: Record<RoleKey, string> = {
  SUPERUSER: "Superuser",
  DIRECTOR: "Director",
  CALL_CENTER_LEAD: "Call Center Manager",
  CALL_CENTER_AGENT: "Call Center Agent",
  MARKETING: "Marketing",
};

export const ROLE_LABEL_ES: Record<RoleKey, string> = {
  SUPERUSER: "Superusuario",
  DIRECTOR: "Director",
  CALL_CENTER_LEAD: "Gerente de Call Center",
  CALL_CENTER_AGENT: "Agente Call Center",
  MARKETING: "Marketing",
};
