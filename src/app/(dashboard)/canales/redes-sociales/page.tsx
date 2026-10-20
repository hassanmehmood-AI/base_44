import * as socialService from "@/server/services/social";
import * as contactsService from "@/server/services/contacts";
import { RedesSocialesClient } from "./RedesSocialesClient";
import { resolveInitialPlatform, resolveInitialSelectedId } from "./socialPlatformUrl";

export default async function RedesSocialesPage({
  searchParams,
}: {
  // Populated when the client's own router.replace (see the useEffect in
  // RedesSocialesClient.tsx) has already written the current tab/
  // conversation into the URL — this is what makes a plain browser refresh
  // restore the exact platform tab and open chat instead of always
  // resetting to Facebook + the first conversation. Same
  // searchParams-as-deep-link pattern crm/page.tsx already uses for its own
  // contact param.
  searchParams: Promise<{ platform?: string; conversationId?: string }>;
}) {
  const [{ platform: requestedPlatform, conversationId: requestedConversationId }, conversations, contacts, platformStatus] =
    await Promise.all([
      searchParams,
      socialService.listSocialConversationsForCurrentUser(),
      contactsService.listContactsForCurrentUser(),
      socialService.getPlatformConnectionStatusForCurrentUser(),
    ]);

  const initialPlatform = resolveInitialPlatform(requestedPlatform);
  // Resolved against this exact platform's slice of the already
  // permission-scoped `conversations` list (never a separate/unchecked
  // lookup) — a requested conversationId for a DIFFERENT platform, or one
  // that's been deleted/is no longer accessible, degrades gracefully to
  // that platform's first conversation instead of silently leaking access
  // or showing a broken selection.
  const platformConversations = conversations.filter((c) => c.platform === initialPlatform);
  const initialSelectedId = resolveInitialSelectedId(requestedConversationId, platformConversations);

  const initialDetail = initialSelectedId ? await socialService.getConversation(initialSelectedId) : undefined;

  return (
    <RedesSocialesClient
      conversations={conversations}
      contacts={contacts}
      platformStatus={platformStatus}
      initialSelectedId={initialSelectedId}
      initialMessages={initialDetail?.messages ?? []}
      initialPlatform={initialPlatform}
    />
  );
}
