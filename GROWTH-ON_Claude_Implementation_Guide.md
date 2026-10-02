# GROWTH-ON CRM — Claude Implementation Guide

## Purpose

This document is the implementation handoff for Claude/Claude Code.

The current GROWTH-ON project already has a strong frontend foundation. The next goal is to convert the existing mock-data-based application into a real, secure, multi-company CRM without rebuilding or replacing the current visual design.

Claude should act as a **developer and technical implementation assistant**, not as the product owner. Business rules, provider choices, credentials, and final workflow approvals remain manual decisions.

---

# 1. Current Project State

## Tech Stack

- Next.js 16 — App Router
- React 19
- Tailwind CSS v4
- Spanish-first CRM/dashboard UI
- Current data source: `src/lib/mock-data.ts`
- No production backend yet

## Existing Main Routes

Inside the `(dashboard)` route group:

- `/crm`
- `/prospeccion`
- `/campanas`
- `/campanas-activas`
- `/canales/correo`
- `/canales/llamadas`
- `/canales/redes-sociales`
- WhatsApp route/code may remain, but its sidebar item should stay hidden until the channel is ready
- `/kpis`
- `/configuracion`
- `/soporte`

## Existing Shared UI

`src/components/ui/` includes reusable components such as:

- Button
- Card
- Badge
- Avatar
- Input

Additional shared components include:

- Sidebar
- PageHeader
- StatCard
- StageBadge
- LanguageSwitcher
- ColorThemeSwitcher
- DesignSystemSwitcher
- CompanySwitcher

## Existing Contexts

- `ThemeContext`
- `LanguageContext`
- `CompanyContext`

The current `CompanyContext`:

- provides the company list
- tracks `activeCompany`
- exposes `setActiveCompany`
- persists the selected company to localStorage
- currently reads companies from mock data

## Current Multi-Company Work

The project is currently in the middle of adding multi-company support.

Existing work includes:

- `src/context/CompanyContext.tsx`
- `src/components/CompanySwitcher.tsx`
- Company switcher integration in `Sidebar.tsx`
- `CompanyProvider` in `(dashboard)/layout.tsx`
- early company-filtering work in CRM and Support pages

This is a good frontend foundation, but it is currently only UI-level filtering. It must later be enforced at the backend/database layer.

---

# 2. Important Product Rules

## 2.1 Preserve the Existing Product

Do **not**:

- rebuild the application from scratch
- replace the current visual design unless explicitly requested
- remove existing routes without a clear migration reason
- replace working shared components unnecessarily
- create a second parallel CRM architecture
- hardcode business data into components when it belongs in the database

Prefer additive, incremental implementation.

---

## 2.2 Global Company Selector

The company selector is global application context.

The primary company selector should be visible in the **top application bar** after login.

The sidebar footer may continue showing the active company as secondary information, but the main selector should not depend on opening the profile/footer area.

The selected company should persist while the user moves between modules.

Expected behavior:

- `Todas` = show all companies the logged-in user is permitted to access
- specific company = filter company-aware operational data to that company

The frontend selection is **not a security boundary**.

Every protected backend query must independently verify that the logged-in user has access to the requested company.

---

## 2.3 WhatsApp

Keep WhatsApp architecture/routes/database support if already present.

Do not delete the feature.

However, keep the WhatsApp sidebar/navigation entry hidden until the channel is officially enabled.

Visible channel navigation should currently focus on:

- Correo
- Llamadas
- Redes sociales

---

# 3. Development Strategy

Do not jump directly into a full autonomous AI agent.

The recommended order is:

1. finish the app shell
2. create the real database schema
3. add authentication
4. implement role-based and company-based access
5. make Contacts/CRM real
6. implement the append-only Activity Timeline
7. implement Pipeline
8. implement Tasks and Follow-ups
9. implement Campaigns
10. implement Prospecting
11. add AI Lead Scoring
12. integrate Zadarma Calls
13. integrate Email/Social channels
14. replace KPI mock data with real aggregations
15. complete Support functionality
16. only then consider a more autonomous AI agent

