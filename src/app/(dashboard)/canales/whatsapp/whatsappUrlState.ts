// Deliberately NOT "use client" — these are plain, pure functions with zero
// React/DOM dependency, callable from page.tsx (a Server Component) AND
// WhatsAppClient.tsx (a Client Component). A near-identical module exists
// for the Social Media page (canales/redes-sociales/socialPlatformUrl.ts);
// duplicated here rather than shared, same deliberate per-page-folder
// self-containment already used for useSocialRealtime.ts/
// useWhatsappRealtime.ts (each a standalone copy, not a shared hook) — the
// two pages' view/platform concepts aren't actually the same shape (view:
// "pipeline"|"chat" vs. platform: "FACEBOOK"|"INSTAGRAM"), so sharing would
// mean a forced abstraction over two things that just happen to look similar.

export type WhatsappView = "pipeline" | "chat";

/** Regression coverage for "refresh always lands back on the Pipeline
 * view": resolves which view to show on initial load from a URL query
 * param (see page.tsx, which reads this from `searchParams`). Any value
 * other than exactly "chat" — missing, garbled, a bookmark from before
 * this param existed — degrades to "pipeline", the same default this page
 * always had, never an error. */
export function resolveInitialView(requested: string | null | undefined): WhatsappView {
  return requested === "chat" ? "chat" : "pipeline";
}

/** Regression coverage for "refresh closes the open chat": resolves which
 * conversation to open on initial load — same pattern as crm/page.tsx's
 * contact deep-link and the Social Media page's own fix: a requested id
 * only wins if it's actually present in the caller's already permission-
 * scoped `conversations` list (never a separate, unchecked lookup), so a
 * deleted/inaccessible/stale id degrades gracefully to the existing
 * default (the first conversation) instead of silently leaking access or
 * showing a broken selection. */
export function resolveInitialSelectedId(requestedId: string | null | undefined, conversations: { id: string }[]): string | null {
  if (requestedId && conversations.some((c) => c.id === requestedId)) {
    return requestedId;
  }
  return conversations[0]?.id ?? null;
}

/** The query string the client keeps the URL in sync with via
 * router.replace (see the useEffect in WhatsAppClient) — never navigates
 * or reloads anything itself, purely updates the address bar/history so a
 * later plain browser refresh re-enters page.tsx with the same view and
 * conversation already in the URL for resolveInitialView/
 * resolveInitialSelectedId above to pick back up. */
export function buildWhatsappSearchParams(view: WhatsappView, selectedId: string | null): string {
  const params = new URLSearchParams({ view });
  if (selectedId) params.set("conversationId", selectedId);
  return params.toString();
}
