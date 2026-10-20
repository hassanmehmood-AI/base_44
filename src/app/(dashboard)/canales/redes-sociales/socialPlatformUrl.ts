// Deliberately NOT "use client" — these are plain, pure functions with zero
// React/DOM dependency, callable from page.tsx (a Server Component) AND
// from RedesSocialesClient.tsx (a Client Component). They used to live
// inside RedesSocialesClient.tsx itself, but that file's "use client"
// directive marks EVERY export from it as client-only — Next.js's RSC
// boundary then refuses a Server Component calling them directly as plain
// functions (only rendering-as-JSX or passing-as-props is allowed across
// that boundary), which is exactly the runtime error this file fixes.

export type SocialPlatform = "FACEBOOK" | "INSTAGRAM";

/** Regression coverage for "refresh resets to the Facebook tab": resolves
 * which platform tab to show on initial load from a URL query param (see
 * page.tsx, which reads this from `searchParams` the same way crm/page.tsx
 * already does for its own contact deep-link). Any value other than
 * exactly "INSTAGRAM" — missing, garbled, an old bookmark from before this
 * param existed — degrades to "FACEBOOK", the same default this page
 * always had, never an error. */
export function resolveInitialPlatform(requested: string | null | undefined): SocialPlatform {
  return requested === "INSTAGRAM" ? "INSTAGRAM" : "FACEBOOK";
}

/** Regression coverage for "refresh closes the open chat": resolves which
 * conversation to open on initial load — mirrors the exact pattern
 * crm/page.tsx's own contact deep-link already uses in this codebase: a
 * requested id only wins if it's actually present in the caller's already
 * permission-scoped `platformConversations` list (never a separate,
 * unchecked lookup) — this is what makes a deleted, inaccessible, or
 * stale id degrade gracefully to the existing default (the platform's
 * first conversation) instead of silently leaking a conversation outside
 * the viewer's access or showing a broken selection. */
export function resolveInitialSelectedId(
  requestedId: string | null | undefined,
  platformConversations: { id: string }[]
): string | null {
  if (requestedId && platformConversations.some((c) => c.id === requestedId)) {
    return requestedId;
  }
  return platformConversations[0]?.id ?? null;
}

/** The query string the client keeps the URL in sync with via
 * router.replace (see the useEffect in RedesSocialesClient) — never
 * navigates or reloads anything itself, purely updates the address bar/
 * history so a later plain browser refresh re-enters page.tsx with the
 * same platform and conversation already in the URL for
 * resolveInitialPlatform/resolveInitialSelectedId above to pick back up. */
export function buildSocialMediaSearchParams(platform: SocialPlatform, selectedId: string | null): string {
  const params = new URLSearchParams({ platform });
  if (selectedId) params.set("conversationId", selectedId);
  return params.toString();
}
