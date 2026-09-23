import { Stage } from "./pipeline";

export const companies = ["Contact-On", "Leyva", "Meca", "Linmania", "Vulcan", "Rockstar"];

export const campaigns = [
  {
    id: "c1",
    name: "Digital Services · Alicante",
    subtitle: "Marketing and web development · Created today",
    company: "Contact-On",
    assignedTo: "Milagros",
    status: "Completed",
    found: 126,
    validated: 94,
    inCrm: 38,
    highlight: true,
  },
  {
    id: "c2",
    name: "Hospitality · Marina Baixa",
    subtitle: "Contact-On Services · Aug 10",
    company: "Rockstar",
    assignedTo: "Ana Victoria",
    status: "In progress",
    found: 98,
    validated: 61,
    inCrm: 20,
  },
  {
    id: "c3",
    name: "Fashion Retail · Valencia",
    subtitle: "B2B Prospecting · Aug 8",
    company: "Leyva",
    assignedTo: "Ana Victoria",
    status: "Completed",
    found: 183,
    validated: 157,
    inCrm: 81,
  },
];

export const prospects = [
  {
    id: "p1",
    empresa: "Calzados Moreno",
    actividad: "Footwear retail",
    localidad: "Alicante",
    contacto: "+34 965 194 800",
    afinidad: 93,
    estado: "NUEVO_LEAD" as Stage,
  },
  {
    id: "p2",
    empresa: "Marroquinería Sol",
    actividad: "Leather accessories",
    localidad: "Alicante",
    contacto: "+34 965 220 339",
    afinidad: 88,
    estado: "CONTACTADO" as Stage,
  },
  {
    id: "p3",
    empresa: "Bar El Puerto",
    actividad: "Hospitality",
    localidad: "Benidorm",
    contacto: "+34 965 552 234",
    afinidad: 81,
    estado: "INTERESADO" as Stage,
  },
  {
    id: "p4",
    empresa: "Boutique Carmen",
    actividad: "Fashion & accessories",
    localidad: "Alicante",
    contacto: "+34 965 331 190",
    afinidad: 79,
    estado: "NUEVO_LEAD" as Stage,
  },
  {
    id: "p5",
    empresa: "Club Dardos Alicante",
    actividad: "Leisure & sports",
    localidad: "Alicante",
    contacto: "+34 965 220 339",
    afinidad: 74,
    estado: "OPORTUNIDAD" as Stage,
  },
  {
    id: "p6",
    empresa: "Gestoría Costa Blanca",
    actividad: "Professional services",
    localidad: "Alicante",
    contacto: "+34 965 442 118",
    afinidad: 68,
    estado: "CONTACTADO" as Stage,
  },
];

export type Contact = {
  id: string;
  name: string;
  subtitle: string;
  tag: string;
  phone: string;
  email: string;
  agente: string;
  origen: string;
  ultimoContacto: string;
  proximaAccion: string;
  status: string;
  lastActivity: string;
};

export const contacts: Contact[] = [
  {
    id: "ct1",
    name: "Club Dardos Alicante",
    subtitle: "Club Dardos Alicante · Alicante",
    tag: "Linmania",
    phone: "+34 965 220 339",
    email: "info@clubdardos.es",
    agente: "Unassigned",
    origen: "Alicante Base",
    ultimoContacto: "14 Aug 12:29",
    proximaAccion: "Sales visit",
    status: "INTERESADO",
    lastActivity: "a month ago",
  },
  {
    id: "ct2",
    name: "Mehrish",
    subtitle: "Direct contact · Prospecting",
    tag: "Contact-On",
    phone: "+92 333 6139035",
    email: "mehrish@example.com",
    agente: "Unassigned",
    origen: "AI Prospecting",
    ultimoContacto: "a month ago",
    proximaAccion: "Call back",
    status: "NUEVO_LEAD",
    lastActivity: "a month ago",
  },
  {
    id: "ct3",
    name: "Calzados Moreno",
    subtitle: "Calzados Moreno · Alicante",
    tag: "Rockstar",
    phone: "+34 965 194 800",
    email: "contacto@calzadosmoreno.es",
    agente: "Milagros",
    origen: "Alicante Base",
    ultimoContacto: "Yesterday",
    proximaAccion: "Send catalog",
    status: "CONTACTADO",
    lastActivity: "a month ago",
  },
  {
    id: "ct4",
    name: "Bar El Puerto",
    subtitle: "Bar El Puerto · Benidorm",
    tag: "Rockstar",
    phone: "+34 965 552 234",
    email: "barelpuerto@example.com",
    agente: "Milagros",
    origen: "AI Prospecting",
    ultimoContacto: "Aug 02",
    proximaAccion: "Call back",
    status: "INTERESADO",
    lastActivity: "2 days ago",
  },
];

export const contactHistory = [
  {
    id: "h1",
    channel: "WhatsApp",
    label: "WhatsApp · INTERESTED",
    author: "Agent",
    time: "a month ago",
  },
];

