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
  // Agent Online button — a simple manual ONLINE/OFFLINE toggle the agent
  // sets themselves (see services/users.ts's setMyOnlineStatus), visible to
  // their Manager/Director/Superuser. Purely a self-reported visibility
  // signal: no heartbeat, and no effect on Round Robin or assignment
  // eligibility. Column already existed in both local databases from an
  // earlier, larger feature attempt (migration 0012) — reused as-is rather
  // than adding a new one.
  availabilityStatus: text("availability_status").notNull().default("OFFLINE"),
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

/** Real Manager → Agent relationship (hierarchy redesign phase 1 — not yet
 * read or written by any service/action/UI; additive only this phase). One
 * row per agent per company — the unique index enforces "one manager per
 * agent per company at a time," so reassigning an agent to a different
 * manager is a single UPDATE, never a delete+recreate, and never touches
 * contacts/activities history. onDelete "restrict" on both FKs matches this
 * codebase's existing convention of deactivating users (users.isActive)
 * rather than deleting them. An agent with no row here simply has no
 * manager yet and is not eligible for any manager's Auto Assign Leads. */
export const managerAgentAssignments = pgTable("manager_agent_assignments", {
  id: id(),
  managerUserId: uuid("manager_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  agentUserId: uuid("agent_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("manager_agent_company_idx").on(t.agentUserId, t.companyId),
  index("manager_agent_assignments_manager_idx").on(t.managerUserId),
]);

/** Physically exists in both local databases (migration 0012, from an
 * earlier, larger Agent Availability attempt) — declared here so schema.ts
 * stays accurate and a future `drizzle-kit generate` doesn't propose
 * dropping it. Not read or written by the current Agent Online button
 * feature (which only uses users.availabilityStatus above). */
export const agentPresence = pgTable("agent_presence", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
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
  // Manager-Based Team Isolation — which CALL_CENTER_LEAD owns this lead,
  // independent of campaign linkage or current agent assignment. Needed
  // specifically for a Manager-created, campaign-less, still-Unassigned
  // lead: without this column there is nothing on the row itself to derive
  // ownership from (see findManyByManagerScope's campaign-owner /
  // assigned-agent's-manager OR-conditions, both of which are absent for
  // exactly that case). Set once at creation (services/contacts.ts's
  // createContact/importContacts) and never reassigned automatically —
  // reassigning a lead's owning manager, if ever needed, is a deliberate
  // admin action, not a side effect of campaign or assignment changes.
  // Nullable: stays null for Director/Superuser/Marketing-created leads,
  // exactly mirroring today's "no manager owner" case.
  managerId: uuid("manager_id").references(() => users.id, { onDelete: "set null" }),
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
  index("contacts_company_manager_idx").on(t.companyId, t.managerId),
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
  // Hierarchy redesign phase 3 reuses this as "assigned Call Center Manager"
  // (already the right shape: nullable, one owner, historical campaigns keep
  // working with ownerId = null meaning "unassigned") — not yet enforced or
  // scoped by role this phase; still today's plain creation-time field.
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  // DRAFT | ACTIVE | PAUSED | COMPLETED
  status: text("status").notNull().default("DRAFT"),
  createdAt: createdAt(),
}, (t) => [
  index("campaigns_company_id_idx").on(t.companyId),
]);

/** One row per campaign — the persisted "whose turn is next" state for the
 * manager-scoped "Auto Assign Leads" Round Robin (hierarchy redesign phase 6
 * — not yet read or written by any service/action/UI this phase). Keyed by
 * campaign, not by manager: each campaign's lead distribution rotates
 * independently, so one manager's other campaigns are never perturbed by
 * where this campaign's rotation landed. Same lock/self-heal shape as
 * companyRoundRobinCursors (SELECT ... FOR UPDATE in the same transaction as
 * the assignment writes; if the last-assigned agent is no longer eligible —
 * e.g. the campaign was reassigned to a different manager with a different
 * team — the rotation safely restarts from the top). If a campaign is
 * reassigned to a new manager, this one row carries over rather than
 * orphaning a manager-keyed cursor. */
