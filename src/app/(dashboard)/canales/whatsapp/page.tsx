import * as whatsappService from "@/server/services/whatsapp";
import { WhatsAppClient } from "./WhatsAppClient";
import { resolveInitialView, resolveInitialSelectedId } from "./whatsappUrlState";

export default async function WhatsAppPage({
  searchParams,
}: {
  // Populated when the client's own router.replace (see the useEffect in
  // WhatsAppClient.tsx) has already written the current view/conversation
  // into the URL — this is what makes a plain browser refresh restore the
  // Chat view and the open conversation instead of always resetting to the
  // Pipeline view with no chat open. Same searchParams-as-deep-link pattern
  // crm/page.tsx and the Social Media page already use.
  searchParams: Promise<{ view?: string; conversationId?: string }>;
}) {
  const [{ view: requestedView, conversationId: requestedConversationId }, conversations] = await Promise.all([
    searchParams,
    whatsappService.listWhatsappConversationsForCurrentUser(),
  ]);

  const initialView = resolveInitialView(requestedView);
  // Resolved against the already permission-scoped `conversations` list
  // (never a separate/unchecked lookup) — a requested conversationId that's
  // been deleted or is no longer accessible degrades gracefully to the
  // first conversation instead of silently leaking access or showing a
  // broken selection.
  const initialSelectedId = resolveInitialSelectedId(requestedConversationId, conversations);

  const initialDetail = initialSelectedId ? await whatsappService.getWhatsappConversation(initialSelectedId) : undefined;

  return (
    <WhatsAppClient
      conversations={conversations}
      initialSelectedId={initialSelectedId}
      initialMessages={initialDetail?.messages ?? []}
      initialView={initialView}
    />
  );
}