export const campaignStats = {
  contactosTotales: 2805,
  contactosDelta: "+12%",
  contactados: 1171,
  contactadosPct: "41,7%",
  altasGeneradas: 168,
  altasPct: "14,35%",
  oportunidades: 35,
  oportunidadesDelta: "+8",
};

export const databases = [
  { id: "d1", name: "Alicante", records: 812, progress: 68 },
  { id: "d2", name: "Marroquinerías - Norte", records: 541, progress: 42 },
  { id: "d3", name: "Prospección Agosto", records: 1120, progress: 19 },
  { id: "d4", name: "Clientes inactivos", records: 220, progress: 83 },
];

export const campaignRows = [
  { id: "r1", cliente: "Calzados Moreno", agente: "Milagros", canal: "WhatsApp", estado: "Interested", ultimo: "Today 10:24" },
  { id: "r2", cliente: "Clínica Levante", agente: "Solange", canal: "Call", estado: "To contact", ultimo: "Yesterday" },
  { id: "r3", cliente: "Regalos Martínez", agente: "Solange", canal: "WhatsApp", estado: "To contact", ultimo: "Aug 01" },
  { id: "r4", cliente: "Complementos Luna", agente: "Melina", canal: "WhatsApp", estado: "Order placed", ultimo: "Yesterday" },
  { id: "r5", cliente: "Bar El Puerto", agente: "Milagros", canal: "Call", estado: "Interested", ultimo: "Aug 02" },
];

export const campaignFilters = {
  canal: [
    { label: "WhatsApp", count: 124 },
    { label: "Email", count: 86 },
    { label: "Call", count: 202 },
  ],
  agente: [
    { label: "Milagros", count: 102 },
    { label: "Ana Victoria", count: 85 },
    { label: "Solange", count: 61 },
  ],
};

export const assignedClients = [
  { id: "a1", name: "Clínica Levante", active: true },
  { id: "a2", name: "Gestoría Costa Blanca", active: true },
];

export const channelSummary = {
  whatsapp: { sinLeer: 12, ventasCalientes: 8, seguimientosHoy: 5 },
  correo: { sinLeer: 7, respuestasHoy: 19, pendientes: 11 },
  llamadas: { llamadasHoy: 34, contestadas: 21, rellamadas: 6 },
};

export type PipelineCard = { id: string; name: string; agent: string; time: string };

export const whatsappPipeline: Record<string, PipelineCard[]> = {
  NUEVO_LEAD: [
    { id: "w1", name: "Regalos Martínez", agent: "MS", time: "a month ago" },
    { id: "w2", name: "Zapatería Sol", agent: "AV", time: "a month ago" },
  ],
  CONTACTADO: [
    { id: "w3", name: "Carteras López", agent: "MS", time: "a month ago" },
    { id: "w4", name: "Calzados Moreno", agent: "AV", time: "a month ago" },
  ],
  INTERESADO: [
    { id: "w5", name: "Boutique Carmen", agent: "MS", time: "a month ago" },
    { id: "w6", name: "Pieles Levante", agent: "AV", time: "a month ago" },
  ],
  OPORTUNIDAD: [
    { id: "w7", name: "Club Dardos Alicante", agent: "MS", time: "a month ago" },
  ],
  PEDIDO_EN_CURSO: [{ id: "w8", name: "Piel & Estilo", agent: "MS", time: "a month ago" }],
  CLIENTE: [{ id: "w9", name: "Complementos Luna", agent: "AV", time: "a month ago" }],
  SEGUIMIENTO: [],
};

export const emailThreads = [
  {
    id: "e1",
    company: "Calzados Moreno",
    subject: "Access to professional catalog",
    preview: "Access to professional catalog",
    from: "Calzados Moreno",
    email: "contacto@calzadosmoreno.es",
    body: "Good morning,\n\nWe would like to request access to the professional footwear catalog for the 2026 season. We currently manage a store in Alicante and want to expand our suppliers.\n\nCould you send us the terms and delivery times?\n\nThank you,\nCalzados Moreno",
  },
  {
    id: "e2",
    company: "Piel & Estilo",
    subject: "Web access request",
    preview: "Web access request",
    from: "Piel & Estilo",
    email: "info@pielyestilo.es",
    body: "Hello,\n\nWe wanted to request access to the web platform to check stock availability.\n\nBest regards.",
  },
  {
    id: "e3",
    company: "Regalos Martínez",
    subject: "Quote for 50 units",
    preview: "Quote for 50 units",
    from: "Regalos Martínez",
    email: "compras@regalosmartinez.es",
    body: "Good afternoon,\n\nWe would need a quote for 50 units of the standard model.\n\nWaiting for your response.",
  },
  {
    id: "e4",
    company: "Complementos Luna",
    subject: "Order confirmation",
    preview: "Order confirmation",
    from: "Complementos Luna",
    email: "pedidos@complementosluna.es",
    body: "Hello team,\n\nWe confirm the order sent last week. We look forward to the delivery date.\n\nThank you.",
  },
];

