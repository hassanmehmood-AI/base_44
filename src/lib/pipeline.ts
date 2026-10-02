export type Stage =
  | "NUEVO_LEAD"
  | "CONTACTADO"
  | "INTERESADO"
  | "OPORTUNIDAD"
  | "PEDIDO_EN_CURSO"
  | "CLIENTE"
  | "SEGUIMIENTO"
  | "POR_CONTACTAR"
  | "PEDIDO_REALIZADO";

export const STAGE_LABEL: Record<Stage, string> = {
  NUEVO_LEAD: "New lead",
  CONTACTADO: "Contacted",
  INTERESADO: "Interested",
  OPORTUNIDAD: "Opportunity",
  PEDIDO_EN_CURSO: "Order in progress",
  CLIENTE: "Client",
  SEGUIMIENTO: "Follow-up",
  POR_CONTACTAR: "To contact",
  PEDIDO_REALIZADO: "Order placed",
};

export const STAGE_LABEL_ES: Record<Stage, string> = {
  NUEVO_LEAD: "Nuevo lead",
  CONTACTADO: "Contactado",
  INTERESADO: "Interesado",
  OPORTUNIDAD: "Oportunidad",
  PEDIDO_EN_CURSO: "Pedido en curso",
  CLIENTE: "Cliente",
  SEGUIMIENTO: "Seguimiento",
  POR_CONTACTAR: "Por contactar",
  PEDIDO_REALIZADO: "Pedido realizado",
};

/** KPIs §15: a contact counts as an "opportunity" once it has reached OPORTUNIDAD
 * or any later stage in the funnel (current stage, not stage history — there is
 * no separate stage-change log beyond the STATUS_CHANGE activity trail). */
export const OPPORTUNITY_STAGE_KEYS: Stage[] = ["OPORTUNIDAD", "PEDIDO_EN_CURSO", "CLIENTE", "SEGUIMIENTO"];

/** A contact counts as a "customer" once it reaches CLIENTE or the post-sale
 * SEGUIMIENTO follow-up stage. */
export const CUSTOMER_STAGE_KEYS: Stage[] = ["CLIENTE", "SEGUIMIENTO"];

export const STAGE_TONE: Record<Stage, "green" | "amber" | "blue" | "gray"> = {
  NUEVO_LEAD: "blue",
  CONTACTADO: "amber",
  INTERESADO: "green",
  OPORTUNIDAD: "green",
  PEDIDO_EN_CURSO: "amber",
  CLIENTE: "green",
  SEGUIMIENTO: "gray",
  POR_CONTACTAR: "amber",
  PEDIDO_REALIZADO: "green",
};
