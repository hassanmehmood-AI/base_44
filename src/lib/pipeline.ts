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
