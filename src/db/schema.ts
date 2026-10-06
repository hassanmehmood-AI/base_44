import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Identity & access
// ---------------------------------------------------------------------------

export const companies = pgTable("companies", {
  id: id(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("companies_slug_idx").on(t.slug),
  uniqueIndex("companies_name_idx").on(t.name),
]);

export const roles = pgTable("roles", {
  id: id(),
  key: text("key").notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("roles_key_idx").on(t.key),
]);

export const users = pgTable("users", {
  id: id(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
  isActive: boolean("is_active").notNull().default(true),
  // credentials auth (Auth.js) — nullable so a future OAuth-only user isn't forced to have one
  passwordHash: text("password_hash"),
  authProviderId: text("auth_provider_id"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("users_email_idx").on(t.email),
  index("users_role_id_idx").on(t.roleId),
]);

export const userCompanyAccess = pgTable("user_company_access", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.companyId] }),
  index("user_company_access_company_id_idx").on(t.companyId),
]);

export const userModuleAccess = pgTable("user_module_access", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // PROSPECTING | CRM | CHANNELS | KPIS | USER_ROLE_MANAGEMENT | MANAGE_CAMPAIGNS | ACTIVE_CAMPAIGNS | TECHNICAL_SUPPORT
  module: text("module").notNull(),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.module] }),
]);

/** One row per company — the persisted "whose turn is next" state for
 * automatic Round Robin lead assignment. Read with `SELECT ... FOR UPDATE`
 * inside the same transaction as the contact insert, so concurrent contact
 * creations for the same company serialize on this one row instead of
 * racing (different companies never block each other). Deliberately not an
 * in-memory counter — survives restarts and works across server instances. */
