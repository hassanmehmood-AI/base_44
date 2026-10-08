import * as contactsService from "@/server/services/contacts";
import * as tasksService from "@/server/services/tasks";
import * as campaignsService from "@/server/services/campaigns";
import { getActiveDefaultPipelineStages } from "@/server/services/pipelineStages";
import { getAllowedCompaniesForCurrentUser } from "@/server/services/companies";
import { CrmClient } from "./CrmClient";

export default async function CrmPage({
  searchParams,
}: {
  // Populated when another page deep-links here, e.g. Active Campaigns'
  // "assigned clients" cards link to /crm?contact=<id> to open that exact
  // contact instead of the CRM's own default (first-in-list) selection.
  searchParams: Promise<{ contact?: string }>;
}) {
  const [{ contact: deepLinkContactId }, contacts, stages, companies, campaigns] = await Promise.all([
    searchParams,
    contactsService.listContactsForCurrentUser(),
    getActiveDefaultPipelineStages(),
    getAllowedCompaniesForCurrentUser(),
    campaignsService.listCampaignsForCurrentUser(),
  ]);

  // Resolved against the same session-scoped `contacts` list the page
  // already renders from, so a deep link can never surface a contact outside
  // this user's existing permissions — it's not a separate lookup path.
  const requestedContact = deepLinkContactId ? contacts.find((c) => c.id === deepLinkContactId) : undefined;
  const deepLinkResolved = !deepLinkContactId || !!requestedContact;
  const initialSelectedId = requestedContact?.id ?? contacts[0]?.id ?? null;

  const [initialResult, initialTasks] = await Promise.all([
    initialSelectedId ? contactsService.getContact(initialSelectedId) : undefined,
    initialSelectedId ? tasksService.listOpenTasksForContact(initialSelectedId) : [],
  ]);

  return (
    <CrmClient
      contacts={contacts}
      stages={stages}
      companies={companies}
      campaigns={campaigns}
      initialSelectedId={initialSelectedId}
      initialActivities={initialResult?.activities ?? []}
      initialTasks={initialTasks}
      deepLinkContactId={deepLinkContactId ?? null}
      deepLinkResolved={deepLinkResolved}
    />
  );
}
