import type { Language } from "@/context/LanguageContext";

/** Activity `type` column (see src/db/schema.ts) plus the assignment variants
 * actually written by the service layer — centralized here so no call site
 * has to fall back to displaying the raw DB value (e.g. "STATUS_CHANGE"). */
export type ActivityType =
  | "CALL"
  | "EMAIL"
  | "SOCIAL"
  | "NOTE"
  | "TASK"
  | "STATUS_CHANGE"
  | "AI_CLASSIFICATION"
  | "ASSIGNMENT"
  | "AUTO_ASSIGNMENT";

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  CALL: "Call",
  EMAIL: "Email",
  SOCIAL: "Social media",
  NOTE: "Note",
  TASK: "Task",
  STATUS_CHANGE: "Status Changed",
  AI_CLASSIFICATION: "AI Classification",
  ASSIGNMENT: "Assigned",
  AUTO_ASSIGNMENT: "Auto Assigned",
};

export const ACTIVITY_TYPE_LABEL_ES: Record<ActivityType, string> = {
  CALL: "Llamada",
  EMAIL: "Correo electrónico",
  SOCIAL: "Redes sociales",
  NOTE: "Nota",
  TASK: "Tarea",
  STATUS_CHANGE: "Cambio de estado",
  AI_CLASSIFICATION: "Clasificación IA",
  ASSIGNMENT: "Asignado",
  AUTO_ASSIGNMENT: "Asignado automáticamente",
};

/** Activity `channel` column — a finer-grained signal than `type` (e.g. a
 * SOCIAL-type activity's channel distinguishes WhatsApp from other social
 * platforms), so it takes priority over the type label when present. */
export type ActivityChannel = "WHATSAPP" | "CALL" | "EMAIL" | "SOCIAL" | "NOTES";

export const ACTIVITY_CHANNEL_LABEL: Record<ActivityChannel, string> = {
  WHATSAPP: "WhatsApp",
  CALL: "Call",
  EMAIL: "Email",
  SOCIAL: "Social media",
  NOTES: "Notes",
};

export const ACTIVITY_CHANNEL_LABEL_ES: Record<ActivityChannel, string> = {
  WHATSAPP: "WhatsApp",
  CALL: "Llamada",
  EMAIL: "Correo electrónico",
  SOCIAL: "Redes sociales",
  NOTES: "Notas",
};

/** Not a current DB enum value (no feature writes it yet) — included so a
 * future "callback requested" outcome/type has a ready translation instead
 * of yet another raw-code leak. */
export const CALLBACK_LABEL = { en: "Callback", es: "Devolución de llamada" };

export function getActivityTypeLabel(type: string, language: Language): string {
  const map = language === "es" ? ACTIVITY_TYPE_LABEL_ES : ACTIVITY_TYPE_LABEL;
  return map[type as ActivityType] ?? type;
}

export function getActivityChannelLabel(channel: string, language: Language): string {
  const map = language === "es" ? ACTIVITY_CHANNEL_LABEL_ES : ACTIVITY_CHANNEL_LABEL;
  return map[channel as ActivityChannel] ?? channel;
}

/** Display label for one activity's "kind" — channel first (more specific:
 * tells WhatsApp apart from other social activity), falling back to type
 * (covers channel-less activities like STATUS_CHANGE/ASSIGNMENT/NOTE). */
export function getActivityLabel(activity: { type: string; channel?: string | null }, language: Language): string {
  if (activity.channel) return getActivityChannelLabel(activity.channel, language);
  return getActivityTypeLabel(activity.type, language);
}