export const campaignRoundRobinCursors = pgTable("campaign_round_robin_cursors", {
  campaignId: uuid("campaign_id").primaryKey().references(() => campaigns.id, { onDelete: "cascade" }),
  lastAssignedUserId: uuid("last_assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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

/** One connected mailbox (Google Workspace via OAuth today; SMTP/IMAP is a
 * planned second `provider` value, not yet implemented). Deliberately NOT
 * unique on companyId alone — unlike whapiChannels (one WhatsApp number per
 * company), a company can connect several mailboxes at once (e.g. sales@,
 * support@), so the real company-scoped uniqueness constraint is
 * (companyId, emailAddress): the same address can't be connected twice to
 * the same company, but the same Workspace user CAN legitimately be
 * connected under more than one company in this system.
 *
 * encryptedRefreshToken is the durable secret (long-lived, what actually
 * lets this app act as the mailbox indefinitely) — encrypted at rest via
 * server/crypto/secretBox.ts, the same AES-256-GCM scheme already used for
 * whapiChannels.encryptedToken, for the same reason: unlike Metricool's
 * single shared account token, every connected mailbox has its own distinct
 * credential. encryptedAccessToken is the short-lived (~1hr) token cached
 * alongside it purely to avoid re-exchanging the refresh token on every
 * single send/sync call; accessTokenExpiresAt is what tells the service
 * layer when that cached value is stale and a fresh exchange is needed.
 *
 * historyId is Gmail's own incremental-sync cursor (Users.history.list) —
 * this is literally the mechanism that makes "sync new mail only, never
 * historical" correct and cheap: each sync pass resumes from this value
 * instead of re-scanning the mailbox. watchExpiration tracks the Gmail
 * Pub/Sub push-notification subscription's expiry (Google caps these at 7
 * days), so a renewal job knows which rows are coming due — same
 * "scheduled renewal" shape as this app's other recurring Railway cron
 * jobs (see scripts/whapi-pending-trigger). */
/** SMTP/IMAP connection fields below (companyEmailAccounts) are additive —
 * nullable, only ever populated for provider = "SMTP_IMAP" rows, and never
 * read by the Google Workspace code path at all. One shared username/
 * password pair per mailbox (not separate SMTP vs IMAP credentials): this
 * matches how virtually every real-world webmail provider actually issues
 * credentials — the same login works for both protocols — and is the exact
 * "host/port/username/password" shape every generic email client (Outlook,
 * Thunderbird, Apple Mail's manual setup) already asks for, which is what
 * makes this genuinely provider-agnostic rather than tied to any one
 * webmail vendor's API. */
export const companyEmailAccounts = pgTable("company_email_accounts", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // GOOGLE_WORKSPACE | SMTP_IMAP
  provider: text("provider").notNull(),
  // Always stored normalized (trim().toLowerCase()) by the service layer —
  // same convention as contactsService's normalizeEmail — so the
  // case-insensitive uniqueness guaranteed by the index below (lower(...))
  // actually matches what every write path puts in this column; the index
  // is the hard guarantee, this is what keeps lookups/comparisons
  // consistent with it rather than relying on lower() at read time too.
  emailAddress: text("email_address").notNull(),
  displayName: text("display_name"),
  // PENDING -> ACTIVE | FAILED | NEEDS_REAUTH -> DISCONNECTED. DISCONNECTED
  // is the one terminal state excluded from the uniqueness index below — a
  // disconnected row is kept (never deleted) so conversations.
  // companyEmailAccountId keeps resolving for historical messages, but it
  // must not permanently block that same address from being reconnected,
  // by this company or any other.
  status: text("status").notNull().default("PENDING"),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  encryptedAccessToken: text("encrypted_access_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  // Space-separated OAuth scopes actually granted at consent time — lets the
  // service layer detect a reconnect that narrowed access (e.g. a user
  // re-authorizing but declining the send scope) rather than assuming
  // whatever scopes the app currently requests were actually granted.
  grantedScopes: text("granted_scopes"),
  historyId: text("history_id"),
  watchExpiration: timestamp("watch_expiration", { withTimezone: true }),
  // SMTP/IMAP-only fields — all null for GOOGLE_WORKSPACE rows.
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  // SSL | STARTTLS | NONE
  smtpSecurity: text("smtp_security"),
  imapHost: text("imap_host"),
  imapPort: integer("imap_port"),
  // SSL | STARTTLS | NONE
  imapSecurity: text("imap_security"),
  // Usually the same as emailAddress, but not always (e.g. some providers'
  // login name differs from the mailbox address) — kept as its own field
  // rather than assuming emailAddress is always the login.
  smtpImapUsername: text("smtp_imap_username"),
  // Same AES-256-GCM scheme as encryptedRefreshToken above, via its own
  // crypto/smtpSecretBox.ts module and SMTP_CREDENTIAL_ENCRYPTION_KEY — one
  // password shared by both SMTP and IMAP, per this table's own doc comment.
  encryptedPassword: text("encrypted_password"),
  // IMAP's own incremental-sync cursor pair — the IMAP equivalent of
  // historyId above. UIDVALIDITY changing means every previously-seen UID
  // is no longer a valid reference (RFC 3501 §2.3.1.1); imapSync.ts treats
  // that as a signal to re-baseline, same shape as Gmail's history-expired
  // handling. lastSeenUid is the last UID actually processed — the next
  // sync pass fetches only messages with a higher UID.
  imapUidValidity: text("imap_uid_validity"),
  imapLastSeenUid: text("imap_last_seen_uid"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Global (not per-company) + case-insensitive + partial: a given mailbox
  // can only have ONE non-disconnected connection anywhere in the system —
  // the exact "one company per Gmail address" requirement — while still
  // letting the SAME company connect many different addresses (nothing
  // here constrains companyId) and letting a disconnected address be
  // reconnected later (by the same or a different company) without a
  // leftover DISCONNECTED row blocking it, since the index only covers
  // live/pending/reauth-needed rows. lower(...) is the hard, DB-level
  // case-insensitivity guarantee — not just an application convention — so
  // "Sales@x.com" and "sales@x.com" can never both be active at once even
  // if some future write path forgets to normalize first.
  uniqueIndex("company_email_accounts_active_address_idx")
    .on(sql`lower(${t.emailAddress})`)
    .where(sql`${t.status} <> 'DISCONNECTED'`),
  index("company_email_accounts_company_id_idx").on(t.companyId),
]);

export const conversations = pgTable("conversations", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  // EMAIL | WHATSAPP | SOCIAL
  channel: text("channel").notNull(),
  externalThreadId: text("external_thread_id"),
  subject: text("subject"),
  // The external participant's profile picture (e.g. Metricool's
  // MetricoolParticipant.imageProfileUrl) — null when unavailable (direct
  // Meta webhook rows never set this; Metricool rows get it from
  // syncMetricoolConversations). Never the connected brand's own picture.
  // Confirmed live (see services/avatarCapture.ts) that this signed URL is
  // only downloadable for a short window after a message arrives — this
  // column is kept purely as the raw/diagnostic value and as the frontend's
  // fallback source; customerAvatarKey below is what's actually displayed
  // once avatar storage has captured a permanent copy.
  customerAvatarUrl: text("customer_avatar_url"),
  // Object key of a permanently-stored copy of the customer's picture (see
  // avatarStorage.ts/avatarCapture.ts) — null until successfully captured.
  // Additive and independent of customerAvatarUrl above: never backfilled
  // for historical rows (their source URL is already dead by the time this
  // feature exists), only ever set going forward for new inbound messages.
  customerAvatarKey: text("customer_avatar_key"),
  // A freshly-seen, not-yet-captured avatar URL awaiting a download attempt
  // — written synchronously (cheap) the moment a new message is detected,
  // so the actual download/upload (which can fail or take a moment) has a
  // durable trigger that survives a process restart between ticks, instead
  // of only living in an in-memory fire-and-forget promise. Cleared once
  // either customerAvatarKey is set (success) or the capture is abandoned
  // (see shouldAbandonPendingCapture in avatarCapture.ts).
  customerAvatarPendingUrl: text("customer_avatar_pending_url"),
  // How many download attempts customerAvatarPendingUrl has already had —
  // bounds retries so a dead URL isn't attempted forever (see
  // shouldAbandonPendingCapture).
  customerAvatarCaptureAttempts: integer("customer_avatar_capture_attempts").notNull().default(0),
  // When customerAvatarPendingUrl was first queued — the time-based half of
  // the retry cap (see shouldAbandonPendingCapture): a crash-and-retry on
  // the next tick is useful, but retrying minutes later against a URL
  // that's almost certainly already expired (per the live timing test) is
  // not, so this bounds how long we keep trying regardless of attempt count.
  customerAvatarCaptureFirstSeenAt: timestamp("customer_avatar_capture_first_seen_at", { withTimezone: true }),
  assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  // Which connected account (and therefore which provider — Meta's direct
  // Graph API vs. Metricool — see company_social_accounts.platform below)
  // this SOCIAL conversation came from. Null for existing conversations
  // created before this column existed (legacy rows keep working — reply
  // logic falls back to the direct Meta provider when this is null).
  companySocialAccountId: uuid("company_social_account_id").references(() => companySocialAccounts.id, {
    onDelete: "set null",
  }),
  // Which connected Whapi channel this WHATSAPP conversation came from — the
  // WhatsApp equivalent of companySocialAccountId above. A separate column
  // (not a reuse of companySocialAccountId) because whapi_channels stores a
  // genuine secret (the channel's own token) and deserves its own table
  // rather than overloading company_social_accounts, which only ever held
  // plain, non-secret external ids.
  whapiChannelId: uuid("whapi_channel_id").references(() => whapiChannels.id, { onDelete: "set null" }),
  // Which connected mailbox this EMAIL conversation came from/replies go out
  // through — the email equivalent of whapiChannelId above, same reasoning
  // (a distinct per-connection secret deserves its own table, not reuse of
  // companySocialAccounts). Needed specifically because a company can have
  // MULTIPLE connected mailboxes (see companyEmailAccounts' doc comment) —
  // without this, a reply would have no way to know which of a company's
  // several connected addresses it should be sent from. Null for existing
  // EMAIL conversations created before this column existed (legacy rows —
  // today's single-global-sender Resend path is the fallback when null).
  companyEmailAccountId: uuid("company_email_account_id").references(() => companyEmailAccounts.id, {
    onDelete: "set null",
  }),
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
 * Facebook Page/Instagram account (no UI for that yet, see guide).
 *
 * Also doubles as the account mapping for the Metricool integration (one
 * shared Metricool account managing every company's Instagram/Facebook —
 * see src/server/integrations/metricool.ts): for those rows, externalPageId
 * holds the Metricool `blogId` for that company's connected brand, not a
 * Meta Page ID. */
export const companySocialAccounts = pgTable("company_social_accounts", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // META_PAGE | META_INSTAGRAM | METRICOOL_INSTAGRAM | METRICOOL_FACEBOOK
  platform: text("platform").notNull(),
  externalPageId: text("external_page_id").notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("company_social_accounts_platform_page_idx").on(t.platform, t.externalPageId),
]);

/** One Whapi.Cloud channel (= one WhatsApp number) per company, provisioned
 * on demand from Configuración (see server/services/whapiOnboarding.ts).
 *
 * status is a state machine, never re-created: PENDING -> ACTIVE | FAILED |
 * FAILED_NEEDS_MANUAL_CHECK. The row is inserted as PENDING *before* the
 * paid Whapi create-channel call is made — the unique index on companyId
 * below is what makes a double-click, a slow request retried by the
 * browser, or two concurrent Superusers physically unable to create two
 * paid channels for the same company: the second INSERT attempt fails with
 * a unique violation and is turned into "already provisioning", never a
 * second Whapi API call. FAILED_NEEDS_MANUAL_CHECK is distinct from FAILED:
 * it's used when the create call failed ambiguously (timeout/5xx, so it's
 * unknown whether Whapi actually created a paid channel before the response
 * was lost) — retrying automatically from that state is never offered; a
 * Superuser must confirm via the Whapi partner dashboard first (same
 * non-idempotent-send caution already applied to Metricool's sendMessage
 * retry policy in integrations/metricool.ts).
 *
 * encryptedToken is this channel's own bearer token (returned once by
 * Whapi's create-channel response) — unlike Metricool's single shared
 * account token, every company's Whapi channel has a *different* secret,
 * so (unlike company_social_accounts.externalPageId, which is never a
 * secret) this needs real encryption at rest, not a plain column. See
 * server/crypto/secretBox.ts for the AES-256-GCM scheme and
 * WHAPI_TOKEN_ENCRYPTION_KEY.
 *
 * encryptedWebhookSecret is a value *we* generate (never Whapi), registered
 * with Whapi as a custom callback header (see "Customizable Webhook
 * Headers" in Whapi's docs) because Whapi's webhooks carry no native
 * signature — this is the compensating control the inbound webhook route
 * checks on every request. Encrypted at rest for the same reason as the
 * channel token. */
export const whapiChannels = pgTable("whapi_channels", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("PENDING"),
  // Whapi's own channel id — null until the create call succeeds.
  channelId: text("channel_id"),
  // This channel's own API base url, returned in the create response —
  // channel-scoped calls (QR, send, settings) go to this host, not the
  // shared manager.whapi.cloud used only for Partner-token create/manage calls.
  apiUrl: text("api_url"),
  encryptedToken: text("encrypted_token"),
  encryptedWebhookSecret: text("encrypted_webhook_secret"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("whapi_channels_company_id_idx").on(t.companyId),
  uniqueIndex("whapi_channels_channel_id_idx").on(t.channelId),
]);

/** Durable staging area for inbound Whapi webhook deliveries — mirrors the
 * pending-capture pattern in services/avatarCapture.ts: the webhook route's
 * ONLY job is to authenticate the request and INSERT a raw event here as
 * fast as possible, before any attempt to turn it into a conversation/
 * message. That insert surviving is what makes a transient failure further
 * down the pipeline (a DB hiccup, a bug, a timeout) something that can be
 * retried on the next processing pass instead of a silently lost message —
 * the event already exists in Postgres by the time the webhook responds.
 *
 * The unique index on (whapiChannelId, externalMessageId) is the first line
 * of idempotency: Whapi redelivering the same webhook (its own retry, or a
 * duplicate network delivery) is a harmless no-op insert, never a second
 * row — defense in depth alongside the messages.metadata.externalId dedupe
 * applied when an event is actually turned into a message (same two-layer
 * approach already proven for Metricool's sync in services/social.ts). */
export const whapiInboundEvents = pgTable("whapi_inbound_events", {
  id: id(),
  whapiChannelId: uuid("whapi_channel_id").notNull().references(() => whapiChannels.id, { onDelete: "cascade" }),
  externalMessageId: text("external_message_id").notNull(),
  rawPayload: jsonb("raw_payload").notNull(),
  // PENDING -> PROCESSED | ABANDONED
  status: text("status").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  receivedAt: createdAt(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("whapi_inbound_events_channel_message_idx").on(t.whapiChannelId, t.externalMessageId),
  index("whapi_inbound_events_status_idx").on(t.status),
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