> **Superseded by §13 "Development Approach Update (2026-10-01)" below.** Steps 10–11 (Prospecting, AI Lead Scoring) are deferred until all other non-AI CRM work is complete. See §22 for the current execution order.

---

# 4. Claude vs Manual Responsibilities

## Claude Should Handle

Claude/Claude Code may perform:

- repository audit
- architecture review
- database schema design
- migrations
- backend/API/service implementation
- replacing mock data with real queries
- CRUD implementation
- role/access enforcement
- multi-company filtering
- activity timeline logic
- pipeline logic
- task/follow-up logic
- campaign functionality
- external API wrappers
- AI integration code
- structured AI prompt/output schemas
- validation
- error handling
- retries where appropriate
- tests
- refactoring
- bug fixing
- implementation documentation

## Manual/Product-Owner Decisions

Do not guess these without explicit requirements:

- which database/provider to use
- which authentication provider to use
- final role permissions
- which companies each user can access
- exact KPI definitions/formulas
- which lead-data provider to use
- which AI provider/model to use
- production credentials
- API keys and secrets
- Zadarma account/SIP mappings
- email provider/domain setup
- Meta developer app configuration
- DNS settings
- final UX/business-rule approval
- real-world acceptance testing

---

# 5. Phase 1 — Audit and Close the Frontend Foundation

Before changing architecture, audit the current repository.

Claude should identify:

- current routes
- current mock-data dependencies
- where `CompanyContext` is already used
- duplicated state/business logic
- reusable components that already exist
- any pages partially prepared for backend integration
- any route or component that conflicts with the intended CRM architecture

### Required Output Before Major Changes

Produce a concise implementation report containing:

- what is already complete
- what is partial
- what is missing
- what should be preserved
- what should be refactored
- proposed implementation sequence

Do not make broad destructive changes before this audit.

---

# 6. Phase 2 — Database Architecture

Move the project from:

```text
UI
↓
mock-data.ts
```

into:

```text
UI
↓
Server/API/Service Layer
↓
Database
```

Recommended core entities:

```text
companies
users
roles
user_company_access
user_module_access

contacts
activities
tasks

pipelines
pipeline_stages

campaigns
campaign_members

conversations
messages

calls

tickets
ticket_messages
```

Additional entities may be added if justified, but avoid unnecessary complexity.

---

# 7. Phase 3 — Authentication and Multi-Company Security

The current `CompanyContext` is only frontend state.

Final flow must become:

```text
Authenticated User
      ↓
Resolve User Role + Allowed Companies
      ↓
Select active company in UI
      ↓
Backend validates requested company access
      ↓
Query only permitted company data
```

Example:

```text
User: David
Allowed Companies:
- Contact-On
- Leyva

Not Allowed:
- Rockstar
```

If David manually calls an API endpoint for Rockstar, the backend must reject the request even if the frontend UI normally hides that data.

### Important

Do not trust:

- client-side route params
- localStorage
- CompanyContext
- frontend filtering

for authorization.

Authorization must happen server-side.

---

# 8. Phase 4 — Real CRM Contacts

Before AI prospecting, make the core CRM functional.

## Contact List

Support:

- search
- company filter
- stage filter
- assigned-agent filter

## Contact Record

Recommended fields:

```text
id
companyId
name
businessName
phone
email
assignedUserId
leadSource
pipelineStageId
lastContactAt
nextAction
followUpAt
createdAt
updatedAt
```

Additional business fields may be added only when justified.

## Contact Actions

Implement:

- create contact
- edit contact
- import contacts from CSV/Excel
- select contact
- update assigned agent
- update lifecycle stage
- update next action
- schedule follow-up

---

# 9. Activity Timeline — Critical CRM Backbone

Treat CRM history as append-only operational history.

Recommended `activities` structure:

```text
id
companyId
contactId
type
channel
outcome
notes
createdBy
createdAt
metadata
```

Possible activity types:

```text
CALL
EMAIL
SOCIAL
NOTE
TASK
STATUS_CHANGE
AI_CLASSIFICATION
```

Do not overwrite history when a new interaction occurs.

Example:

