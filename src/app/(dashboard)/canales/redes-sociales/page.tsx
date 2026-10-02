import * as socialService from "@/server/services/social";
import * as contactsService from "@/server/services/contacts";
import { RedesSocialesClient } from "./RedesSocialesClient";

export default async function RedesSocialesPage() {
  const [conversations, contacts] = await Promise.all([
    socialService.listSocialConversationsForCurrentUser(),
    contactsService.listContactsForCurrentUser(),
  ]);

  const initialSelectedId = conversations[0]?.id ?? null;
  const initialDetail = initialSelectedId ? await socialService.getConversation(initialSelectedId) : undefined;

  return (
    <RedesSocialesClient
      conversations={conversations}
      contacts={contacts}
      initialSelectedId={initialSelectedId}
      initialMessages={initialDetail?.messages ?? []}
    />
  );
}
