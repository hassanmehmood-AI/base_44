import * as socialService from "@/server/services/social";
import * as contactsService from "@/server/services/contacts";
import { RedesSocialesClient } from "./RedesSocialesClient";

export default async function RedesSocialesPage() {
  const [conversations, contacts, platformStatus] = await Promise.all([
    socialService.listSocialConversationsForCurrentUser(),
    contactsService.listContactsForCurrentUser(),
    socialService.getPlatformConnectionStatusForCurrentUser(),
  ]);

  const initialSelectedId = conversations[0]?.id ?? null;
  const initialDetail = initialSelectedId ? await socialService.getConversation(initialSelectedId) : undefined;

  return (
    <RedesSocialesClient
      conversations={conversations}
      contacts={contacts}
      platformStatus={platformStatus}
      initialSelectedId={initialSelectedId}
      initialMessages={initialDetail?.messages ?? []}
    />
  );
}