```text
Contact: Juan Martinez

28 Sep — CALL
Outcome: Interested
Notes: Asked for pricing

28 Sep — TASK
Follow up Friday

29 Sep — EMAIL
Pricing sent
```

The timeline must remain understandable even when multiple agents and channels are involved.

---

# 10. Phase 5 — Sales Pipeline

Use the standard seven-stage lifecycle:

```text
NUEVO LEAD
CONTACTADO
INTERESADO
OPORTUNIDAD
PEDIDO EN CURSO
CLIENTE
SEGUIMIENTO
```

Do not scatter these strings across components.

Prefer a real `pipeline_stages` table such as:

```text
id
pipelineId
name
position
isActive
```

Contacts should reference a stage through an ID, for example:

```text
pipelineStageId
```

This allows future editing/reordering without rewriting UI logic.

Initial version may use one global default pipeline unless requirements specify company-specific pipelines.

---

# 11. Phase 6 — Tasks and Follow-Ups

A contact classification/action may need to update more than one record.

Example:

```text
Outcome: Interested
Next Action: Call again
Follow-Up: 02 Oct 2026
```

The backend may need to:

```text
1. update the Contact
2. append an Activity
3. optionally create a Task
```

Implement this in a controlled service/transaction flow where possible.

Recommended task fields:

```text
id
companyId
contactId
title
assignedUserId
priority
dueAt
status
createdBy
createdAt
completedAt
```

---

# 12. Phase 7 — Campaigns

Implement campaign persistence before advanced AI prospecting.

Recommended campaign data:

```text
Campaign
- id
- companyId
- name
- objective
- ownerId
- status
- createdAt
```

Recommended member relationship:

```text
CampaignMember
- id
- campaignId
- contactId or prospectId
- assignedAgentId
- status
- createdAt
```

Expected flow:

```text
Campaign
   ↓
Leads/Prospects
   ↓
Assign Agents
   ↓
Send/Create CRM Contacts
   ↓
Calls / Emails / Social
   ↓
Results
```

---

# 13. Development Approach Update (2026-10-01)

**This section overrides any conflicting ordering in §3 and the original §22 execution order below it.**

Decision, as directed by the product owner:

- No AI lead generation, AI prospecting, or external lead-data provider/API (Google Places, Apollo, Clearbit, scraping, or any other provider) until explicitly reopened.
- No AI lead scoring or AI CRM analysis until explicitly reopened.
- Leads/contacts continue to be added **manually** through the existing CRM functionality for the duration of this period. This must keep working without interruption or removal.
- Do not redesign the existing database/service/repository architecture to "prepare" for AI. The schema already reserves tables for the later phase (`prospect_leads`, `campaign_members`, `ai_analysis`) — leave them in place, unused, until reopened.
- Priority is making the **entire CRM fully functional and stable first**: Contacts, Activities, Pipeline, Tasks, Campaigns, Users, Companies, Permissions, Support, KPIs, and the Email/Calls/Social channels.
- Only after the core CRM is stable does work resume on Prospecting and AI (§19, final phase), at which point the lead-data provider and AI provider are chosen explicitly with the product owner.
- Any AI-related product decision (data provider, AI provider, scoring formula, qualification rules, etc.) requires explicit product-owner sign-off before implementation — Claude must stop and ask rather than guess.

New development order (detailed per-phase breakdown in §14–§19, full table in §22):

```text
1–10 (unchanged, already implemented — see §5–§12 above)        — done
        │
        ▼
11. Finish Support Module                                       — done
        │
        ▼
12. Finish KPIs with Real Data                                   — done
        │
        ▼
13. Finish Channels — Email, Calls (Zadarma), Social, WhatsApp    — done (see §16 for scope)
        │
        ▼
14. Finish remaining Campaigns UI (non-AI parts only — see §17)  — done (Option B)
        │
        ▼
15. Testing + Production Hardening
        │
        ▼
16. FINAL PHASE — Prospecting + AI Lead Scoring + AI CRM Analysis (§19)
```

---

# 14. Phase 11 — Support Module — ✅ DONE (2026-10-01)

Built: `src/server/repositories/tickets.ts` + `ticketMessages.ts`, `src/server/services/tickets.ts`, `soporte/actions.ts`, `SoporteClient.tsx`. Real ticket creation, status updates, assignee, and threaded replies — verified end-to-end against the live database.

