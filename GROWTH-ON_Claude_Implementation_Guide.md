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

# 13. Phase 8 — Prospecting

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

---

# 14. AI Prospecting Architecture

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

---

# 15. AI CRM Analysis

After the CRM and timeline are real, add contact-level AI analysis.

The model may analyze:

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

## Important Safety/Product Rule

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

---

# 16. Claude as Developer vs Claude as Product AI

Do not confuse these two roles.

## Claude/Claude Code as Developer

Used during development to:

- inspect repository
- write/refactor code
- create migrations
- build APIs
- add integrations
- test/debug the application

## Claude API as CRM Feature

Potentially used inside the production CRM to:

- score leads
- classify contact intent
- suggest pipeline stage
- recommend next action
- summarize interactions

These are separate responsibilities.

Using Claude Code to build the CRM does **not** automatically mean the production CRM must use Anthropic's API. The production AI provider should remain configurable where practical.

---

# 17. Phase 9 — Zadarma Calls

Implement Zadarma only after Contacts, Activities, and Follow-Ups are stable.

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

---

# 18. Email and Social Integrations

## Email

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

## Meta / Social

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

---

# 19. KPIs

Replace static KPI values with real database aggregations.

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

---

# 20. Support Module

Implement real support ticket persistence.

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

---

# 21. Testing Requirements

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
- AI output validation
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

# 22. Recommended Execution Order

Use this order unless the product owner explicitly changes priorities:

```text
CURRENT STATE
Frontend + Mock Data
        │
        ▼
1. Audit Existing Implementation
        │
        ▼
2. Finish App Shell / Top Company Selector
        │
        ▼
3. Database Schema
        │
        ▼
4. Authentication
        │
        ▼
5. Roles + Multi-Company Permissions
        │
        ▼
6. Contacts CRUD
        │
        ▼
7. Activity Timeline
        │
        ▼
8. Pipeline
        │
        ▼
9. Tasks + Follow-Ups
        │
        ▼
10. Campaigns
        │
        ▼
11. Prospecting Data Provider
        │
        ▼
12. AI Lead Scoring
        │
        ▼
13. Contact AI Analysis
        │
        ▼
14. Zadarma Calls
        │
        ▼
15. Email / Social
        │
        ▼
16. KPI Real Data
        │
        ▼
17. Support
        │
        ▼
18. Security / Tests / Production Hardening
        │
        ▼
19. Advanced AI Agent — only if still required
```

---

# 23. What Not to Build Yet

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

But this should be built only after the CRM's database, security, audit history, and business workflows are stable.

---

# 24. Immediate Next Task for Claude

Start with the following task:

> Audit the current GROWTH-ON repository and the in-progress multi-company implementation. Do not rebuild or redesign the application. Identify the remaining mock-data dependencies, current CompanyContext usage, and any partial company filtering already implemented in CRM and Support. Then design the real database + authentication + tenant-aware CRM foundation. Preserve the existing UI and component system. Before making large structural changes, provide a concise implementation plan and identify any business decisions that require product-owner input.

After the audit, the first real implementation milestone should be:

```text
Company
+
User
+
Role/Access
+
Contact
+
Activity
+
Pipeline
```

with real persistence and server-side authorization.

---

# 25. Definition of Success for the Foundation

The foundation is considered ready for later AI/integrations when all of the following are true:

- users authenticate securely
- users only access permitted companies
- active company selection filters real backend data
- contacts are stored in the real database
- CRM history is append-only through Activities
- pipeline stages are stored and referenced cleanly
- tasks/follow-ups persist
- campaigns persist
- mock data is no longer the source of truth for core CRM operations
- permissions are enforced server-side
- critical workflows have tests

Only after this foundation is stable should advanced AI prospecting and autonomous automation become a priority.