export const emailResources = [
  "Speech · Web access",
  "Catalog 2026",
  "First order terms",
  "Schedule sales visit",
];

export const callQueue = [
  { id: "call1", name: "Mehrish", phone: "+923336139035" },
  { id: "call2", name: "Calzados Moreno", phone: "+34 965 194 800" },
  { id: "call3", name: "Bar El Puerto", phone: "+34 965 552 234" },
  { id: "call4", name: "Gestoría Costa Blanca", phone: "+34 965 442 118" },
  { id: "call5", name: "Piel & Estilo", phone: "+34 965 331 190" },
  { id: "call6", name: "Regalos Martínez", phone: "+34 965 220 118" },
  { id: "call7", name: "Complementos Luna", phone: "+34 965 887 213" },
  { id: "call8", name: "Club Dardos Alicante", phone: "+34 965 220 339" },
  { id: "call9", name: "Calzados Moreno", phone: "+34 965 194 801" },
  { id: "call10", name: "Clínica Levante", phone: "+34 965 774 402" },
];

export const socialInbox = [
  { id: "s1", handle: "@marta_complementos", platform: "IG", preview: "¿Tenéis este modelo en color negro?" },
  { id: "s2", handle: "Calzados Martín", platform: "FB", preview: "¿Cuál es el horario de la tienda?" },
  { id: "s3", handle: "Boutique Elvira", platform: "MSG", preview: "Queríamos confirmar el pedido." },
];

export const kpiStats = {
  leadsTrabajados: { value: "1,240", delta: "+14% vs previous" },
  oportunidades: { value: "185", delta: "+8%" },
  conversiones: { value: "42 · €18,900", delta: "+6%" },
  tasaConversion: { value: "22.7%", delta: "+3.1 pp" },
};

export const kpiMonthly = [
  { month: "Jan", leads: 900, conversiones: 62 },
  { month: "Feb", leads: 1020, conversiones: 74 },
  { month: "Mar", leads: 1180, conversiones: 91 },
  { month: "Apr", leads: 980, conversiones: 68 },
  { month: "May", leads: 1250, conversiones: 96 },
  { month: "Jun", leads: 1310, conversiones: 108 },
];

export const agentPerformance = [
  { agente: "David Leyva", asignados: 320, contactados: 210, oportunidades: 52, ventas: 12, tasa: "23,1%" },
  { agente: "Victor Castillero", asignados: 280, contactados: 195, oportunidades: 44, ventas: 9, tasa: "20,5%" },
  { agente: "Milagros", asignados: 240, contactados: 160, oportunidades: 38, ventas: 11, tasa: "28,9%" },
  { agente: "Ana Victoria", asignados: 210, contactados: 140, oportunidades: 31, ventas: 7, tasa: "22,6%" },
  { agente: "Gabriel", asignados: 190, contactados: 120, oportunidades: 20, ventas: 3, tasa: "15,0%" },
];

export const users = [
  { id: "u1", name: "David Leyva", role: "Superuser" },
  { id: "u2", name: "Victor Castillero", role: "Superuser" },
  { id: "u3", name: "Yan Novitskiy", role: "Superuser" },
  { id: "u4", name: "Diego Zilli", role: "Director" },
  { id: "u5", name: "Milagros", role: "Call Center Lead" },
  { id: "u6", name: "Ana Victoria", role: "Call Center Agent" },
  { id: "u7", name: "Gabriel", role: "Call Center Agent" },
  { id: "u8", name: "Carmen", role: "Marketing" },
];

export const allowedCompanies = ["Contact-On", "Leyva", "Meca", "Linmania", "Vulcan", "Rockstar"];
export const allowedModules = [
  "Prospecting",
  "CRM",
  "Channels",
  "KPI's",
  "User & role management",
  "Manage Campaigns",
  "Active Campaigns",
  "Technical Support",
];
export const kpiDepartments = ["WEBS", "CALL CENTER", "MARKETING", "SALES VISITS"];

export const tickets = [
  {
    id: "1043",
    company: "Contact-On",
    subject: "jhgjhgkj",
    status: "Open",
    priority: "High",
    createdBy: "You",
    assignee: "Roller - Support",
  },
  {
    id: "1038",
    company: "Leyva",
    subject: "Error exporting campaign to Excel",
    status: "Open",
    priority: "Medium",
    createdBy: "Milagros",
    assignee: "Roller - Support",
  },
  {
    id: "1029",
    company: "Contact-On",
    subject: "Choppy audio on call",
    status: "Resolved",
    priority: "Critical",
    createdBy: "Ana Victoria",
    assignee: "Roller - Support",
  },
  {
    id: "1042",
    company: "Contact-On",
    subject: "WhatsApp history not loading",
    status: "In progress",
    priority: "High",
    createdBy: "Gabriel",
    assignee: "Roller - Support",
  },
];
