# CRM Hierarchy Redesign — Audit + Phased Plan

Status: **audit only, no code changed.** This document is the deliverable requested before any implementation starts.

---

## 0. Urgent finding — read this first

Your working tree already contains **uncommitted, unreviewed** changes that implement the
*company-level* Round Robin feature (new files `roundRobinCursors.ts`, `roundRobin.ts`,
migration `0005_solid_martin_li.sql`, plus edits to `schema.ts`, `constants.ts`,
`repositories/{activities,contacts,users}.ts`, `services/contacts.ts`, `CrmClient.tsx`).
`git log` shows **no commit history** for the two new files — this is in-flight work, not
something already shipped.

This matters directly to your question about conflicts, because **the conflict you asked me
to check for already exists in this uncommitted code**:

> `contactsService.importContacts()` now auto-assigns via the company-level Round Robin
> cursor, and `campaignsService.importCampaignMembers()` (the Manage Campaigns CSV import)
> calls that same `importContacts()`. So **today, campaign CSV imports already get
> auto-assigned to a random company agent on import** — not left unassigned.

Your stated preference ("campaign CSV import → leave unassigned, manager distributes
later") is **not yet true** even without any hierarchy work. This needs a decision before
Phase 1 (see §4).

I have not touched any of this code. Recommend you first decide whether to commit the
company-RR work as-is, then layer the hierarchy on top, or amend it in Phase 1.

---

## 1. Current role model (as it actually behaves in code)

`src/server/constants.ts`:
```
ROLE_KEYS = SUPERUSER | DIRECTOR | CALL_CENTER_LEAD | CALL_CENTER_AGENT | MARKETING
```

How access is actually enforced (`src/server/services/authorization.ts`):
- `assertCompanyAccess(companyId)` — SUPERUSER bypasses; everyone else must have a row in
  `user_company_access` for that company.
- `assertModuleAccess(module)` — same shape, via `user_module_access`.

**Key fact: `DIRECTOR` and `CALL_CENTER_LEAD` have zero special server-side behavior today.**
They are not distinguished from any other non-superuser role anywhere in the server code —
a Director is just "a user granted access to company X," identical in mechanism to a
Marketing user granted access to company X. There is no company→director ownership concept,
no manager/agent tree, no per-role filtering of contacts or campaigns. Everything you're
asking for (company-scoped director view, manager-scoped campaigns, manager→agent
assignment) is **net-new** — nothing here is a rename of existing logic.

`CALL_CENTER_LEAD` is referenced in exactly 3 places outside `constants.ts`, all cosmetic
(role label strings in `src/lib/roles.ts` and a description string in
`ConfiguracionClient.tsx`). **It is safe to reuse as "Call Center Manager" — just relabel
the display strings, keep the DB key `CALL_CENTER_LEAD` as-is** to avoid a data migration
and avoid touching the `roles` table's seeded row. Confirmed: no duplicate role needed.

## 2. Company permissions (`user_company_access`)

Simple many-to-many, `(userId, companyId)`. Superuser bypasses it. This is solid, minimal,
and **does not need to change** — it remains the right mechanism for "which companies can
this user touch at all." The new Director/Manager/Agent scoping is an *additional, narrower*
filter layered on top of this, not a replacement.

## 3. Campaigns — ownership today vs. what you want

`campaigns` table already has `ownerId` (nullable, `users.id`, `onDelete: set null`).

But as currently wired, `ownerId` is **not** an access-control field:
- Set once, at creation time, from a dropdown (`CampanasClient.tsx`) populated by
  `getAssignableUsersForCompany` → `findAssignableForCompany`, which returns **every**
  SUPERUSER plus **every** user with access to that company — not filtered by role. A
  Director, a Marketing user, or another manager can all be picked as "owner" today.
- There is **no "reassign owner" action** — once set, nothing in the UI or server can change
  it.
- `listCampaignsForCurrentUser()` returns **every campaign in every allowed company**,
  regardless of `ownerId`. The owner is purely a display label ("Owner: X") on the campaign
  card — it does not filter what anyone sees.

**Recommendation:** reuse `ownerId` as the "assigned manager" field rather than adding a new
column — it's already the right shape (nullable FK to `users`, one owner per campaign,
historical campaigns keep working with `ownerId = null` meaning "unassigned"). What's missing
is behavior, not schema:
1. A real `reassignCampaignManager` action, restricted to Director (own company only) /
   Superuser, that can change `ownerId` on an existing campaign.
