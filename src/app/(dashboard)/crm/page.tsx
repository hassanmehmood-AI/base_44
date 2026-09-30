import * as contactsService from "@/server/services/contacts";
import * as tasksService from "@/server/services/tasks";
import { getActiveDefaultPipelineStages } from "@/server/services/pipelineStages";
import { getAllowedCompaniesForCurrentUser } from "@/server/services/companies";
import { CrmClient } from "./CrmClient";

export default async function CrmPage() {
  const [contacts, stages, companies] = await Promise.all([
    contactsService.listContactsForCurrentUser(),
    getActiveDefaultPipelineStages(),
    getAllowedCompaniesForCurrentUser(),
  ]);

  const initialSelectedId = contacts[0]?.id ?? null;
  const [initialResult, initialTasks] = await Promise.all([
    initialSelectedId ? contactsService.getContact(initialSelectedId) : undefined,
    initialSelectedId ? tasksService.listOpenTasksForContact(initialSelectedId) : [],
  ]);

  return (
    <CrmClient
      contacts={contacts}
      stages={stages}
      companies={companies}
      initialSelectedId={initialSelectedId}
      initialActivities={initialResult?.activities ?? []}
      initialTasks={initialTasks}
    />
  );
}
