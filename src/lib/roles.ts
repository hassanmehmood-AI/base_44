import type { RoleKey } from "@/server/constants";

export const ROLE_LABEL: Record<RoleKey, string> = {
  SUPERUSER: "Superuser",
  DIRECTOR: "Director",
  CALL_CENTER_LEAD: "Call Center Lead",
  CALL_CENTER_AGENT: "Call Center Agent",
  MARKETING: "Marketing",
};

export const ROLE_LABEL_ES: Record<RoleKey, string> = {
  SUPERUSER: "Superusuario",
  DIRECTOR: "Director",
  CALL_CENTER_LEAD: "Jefe de Call Center",
  CALL_CENTER_AGENT: "Agente Call Center",
  MARKETING: "Marketing",
};