2. The owner dropdown, when used for this purpose, must be filtered to users with role
   `CALL_CENTER_LEAD` in that company — not every assignable user.
3. `listCampaignsForCurrentUser()` needs a manager-scoped branch: if the caller's role is
   `CALL_CENTER_LEAD`, filter to `ownerId = caller.id`; Director/Superuser keep seeing
   everything in their allowed companies (unchanged).

No duplicate campaign records, no new table — confirmed this satisfies your constraint.

## 4. Lead/contact visibility — broader than you want, today

`contactsRepo.findManyByCompanyIds()` (used by `listContactsForCurrentUser`,
`getCampaignPageStats`, `activeCampaigns` service, etc.) returns **every contact in every
allowed company**, regardless of `assignedUserId`. So right now:

- A Call Center Agent with access to Company X sees **all** of Company X's leads, not just
  their own assigned ones.
- The "Assign Agent" dropdown (`findAssignableForCompany`) lists **every** user with company
  access — Directors, Marketing, other agents, everyone — as a valid assignee. There is no
  concept of "only agents," let alone "only agents under this manager."

This is the exact gap your spec calls out ("today company access may be broader than this").
Tightening it is a **real behavior change** for existing users, not a bug fix — must be done
deliberately, role-gated, and only for the roles you actually want narrowed (Agent; optionally
Manager), never silently.

## 5. Manager → Agent relationship

**Does not exist in any form.** No table, no column, nothing that lets you tell two
`CALL_CENTER_LEAD`s in the same company apart in terms of "whose agents are whose." Company
access alone is insufficient exactly as you suspected — it can't disambiguate when a company
has 4 managers.

**Smallest safe addition** (matches your proposed shape, and mirrors the existing
`user_company_access` junction-table pattern already in the schema):

```ts
export const managerAgentAssignments = pgTable("manager_agent_assignments", {
  id: id(),
  managerUserId: uuid("manager_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  agentUserId: uuid("agent_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
}, (t) => [
  // one active manager per agent per company — reassigning updates this row,
  // never deletes+recreates, so historical activity (createdBy on activities,
  // assignedUserId on contacts) is completely untouched by a manager change.
  uniqueIndex("manager_agent_company_idx").on(t.agentUserId, t.companyId),
  index("manager_agent_assignments_manager_idx").on(t.managerUserId),
]);
```

- One agent → one manager per company (unique on `agentUserId, companyId`) — "changing an
  agent's manager" becomes an `UPDATE`, not a delete/insert, so it never touches `contacts`,
  `activities`, or anything historical.
- `onDelete: "restrict"` on both FKs, matching the codebase's existing convention for
  "deactivate, never hard-delete" (`users.isActive`, no delete path on users anywhere).
- Cross-company is structurally impossible to misuse: every query that reads this table
  always also filters by the caller's authorized `companyId`, same pattern as every other
  repo in this codebase.
- Inactive agents stop being eligible automatically for the same reason company RR already
  does — eligibility queries join `users.isActive = true`, not a separate flag on this table.

This is additive only — zero existing tables change shape, zero existing queries change
behavior just by this table existing.

## 6. Existing company-level Round Robin (new-contact auto-assignment)

Audited in full (see §0). Mechanism, as currently drafted in your working tree:

- `company_round_robin_cursors`: one row per company, `lastAssignedUserId`, locked with
  `SELECT ... FOR UPDATE` inside the same transaction as the contact insert(s). Solid,
  persisted, transaction-safe — exactly the "no in-memory counters" requirement you listed,
  already satisfied for the company-level case.
- Eligible pool = active users, explicitly granted that company (Superuser's implicit access
  does **not** count), role = `CALL_CENTER_AGENT` only (`ROUND_ROBIN_ELIGIBLE_ROLES`).
- Triggered from `createContact()` (CRM "New Contact" form, Active Campaigns "New contact")
  whenever `assignedUserId` is `undefined` (not passed at all) — explicit `null` or a real id
  bypasses RR entirely.
- Triggered from `importContacts()` for **every** row in a CSV import, batched (one cursor
  lock for the whole file) — and, as noted in §0, this is the same function
  `importCampaignMembers()` calls for Manage Campaigns CSV import. **This is the conflict.**

## 7. The conflict, explained, and the fix

Your target rule:
> Manual standalone lead → company-level RR still auto-assigns.
> Campaign CSV import → create/link, but leave unassigned until the manager distributes.

Today (per §0/§6) both paths go through the exact same `importContacts()`, so both get
company-level RR. They need to diverge.

**Safest fix — no new abstractions, smallest possible diff:**
Give `contactsService.importContacts()` an explicit `skipRoundRobin` flag (default `false`,
so the CRM's own "Import Excel/CSV" keeps today's behavior unchanged), and have
`campaignsService.importCampaignMembers()` pass `skipRoundRobin: true`. That's it — one
boolean parameter, one call-site change, zero risk to the CRM import path, and it makes the
company-RR vs. manager-RR boundary explicit and auditable at the one place they could
collide.

This also directly answers your "architecture for having both" question: they don't actually
need to interact at all once import stops calling RR — **company RR owns contact-creation
time, manager RR owns campaign-lead-distribution time, and the two cursors never contend for
the same row** because the manager cursor (§8) is keyed per campaign/manager, never per
company.

## 8. Manager-scoped "Auto Assign Leads" — cursor scoping recommendation

You asked: per campaign+manager, per manager, or another model?

**Recommendation: per campaign.** Concretely, a new table mirroring
`company_round_robin_cursors` exactly:

```ts
export const campaignRoundRobinCursors = pgTable("campaign_round_robin_cursors", {
  campaignId: uuid("campaign_id").primaryKey().references(() => campaigns.id, { onDelete: "cascade" }),
  lastAssignedUserId: uuid("last_assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Why campaign-keyed, not manager-keyed:
- Your own worked example ("Lead 1→A, Lead 2→B...Lead 6→A") describes a rotation that resets
  cleanly per campaign — Manager 1's *other* campaign shouldn't have its distribution
  perturbed by where Campaign 1's rotation happened to land.
- It reuses the exact self-healing behavior already proven in `roundRobin.ts`
  (`pickNextAgents`): if the last-assigned agent is no longer in the eligible set — e.g. the
  campaign was reassigned to a different manager with a different team — the lookup returns
  `-1` and the rotation safely restarts from the top, with no special-case code needed for
  "campaign reassigned."
- If the campaign is reassigned Manager 1 → Manager 2, you keep one row, not two — no
  orphaned manager-keyed cursor to clean up, and no ambiguity about which cursor is "current."
- Locking is per-campaign, so two managers clicking "Auto Assign Leads" on two different
  campaigns at the same moment never block each other — same non-interference property the
  company cursor already has across companies.

A manager-keyed cursor (`manager + companyId`) would instead cause one manager's two
campaigns to fight over a single rotation pointer, which contradicts "each campaign should
distribute fairly across that manager's team" — campaign-keyed is the correct read of that
requirement.

## 9. What must change vs. stay untouched — compatibility checklist

| Area | Today | Change needed |
|---|---|---|
| `user_company_access` | works, Superuser bypass | **no change** |
| `assertCompanyAccess` / `assertModuleAccess` | works | **no change** |
| Campaign CSV import → company RR | auto-assigns (uncommitted, see §0) | **must stop** (§7) |
| CRM "New Contact" / CSV import → company RR | auto-assigns | **no change** |
| `campaigns.ownerId` | display-only, set-once | **gains behavior**: reassignable, manager-filtered dropdown, used for visibility filtering of `CALL_CENTER_LEAD` |
| `listCampaignsForCurrentUser` | returns all campaigns in allowed companies | **gains a manager-scoped branch**; Director/Superuser behavior unchanged |
| Contact/lead visibility | all company contacts, any role | **narrows for Agent** (own assigned only) and **Manager** (own campaigns' leads only); Director/Superuser unchanged |
| "Assign Agent" dropdown | every company-access user | **narrows**: Manager sees only their own agents; reuses same action, new scoping query only |
| Activity log (`activities`, append-only) | protected, no delete path | **no change** — new auto-assign writes reuse `activitiesRepo.create`/`createMany` exactly as company RR already does |
| `CALL_CENTER_LEAD` role key | plain role, no logic | **relabel only** ("Call Center Manager"), key unchanged |

---

## 10. Phased plan

Each phase is independently shippable, keeps the repo→service→action→UI layering, and is
small enough to review and roll back on its own. Nothing here is implemented yet — this is
the plan to walk through with you one phase at a time, per your request.

### Phase 0 — Decide on the in-flight Round Robin work
Resolve §0/§7 first: commit the existing company-RR work as its own change, with the
`skipRoundRobin` fix applied to `importCampaignMembers` before it ever ships. This is
foundational — every later phase assumes company RR and manager RR are already
non-conflicting.

### Phase 1 — Schema only (additive, zero behavior change)
- `manager_agent_assignments` (§5)
- `campaign_round_robin_cursors` (§8)
- Relabel `CALL_CENTER_LEAD` → "Call Center Manager" in `src/lib/roles.ts` display strings
  only.
- Migration + snapshot generated via drizzle-kit, same as `0005_...`.
- **No service/action/UI changes in this phase.** Verify: existing test suite, typecheck,
  build all pass with these tables sitting unused.

### Phase 2 — Manager↔Agent assignment (admin-facing)
- `repositories/managerAgentAssignments.ts` (CRUD scoped by company).
- `services/users.ts`: extend `updateUserPermissions`/`createUser` so that when
  role = `CALL_CENTER_AGENT`, an optional `managerUserId` (same company) can be set;
  when role = `CALL_CENTER_LEAD`, expose "their team" (list of agents) read.
  Validate manager and agent share the company; reject cross-company.
- Settings → Users UI: optional "Manager" select on Agent rows; "Team" read-out on Manager
  rows. Reuses existing Users table/modal patterns in `ConfiguracionClient.tsx`.
- Test: Director/Superuser can set manager↔agent links within one company; cross-company
  attempt rejected server-side even if UI is bypassed.

### Phase 3 — Campaign ownership becomes real manager assignment
- `services/campaigns.ts`: add `reassignCampaignManager(campaignId, managerUserId)` —
  Director (own company) / Superuser only, validates `managerUserId` has role
  `CALL_CENTER_LEAD` in the campaign's company.
- `listCampaignsForCurrentUser`: branch for `CALL_CENTER_LEAD` → filter by `ownerId = me`.
  Director/Superuser: unchanged (all campaigns in allowed companies).
- Manage Campaigns UI: "Assign Manager" action per campaign row (Director/Superuser only);
  owner dropdown at creation time now filtered to that company's managers.
- Apply the `skipRoundRobin` fix from §7 here if not already done in Phase 0.
- Test scenario 1–3, 11, 12 from your spec (Director sees all 8; Manager 1/2 see only their
  2; reassignment doesn't rewrite historical lead assignments).

### Phase 4 — Lead/contact visibility narrowing
- New repo query: `findManyByAssignedUserId` / `findManyByManagerTeam(companyId, managerId)`.
- `listContactsForCurrentUser`: branch by role —
  - `CALL_CENTER_AGENT` → only their own assigned contacts.
  - `CALL_CENTER_LEAD` → only contacts under campaigns they own (+ already-assigned leads
    belonging to their agents, for continuity).
  - Director/Superuser → unchanged.
- "Assign Agent" dropdown: new scoped query — Manager sees only agents linked to them via
  `manager_agent_assignments` in that company; Director/Superuser keep the existing broader
  list.
- This is the phase most likely to feel like a behavior change to existing users — ship
  behind a clear changelog note, test scenarios 4, 5, 10 explicitly.

### Phase 5 — Manual "Assign Agent" scoping on campaign members
- Wire Phase 4's scoped agent list into the Campaign Members table's existing Assign Agent
  action (reuse `assignContact`, no new service method needed — just a scoped options list
  passed into the existing UI component).
- Test scenario 10 (manager 2 cannot reach campaign 1 via direct request manipulation) —
  verify server-side, not just hidden in UI.

### Phase 6 — "Auto Assign Leads" (manager-scoped Round Robin)
- `repositories/campaignRoundRobinCursors.ts` — same `lockCursor`/`setLastAssigned` shape as
  §8/`roundRobinCursors.ts`.
- `services/campaignRoundRobin.ts`: `pickNextAgentsForCampaign(tx, campaignId, managerId, count)`
  — eligible pool = active agents linked to this manager (`manager_agent_assignments`) in the
  campaign's company. Mirrors `roundRobin.ts` exactly, new eligibility join only.
- `services/campaigns.ts`: `autoAssignCampaignLeads(campaignId)` — Manager (own campaign
  only) / Director / Superuser (explicit override per your spec). Selects unassigned
  campaign leads (`campaign_contacts` join `contacts` where `assignedUserId is null`),
  assigns via the picker inside one transaction, logs one `AUTO_ASSIGNMENT` activity per
  contact (reuses `activitiesRepo.createMany`, same as company RR's batch import path —
  **no new audit mechanism**), returns a summary `{ assigned, agentCount }`.
- Explicit guards per your "very important rules" list: 0 eligible agents → leave unassigned,
  return a clear message, no throw; never touch already-assigned leads; fewer agents than
  leads → wrap around (inherent to modulo rotation, already proven in `roundRobin.ts`).
- UI: "Auto Assign Leads" button on Campaign Members view, confirm dialog showing counts,
  success summary ("15 leads assigned across 5 agents successfully"), reusing existing
  modal/toast patterns.
- Test scenarios 6, 7, 8, 9 explicitly.

### Phase 7 — Full scenario test pass + cleanup
- Walk your full 16-point Vulcan test scenario end-to-end with disposable seed data.
- `tsc`, ESLint, production build.
- Clean up disposable test data.
- Final review of the whole diff against "do not break" list in your spec.

---

## 11. Open decisions before Phase 1 starts

1. **Phase 0 timing** — do you want the uncommitted company-RR diff committed as its own
   commit first (clean history), or folded into Phase 1?
2. **Phase 4 scope** — confirm you want Agent visibility narrowed to "only their assigned
   leads" immediately, or staged further (e.g., ship Phases 1–3 and 6 first, hold visibility
   narrowing for a separate approval since it's the one true behavior change for existing
   users).
3. Confirm the `manager_agent_assignments` unique constraint — "one manager per agent per
   company" — matches intent, vs. allowing an agent to be temporarily under zero managers
   (unassigned) during a transition. The schema in §5 already allows zero rows (agent simply
   has no manager row = not eligible for any manager's Auto Assign Leads), so no further
   change needed there — just confirming that's the desired "no manager yet" state.