No external dependency — this is pure CRUD against tables that already exist in the schema (`tickets`, `ticket_messages`). Good candidate to build right after Campaigns.

Recommended flow:

```text
Create Ticket
↓
Select Company + Priority
↓
Enter Subject + Description
↓
Create Sequential Ticket Number
↓
Display Ticket in Queue
↓
Append Replies to Thread
↓
Update Status
```

Suggested statuses:

```text
OPEN
IN_PROCESS
RESOLVED
CLOSED
```

`src/app/(dashboard)/soporte/page.tsx` currently reads `tickets` from mock data — needs a `src/server/repositories/tickets.ts` + `src/server/services/tickets.ts` pair, following the same pattern as `contacts`/`tasks`/`campaigns`.

---

# 15. Phase 12 — KPIs with Real Data — ✅ DONE (2026-10-01)

Built: `src/server/services/kpis.ts` aggregating real Contacts/Activities data; `KpisClient.tsx` with real headline stats, both conversion rates (leads→customers and opportunities→customers, per product-owner decision), a real 6-month trend chart, a real per-agent performance table, and working CSV export. Formulas locked in with the product owner first (see decisions below) rather than guessed.

Replace static KPI values with real database aggregations once the modules feeding them (Contacts, Activities, Pipeline, Tasks, Campaigns, Support, Calls) have real data to aggregate. Best done after those modules, not before.

Examples:

## Commercial

- leads worked
- opportunities
- customers/sales
- conversion rate
- monthly lead-to-customer trend
- agent performance

## Contact Center

- calls made
- answered/contacted calls
- average talk time
- pending follow-ups
- agent call effectiveness

## Customer Support

- open tickets
- managed tickets
- response time
- resolution rate
- priority breakdown

## Tasks

- assigned tasks
- completed tasks
- overdue tasks
- completion rate

Do not invent KPI formulas.

The product owner must define ambiguous formulas before implementation.

Example question that requires manual confirmation:

```text
Conversion Rate = Customers / Leads ?
```

or

```text
Conversion Rate = Orders + Customers / Leads ?
```

`src/app/(dashboard)/kpis/page.tsx` currently reads `kpiStats, agentPerformance` from mock data.

---

# 16. Phase 13 — Channels: Email, Calls (Zadarma), Social, WhatsApp — ✅ Calls/Email/Social DONE (2026-10-02), WhatsApp still hidden

These are **not AI features**, but they do require external provider accounts/credentials — similar manual-setup burden to the deferred lead-data provider, just not deferred because the product owner wants this functionality now. Sequence this after Support/KPIs since it is the heaviest lift (external integrations) among the remaining non-AI work.

**Status:** all three channels below are built, type-checked, lint-clean, and verified end-to-end against the live database (including two real bugs caught and fixed: a stale-client-state bug after linking a social conversation to a contact, and the auth middleware blocking the Meta webhook route). None has been exercised against a *live* provider account yet — every outbound call fails cleanly with a "not configured" message until real credentials (Zadarma/Resend/Meta) are added to the environment. That's the explicit scope the product owner approved: scaffold the architecture now, wire in real credentials later.

Schema already has `conversations`, `messages`, and `calls` tables ready; `company_social_accounts` was added (migration `0003`) to map a connected Meta Page to a company. Repositories/services now exist for all of them.

## Calls (Zadarma) — ✅ DONE