export const companyRoundRobinCursors = pgTable("company_round_robin_cursors", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  lastAssignedUserId: uuid("last_assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Sales pipeline
// ---------------------------------------------------------------------------

export const pipelines = pgTable("pipelines", {
  id: id(),
  // null = shared/global pipeline (v1 default, per approved decision)
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
});

export const pipelineStages = pgTable("pipeline_stages", {
  id: id(),
  pipelineId: uuid("pipeline_id").notNull().references(() => pipelines.id, { onDelete: "cascade" }),
  // NUEVO_LEAD | CONTACTADO | INTERESADO | OPORTUNIDAD | PEDIDO_EN_CURSO | CLIENTE | SEGUIMIENTO
  key: text("key").notNull(),
  position: integer("position").notNull(),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [
  uniqueIndex("pipeline_stages_pipeline_key_idx").on(t.pipelineId, t.key),
]);

// ---------------------------------------------------------------------------
// CRM core
// ---------------------------------------------------------------------------

export const contacts = pgTable("contacts", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  businessName: text("business_name"),
  phone: text("phone"),
  email: text("email"),
  assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  leadSource: text("lead_source"),
  pipelineStageId: uuid("pipeline_stage_id").notNull().references(() => pipelineStages.id, { onDelete: "restrict" }),
  // denormalized cache — written transactionally by the service layer whenever an activity is appended
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
  nextAction: text("next_action"),
  followUpAt: timestamp("follow_up_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("contacts_company_stage_idx").on(t.companyId, t.pipelineStageId),
  index("contacts_company_assigned_idx").on(t.companyId, t.assignedUserId),
  index("contacts_follow_up_at_idx").on(t.followUpAt),
]);

// append-only: no updatedAt, no delete path exposed at the service layer (see db/triggers.sql)
export const activities = pgTable("activities", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  // CALL | EMAIL | SOCIAL | NOTE | TASK | STATUS_CHANGE | AI_CLASSIFICATION
  type: text("type").notNull(),
  // WHATSAPP | CALL | EMAIL | SOCIAL | NOTES — null for non-channel types
  channel: text("channel"),
  outcome: text("outcome"),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
}, (t) => [
  index("activities_contact_created_idx").on(t.contactId, t.createdAt),
  index("activities_company_created_idx").on(t.companyId, t.createdAt),
]);

export const tasks = pgTable("tasks", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  // LOW | MEDIUM | HIGH | URGENT
  priority: text("priority"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  // PENDING | IN_PROGRESS | COMPLETED | CANCELLED
  status: text("status").notNull().default("PENDING"),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  index("tasks_company_assigned_status_idx").on(t.companyId, t.assignedUserId, t.status),
  index("tasks_due_at_idx").on(t.dueAt),
]);

// ---------------------------------------------------------------------------
// Campaigns & prospecting
// ---------------------------------------------------------------------------

export const campaigns = pgTable("campaigns", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  objective: text("objective"),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  // DRAFT | ACTIVE | PAUSED | COMPLETED
  status: text("status").notNull().default("DRAFT"),
  createdAt: createdAt(),
}, (t) => [
  index("campaigns_company_id_idx").on(t.companyId),
]);

export const prospectLeads = pgTable("prospect_leads", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  businessName: text("business_name").notNull(),
  activity: text("activity"),
  location: text("location"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  website: text("website"),
  aiAffinityScore: integer("ai_affinity_score"),
  // NEW | VALIDATED | SENT_TO_CRM | REJECTED | DUPLICATE — deliberately separate from pipeline_stages
  status: text("status").notNull().default("NEW"),
  sourceProvider: text("source_provider"),
  externalId: text("external_id"),
  convertedContactId: uuid("converted_contact_id").references(() => contacts.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [
  index("prospect_leads_campaign_id_idx").on(t.campaignId),
  uniqueIndex("prospect_leads_company_external_idx")
    .on(t.companyId, t.externalId)
    .where(sql`${t.externalId} is not null`),
]);

export const campaignMembers = pgTable("campaign_members", {
  id: id(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  prospectLeadId: uuid("prospect_lead_id").notNull().references(() => prospectLeads.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  assignedAgentId: uuid("assigned_agent_id").references(() => users.id, { onDelete: "set null" }),
  // FOUND | VALIDATED | ASSIGNED | CONVERTED | REJECTED
  status: text("status").notNull().default("FOUND"),
  createdAt: createdAt(),
}, (t) => [
  index("campaign_members_campaign_status_idx").on(t.campaignId, t.status),
]);

/** Plain CRM-direct campaign membership (guide §17 Option B) — deliberately
 * separate from campaign_members, which requires a prospect_lead_id and
 * belongs to the deferred AI/prospecting pipeline (see §19). A contact
 * reaches a campaign here via direct CSV import, not AI qualification. */
export const campaignContacts = pgTable("campaign_contacts", {
  id: id(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("campaign_contacts_campaign_contact_idx").on(t.campaignId, t.contactId),
  index("campaign_contacts_campaign_id_idx").on(t.campaignId),
]);

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

export const conversations = pgTable("conversations", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  // EMAIL | WHATSAPP | SOCIAL
  channel: text("channel").notNull(),
  externalThreadId: text("external_thread_id"),
  subject: text("subject"),
  assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("conversations_company_channel_last_msg_idx").on(t.companyId, t.channel, t.lastMessageAt),
]);

// append-only
export const messages = pgTable("messages", {
  id: id(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  // INBOUND | OUTBOUND
  direction: text("direction").notNull(),
  senderLabel: text("sender_label"),
  body: text("body").notNull(),
  metadata: jsonb("metadata"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("messages_conversation_sent_idx").on(t.conversationId, t.sentAt),
]);

/** Maps an external social page/account to the company it belongs to, so an
 * inbound Meta webhook (which only carries a Page ID) can resolve which
 * company's conversations table a message belongs to. One row per connected
 * page — added for guide §16 Social; populated when a company connects a
 * Facebook Page/Instagram account (no UI for that yet, see guide). */
export const companySocialAccounts = pgTable("company_social_accounts", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // META_PAGE | META_INSTAGRAM
  platform: text("platform").notNull(),
  externalPageId: text("external_page_id").notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("company_social_accounts_platform_page_idx").on(t.platform, t.externalPageId),
]);

export const calls = pgTable("calls", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  // INBOUND | OUTBOUND
  direction: text("direction").notNull(),
  phoneNumber: text("phone_number").notNull(),
  // COMPLETED | MISSED | NO_ANSWER | FAILED
  status: text("status").notNull(),
  durationSeconds: integer("duration_seconds"),
  outcome: text("outcome"),
  notes: text("notes"),
  recordingUrl: text("recording_url"),
  calledBy: uuid("called_by").references(() => users.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
}, (t) => [
  index("calls_contact_started_idx").on(t.contactId, t.startedAt),
]);

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

export const tickets = pgTable("tickets", {
  id: id(),
  ticketNumber: bigint("ticket_number", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  subject: text("subject").notNull(),
  description: text("description"),
  // OPEN | IN_PROCESS | RESOLVED | CLOSED
  status: text("status").notNull().default("OPEN"),
  // LOW | MEDIUM | HIGH | CRITICAL
  priority: text("priority").notNull().default("MEDIUM"),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("tickets_ticket_number_idx").on(t.ticketNumber),
  index("tickets_company_status_idx").on(t.companyId, t.status),
]);

// append-only
export const ticketMessages = pgTable("ticket_messages", {
  id: id(),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("ticket_messages_ticket_created_idx").on(t.ticketId, t.createdAt),
]);

// ---------------------------------------------------------------------------
// AI (kept separate from core CRM records — see guide §15)
// ---------------------------------------------------------------------------

export const aiAnalysis = pgTable("ai_analysis", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  prospectLeadId: uuid("prospect_lead_id").references(() => prospectLeads.id, { onDelete: "cascade" }),
  // LEAD_SCORING | CRM_ANALYSIS
  analysisType: text("analysis_type").notNull(),
  modelProvider: text("model_provider").notNull(),
  modelName: text("model_name").notNull(),
  inputSnapshot: jsonb("input_snapshot").notNull(),
  output: jsonb("output").notNull(),
  // PENDING | APPLIED | DISMISSED — human approval gate before it touches core CRM state
  status: text("status").notNull().default("PENDING"),
  appliedBy: uuid("applied_by").references(() => users.id, { onDelete: "set null" }),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("ai_analysis_contact_id_idx").on(t.contactId),
  index("ai_analysis_prospect_lead_id_idx").on(t.prospectLeadId),
  index("ai_analysis_status_idx").on(t.status),
  check("ai_analysis_subject_xor", sql`(${t.contactId} is not null) <> (${t.prospectLeadId} is not null)`),
]);
