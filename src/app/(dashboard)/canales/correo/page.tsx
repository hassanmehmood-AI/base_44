import * as contactsService from "@/server/services/contacts";
import * as emailService from "@/server/services/email";
import { CorreoClient } from "./CorreoClient";

export default async function CorreoPage() {
  const contacts = await contactsService.listContactsForCurrentUser();
  const queue = contacts.filter((c) => c.email);
  const initialSelectedId = queue[0]?.id ?? null;

  const initialDetail = initialSelectedId
    ? await emailService.getConversationForContact(initialSelectedId)
    : { conversation: null, messages: [] };

  return (
    <CorreoClient
      queue={queue}
      initialSelectedId={initialSelectedId}
      initialConversation={initialDetail.conversation}
      initialMessages={initialDetail.messages}
    />
  );
}
