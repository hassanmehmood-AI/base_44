export type Stage =
  | "NUEVO_LEAD"
  | "CONTACTADO"
  | "INTERESADO"
  | "OPORTUNIDAD"
  | "PEDIDO_EN_CURSO"
  | "CLIENTE"
  | "SEGUIMIENTO"
  | "POR_CONTACTAR"
  | "PEDIDO_REALIZADO"
  | "PERDIDO";

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
  PERDIDO: "Lost",
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
  PERDIDO: "Perdido",
};

/** KPIs §15: a contact counts as an "opportunity" once it has reached OPORTUNIDAD
 * or any later stage in the funnel (current stage, not stage history — there is
 * no separate stage-change log beyond the STATUS_CHANGE activity trail).
 * PERDIDO is deliberately never included here — a lost lead was an
 * opportunity in the past, but counting it as a CURRENT one would inflate
 * the figure with deals that didn't close; see LOST_STAGE_KEYS below for how
 * it's reported instead. */
export const OPPORTUNITY_STAGE_KEYS: Stage[] = ["OPORTUNIDAD", "PEDIDO_EN_CURSO", "CLIENTE", "SEGUIMIENTO"];

/** A contact counts as a "customer" once it reaches CLIENTE or the post-sale
 * SEGUIMIENTO follow-up stage. Unaffected by PERDIDO's addition — a lost
 * lead was never a customer, by definition. */
export const CUSTOMER_STAGE_KEYS: Stage[] = ["CLIENTE", "SEGUIMIENTO"];

/** Lead management workflow Step 3: the one stage key that represents a
 * closed-lost outcome. Kept as its own single-purpose array (rather than
 * folded into a boolean column or a status enum) so every existing
 * OPPORTUNITY_STAGE_KEYS/CUSTOMER_STAGE_KEYS consumer — every KPI
 * computation, every "is this contact active" check — only had to change by
 * exclusion (PERDIDO was simply never added to those two arrays), never by
 * modification. Also what "reopening" a lost lead checks against: moving OUT
 * of this set is all "reopen" means, no separate flag to clear. */
export const LOST_STAGE_KEYS: Stage[] = ["PERDIDO"];

export const STAGE_TONE: Record<Stage, "green" | "amber" | "blue" | "gray" | "red"> = {
  NUEVO_LEAD: "blue",
  CONTACTADO: "amber",
  INTERESADO: "green",
  OPORTUNIDAD: "green",
  PEDIDO_EN_CURSO: "amber",
  CLIENTE: "green",
  SEGUIMIENTO: "gray",
  POR_CONTACTAR: "amber",
  PEDIDO_REALIZADO: "green",
  PERDIDO: "red",
};
