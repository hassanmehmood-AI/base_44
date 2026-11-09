import * as contactsService from "@/server/services/contacts";
import * as emailService from "@/server/services/email";
import { CorreoClient } from "./CorreoClient";

export default async function CorreoPage() {
  const [contacts, senderStatus, unassignedConversations, emailProviders] = await Promise.all([
    contactsService.listContactsForCurrentUser(),
    emailService.getEmailSenderStatus(),
    emailService.listUnassignedEmailConversations(),
    emailService.getEmailProvidersByContact(),
  ]);
  const queue = contacts.filter((c) => c.email);
  const initialSelectedId = queue[0]?.id ?? null;

  const initialDetail = initialSelectedId
    ? await emailService.getConversationForContact(initialSelectedId)
    : { conversations: [], conversation: null, messages: [], senderStatus };

  return (
    <CorreoClient
      queue={queue}
      allContacts={contacts}
      initialSelectedId={initialSelectedId}
      initialConversations={initialDetail.conversations}
      initialConversation={initialDetail.conversation}
      initialMessages={initialDetail.messages}
      senderStatus={initialDetail.senderStatus}
      initialUnassignedConversations={unassignedConversations}
      initialEmailProviders={emailProviders}
    />
  );
}