Built: `src/server/integrations/zadarma.ts` (signed callback-request wrapper per Zadarma's documented REST API — not yet verified against a live account), `src/server/repositories/calls.ts`, `src/server/services/calls.ts`, `canales/llamadas` rebuilt on real contact/call/activity data. Logging a call result reuses the existing `moveContactStage` rather than duplicating that transaction.

Implement Zadarma only after Contacts, Activities, and Follow-Ups are stable (they already are).

Target flow:

```text
Contact
↓
Click Phone Number
↓
Start Secure Zadarma Call
↓
Embedded WebRTC Dialer
↓
Call Completes
↓
Save Call Result
↓
CallActivity / Activity Timeline
↓
Optional Follow-Up Task
```

Claude may implement:

- Zadarma API wrapper
- WebRTC UI integration
- click-to-call
- call history synchronization
- webhook handling
- recording metadata
- CRM timeline integration

Manual setup will be required for:

- Zadarma account
- API credentials
- SIP extensions
- webhook configuration

Secrets must remain server-side.

## Email — ✅ DONE (outbound only)

Built: `src/server/integrations/email.ts` (Resend — chosen as a reasonable default since the project deploys on Railway, not Vercel, so the Vercel Marketplace provider flow didn't apply; isolated in one file so it's swappable), `src/server/services/email.ts`, `canales/correo` rebuilt on real contacts/conversations/messages. Outbound send/reply only — there's no inbound-receiving mechanism (webhook or IMAP) scaffolded for email, unlike Social where Meta's webhook model made inbound the natural starting point.

Claude may implement:

- provider wrapper
- send/reply functionality
- thread persistence
- templates
- contact matching
- activity timeline entries

Manual work may include:

- provider account
- SMTP/API key
- sending-domain verification
- DNS records

## Meta / Social — ✅ DONE

Built: `src/server/integrations/meta.ts` (webhook challenge verification + `X-Hub-Signature-256` check + Graph API send, per Meta's documented API — not yet verified against a live app), `src/app/api/webhooks/meta/route.ts` (real GET/POST handlers), `src/server/services/social.ts` (including the "contact association" step — linking an inbound conversation to a CRM contact), `canales/redes-sociales` rebuilt on real data. The full inbound pipeline (page→company resolution, thread dedup) was verified by invoking the ingestion service directly, since no live Meta app exists yet to send a real webhook call.

Claude may implement:

- webhook handlers
- conversation storage
- message UI
- reply API
- contact association

Manual setup may include:

- Meta Developer App
- Facebook Page / Instagram connection
- permissions
- access tokens
- webhook verification

## WhatsApp — not started, stays hidden

Keep hidden in navigation (per §2.3) until explicitly enabled by the product owner, even once the underlying `conversations`/`messages` plumbing is shared with Email/Social. `src/app/(dashboard)/canales/whatsapp/page.tsx` still reads from mock data — intentionally untouched.

`correo`, `llamadas`, and `redes-sociales` no longer read from mock data.

---

# 17. Remaining Campaigns Work (non-AI only) — ✅ DONE (2026-10-02), Option B

Product owner chose **Option B**: a simpler non-AI version, deferring `prospect_leads`/`campaign_members` wiring to §19.

Campaigns list/create/status-update already worked against the real database. Built on top of that:

- **Schema**: new `campaign_contacts` table (migration `0004`) — a plain campaign↔contact join, deliberately separate from `campaign_members` (which still requires a `prospect_lead_id` and stays reserved for §19's AI pipeline, untouched).
- **Import members**: reuses the exact CSV parsing/preview flow from the CRM contacts import — extracted into a shared `src/lib/contactsImport.ts` (both `CrmClient.tsx` and `CampanasClient.tsx` now import from there, no duplicated logic) — imported contacts land in the pipeline's entry stage and are linked to the selected campaign via `campaign_contacts`.
- **Campaign members table**: replaces the old mock "Client Prospecting" table — lists real contacts linked to the selected campaign (name, assigned agent, channels used, pipeline stage, last contact).
- **Filters**: Channel and Agent checkboxes are populated from *real* data — channel options come from each member's actually-logged `activities.channel` values (not an invented per-row field), agent options from `assignedUserName`. Status filter lists the real stage keys present among current members.
- **Stat cards**: real aggregates (total contacts, contacted, customers, opportunities) per allowed company — `src/server/services/campaigns.ts`'s `getCampaignPageStats()` — filtered client-side by the top-right company selector, same convention as every other migrated page (Kpis/Soporte/Llamadas/Correo/RedesSociales).
- Selecting a campaign (click its row in the existing Campaigns list) drives which campaign the import/members/filters panels operate on.

Verified end-to-end against the live database: created a campaign, imported a 3-row CSV (2 valid + 1 correctly skipped for a missing name), confirmed the new contacts and `campaign_contacts` rows in the database directly, confirmed the stat cards/members table/filters all updated with real data and no console errors.

---

# 18. Phase 14 — Testing + Production Hardening

Claude should add automated tests where they provide real value.

Recommended coverage:

- authentication
- company authorization
- role permissions
- contacts CRUD
- activity creation
- pipeline updates
- task/follow-up creation
- duplicate lead handling
- campaign membership
- ticket/support workflows
- channel message persistence
- protected integration endpoints

Manual end-to-end acceptance testing is still required.

Example real workflow:

```text
Login as Agent
→ select allowed company
→ create/select lead
→ update stage
→ log interaction
→ create follow-up
→ verify timeline
→ verify manager KPI reflects activity
```

---

# 19. FINAL PHASE — Prospecting and AI (deferred)

**Do not start this section.** Per §13, this phase is deferred until the product owner explicitly reopens it, which will happen only after §14–§18 are complete and the core CRM is stable and production-ready. Kept here so the architecture is not forgotten or re-designed from scratch later.

## 19.1 Prospecting Data Provider

The prospecting page should eventually stop using mock lead results.

Target flow:

```text
User defines campaign + search criteria
        ↓
POST /api/prospecting/search
        ↓
Real Lead/Data Provider
        ↓
Raw Companies/Prospects
        ↓
AI Qualification
        ↓
Prospect Results Table
        ↓
Human Review
        ↓
Send selected leads to CRM
```

Example prospecting form:

```text
Campaign Name: Madrid Dentists
Company: Leyva
Target: Dental clinics in Madrid
Maximum Leads: 50
```

Example result:

```text
Company          City       AI Affinity
ABC Dental       Madrid     93%
Smile Pro        Madrid     86%
XYZ Dental       Madrid     70%
```

Then allow:

```text
[Select Leads]
[Send Selected to CRM]
```

Before creating CRM contacts, check duplicates using stable identifiers such as:

- email
- phone
- provider external ID
- website/domain where useful

Do not rely only on company name matching.

Which lead-data provider to use (Google Places, Apollo, Clearbit, or another) is a product-owner decision made at the time this phase reopens — not before.

## 19.2 AI Prospecting Architecture

Do not treat the AI model as the source of truth for real companies.

Preferred architecture:

```text
Lead/Data Provider
      ↓
Real Prospect Records
      ↓
AI Model
      ↓
Score / Qualify / Categorize
      ↓
Human Review
      ↓
CRM
```

The AI model should mainly help with:

- affinity scoring
- qualification
- priority
- fit explanation
- recommended next action

Example structured result:

```json
{
  "score": 89,
  "priority": "HIGH",
  "qualification": "GOOD_FIT",
  "reason": "Matches the requested industry and location.",
  "recommendedAction": "Review and add to campaign"
}
```

Validate all model output before saving it.

## 19.3 AI CRM Analysis

After the CRM and timeline are real (they already are), contact-level AI analysis may be added. The model may analyze:

- contact profile
- recent activities
- call outcomes
- email/social interactions
- current stage
- follow-up history

Example result:

```text
Interest Score: 88%
Commercial Intent: High
Suggested Stage: OPORTUNIDAD
Priority: High
Recommended Action: Send proposal and follow up in 2 days
```

### Important Safety/Product Rule

AI should not directly modify core CRM state by default.

Use:

```text
AI suggests
↓
Agent reviews
↓
Agent clicks Apply
↓
Backend validates
↓
CRM updates
↓
Append AI_CLASSIFICATION activity
```

This should remain human-confirmed unless a later requirement explicitly authorizes automation.

## 19.4 Claude as Developer vs Claude as Product AI

Do not confuse these two roles.

### Claude/Claude Code as Developer

Used during development to:

- inspect repository
- write/refactor code
- create migrations
- build APIs
- add integrations
- test/debug the application

### Claude API as CRM Feature

Potentially used inside the production CRM to:

- score leads
- classify contact intent
- suggest pipeline stage
- recommend next action
- summarize interactions

These are separate responsibilities.

Using Claude Code to build the CRM does **not** automatically mean the production CRM must use Anthropic's API. The production AI provider should remain configurable where practical.

## 19.5 What Not to Build Yet

Do not start with a complex autonomous AI agent.

Initial AI architecture should be:

```text
Normal CRM Backend
+
Real Lead/Data API
+
AI API
```

not:

```text
Autonomous AI agent controlling the CRM
```

A more autonomous agent can be added later for workflows such as:

```text
Find leads
→ enrich data
→ analyze websites
→ score leads
→ detect duplicates
→ recommend campaign
→ suggest assignment
```

But this should be built only after the CRM's database, security, audit history, and business workflows are stable — and only when explicitly reopened per §13.

---

# 20. What Not to Build Yet (general)

Beyond §19.5, in general: do not invent fake AI data, fake external leads, or placeholder integrations presented as real. If a module cannot be completed without a manual decision (credentials, provider choice, formula), say so and stop rather than guessing.

---

# 21. Immediate Next Task for Claude

Per §13, the task is to complete the non-AI CRM modules in order:

```text
11. Support Module (§14)                                    — done
12. KPIs Real Data (§15)                                     — done
13. Channels — Email / Calls / Social / WhatsApp (§16)        — done (Calls/Email/Social; WhatsApp still hidden)
14. Remaining Campaigns UI (§17)                              — done (Option B)
15. Testing + Production Hardening (§18)
```

Next up is **§18** (Testing + Production Hardening) — the only remaining item before the core CRM meets the Definition of Success in §23.

Do not begin §19 (Prospecting/AI) until the product owner explicitly reopens it.

---

# 22. Recommended Execution Order

Use this order unless the product owner explicitly changes priorities. This supersedes the original top-to-bottom order in §3.

```text
CURRENT STATE
Frontend + Real Backend through Campaigns (Phases 1–10 complete)
        │
        ▼
1. Audit Existing Implementation                    — done
2. Finish App Shell / Top Company Selector            — done
3. Database Schema                                    — done
4. Authentication                                     — done
5. Roles + Multi-Company Permissions                  — done
6. Contacts CRUD                                       — done
7. Activity Timeline                                   — done
8. Pipeline                                            — done
9. Tasks + Follow-Ups                                  — done
10. Campaigns (core CRUD)                              — done
        │
        ▼
11. Support Module (§14)                                      — done
        │
        ▼
12. KPIs Real Data (§15)                                      — done
        │
        ▼
13. Channels — Email / Calls (Zadarma) / Social / WhatsApp (§16) — done (WhatsApp still hidden)
        │
        ▼
14. Remaining Campaigns UI (§17)                               — done (Option B)
        │
        ▼
15. Testing / Security / Production Hardening (§18)
        │
        ▼
16. FINAL — Prospecting Data Provider (§19.1)
        │
        ▼
17. FINAL — AI Lead Scoring (§19.2)
        │
        ▼
18. FINAL — AI CRM Analysis (§19.3)
        │
        ▼
19. Advanced AI Agent — only if still required (§19.5)
```

---

# 23. Definition of Success for the Core CRM (non-AI)

The core CRM is considered ready for the final Prospecting/AI phase when all of the following are true:

- users authenticate securely — done
- users only access permitted companies — done
- active company selection filters real backend data — done
- contacts are stored in the real database — done
- CRM history is append-only through Activities — done
- pipeline stages are stored and referenced cleanly — done
- tasks/follow-ups persist — done
- campaigns persist (core CRUD) — done
- support tickets persist and are workable end-to-end — done
- KPIs reflect real aggregated data, not mock values — done
- Email, Calls, and Social channels are built and verified against the real database — done; real provider credentials (Zadarma/Resend/Meta) still need to be added before any of the three can actually reach an external account
- remaining Campaigns UI (stats/import/filters) no longer reads mock data — done
- mock data (`src/lib/mock-data.ts`) is no longer the source of truth for any non-AI module except WhatsApp (intentionally untouched, stays hidden) — done
- permissions are enforced server-side — done
- critical workflows have tests — not started (§18, the only remaining item)

Only once all of the above are true should §19 (Prospecting/AI) be reopened.
