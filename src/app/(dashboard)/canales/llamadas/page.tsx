import * as contactsService from "@/server/services/contacts";
import * as callsService from "@/server/services/calls";
import { getActiveDefaultPipelineStages } from "@/server/services/pipelineStages";
import { LlamadasClient } from "./LlamadasClient";

export default async function LlamadasPage() {
  const [contacts, stages] = await Promise.all([
    contactsService.listContactsForCurrentUser(),
    getActiveDefaultPipelineStages(),
  ]);

  const queue = contacts.filter((c) => c.phone);
  const initialSelectedId = queue[0]?.id ?? null;

  const [initialContactResult, initialCalls] = await Promise.all([
    initialSelectedId ? contactsService.getContact(initialSelectedId) : undefined,
    initialSelectedId ? callsService.listCallsForContact(initialSelectedId) : [],
  ]);

  return (
    <LlamadasClient
      queue={queue}
      stages={stages}
      initialSelectedId={initialSelectedId}
      initialActivities={initialContactResult?.activities ?? []}
      initialCalls={initialCalls}
    />
  );
}
