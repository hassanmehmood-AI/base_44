import * as whatsappService from "@/server/services/whatsapp";
import { WhatsAppClient } from "./WhatsAppClient";

export default async function WhatsAppPage() {
  const conversations = await whatsappService.listWhatsappConversationsForCurrentUser();

  const initialSelectedId = conversations[0]?.id ?? null;
  const initialDetail = initialSelectedId ? await whatsappService.getWhatsappConversation(initialSelectedId) : undefined;

  return (
    <WhatsAppClient
      conversations={conversations}
      initialSelectedId={initialSelectedId}
      initialMessages={initialDetail?.messages ?? []}
    />
  );
}
