import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { hash } from "bcryptjs";
import { getDb } from "./index";
import { roles, pipelines, pipelineStages, companies, users, userCompanyAccess, userModuleAccess } from "./schema";
import { ROLE_KEYS } from "@/server/constants";

// Matches the Stage keys already used by the frontend in src/lib/pipeline.ts
const STAGE_KEYS = [
  "NUEVO_LEAD",
  "CONTACTADO",
  "INTERESADO",
  "OPORTUNIDAD",
  "PEDIDO_EN_CURSO",
  "CLIENTE",
  "SEGUIMIENTO",
];

// Matches the company names already used throughout src/lib/mock-data.ts —
// Contacts/Campaigns are still mock-data-driven, and CompanyContext now
// compares real DB company names against those same mock-data string tags,
// so these must stay in sync until Contacts/Campaigns are migrated.
const COMPANY_NAMES = ["Contact-On", "Leyva", "Meca", "Linmania", "Vulcan", "Rockstar"];
const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

async function seed() {
  const db = getDb();

  await db.insert(roles).values(ROLE_KEYS.map((key) => ({ key }))).onConflictDoNothing();
  const allRoles = await db.select().from(roles);
  const roleIdByKey = Object.fromEntries(allRoles.map((r) => [r.key, r.id]));

  await db
    .insert(companies)
    .values(COMPANY_NAMES.map((name) => ({ name, slug: slugify(name) })))
    .onConflictDoNothing();
  const allCompanies = await db.select().from(companies);
  const companyIdByName = Object.fromEntries(allCompanies.map((c) => [c.name, c.id]));

  // No unique constraint on pipelines (a company could theoretically have more than
  // one someday) — so guard idempotency here instead of via ON CONFLICT.
  let pipeline = (await db.select().from(pipelines).where(eq(pipelines.isDefault, true))).at(0);
  if (!pipeline) {
    [pipeline] = await db.insert(pipelines).values({ name: "Default Pipeline", isDefault: true }).returning();
  }

  await db
    .insert(pipelineStages)
    .values(STAGE_KEYS.map((key, i) => ({ pipelineId: pipeline.id, key, position: i })))
    .onConflictDoNothing();

  // --- Demo accounts -------------------------------------------------------
  // Superuser: implicit access to every company/module (see server/services/authorization.ts),
  // so no user_company_access/user_module_access rows are needed for it.
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@growth-on.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(9).toString("base64url");
  await upsertUser({ fullName: "David Leyva", email: adminEmail, password: adminPassword, roleKey: "SUPERUSER" });

  // A restricted demo account, to actually exercise (not just assume) the
  // company/module authorization checks: Rockstar only, CRM + Channels only.
  const agentEmail = process.env.SEED_AGENT_EMAIL ?? "milagros@growth-on.local";
  const agentPassword = process.env.SEED_AGENT_PASSWORD ?? randomBytes(9).toString("base64url");
  const agent = await upsertUser({
    fullName: "Milagros",
    email: agentEmail,
    password: agentPassword,
    roleKey: "CALL_CENTER_AGENT",
  });
  await db
    .insert(userCompanyAccess)
    .values({ userId: agent.id, companyId: companyIdByName["Rockstar"] })
    .onConflictDoNothing();
  await db
    .insert(userModuleAccess)
    .values([
      { userId: agent.id, module: "CRM" },
      { userId: agent.id, module: "CHANNELS" },
    ])
    .onConflictDoNothing();

  console.log("Seed complete:");
  console.log(`  roles: ${ROLE_KEYS.length}`);
  console.log(`  companies: ${COMPANY_NAMES.length}`);
  console.log(`  pipeline: "${pipeline.name}" (${pipeline.id})`);
  console.log(`  pipeline_stages: ${STAGE_KEYS.length}`);
  console.log("");
  console.log("Demo accounts (save these — passwords are not stored anywhere else):");
  console.log(`  Superuser        ${adminEmail} / ${adminPassword}`);
  console.log(`  Call Center Agent (Rockstar only)  ${agentEmail} / ${agentPassword}`);

  async function upsertUser(input: { fullName: string; email: string; password: string; roleKey: string }) {
    const [existing] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (existing) return existing;
    const passwordHash = await hash(input.password, 12);
    const [created] = await db
      .insert(users)
      .values({
        fullName: input.fullName,
        email: input.email,
        passwordHash,
        roleId: roleIdByKey[input.roleKey],
      })
      .returning();
    return created;
  }

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
