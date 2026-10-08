"use client";

import { createContext, useContext, ReactNode } from "react";

const CurrentUserContext = createContext<string | null>(null);

/** Exposes the acting session's user id to client components — e.g. to key
 * browser-local drafts (see @/lib/drafts.ts) so they're scoped to whoever is
 * actually signed in, including while impersonating another user. */
export function CurrentUserProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return <CurrentUserContext.Provider value={userId}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUserId(): string {
  const id = useContext(CurrentUserContext);
  if (!id) throw new Error("useCurrentUserId must be used within a CurrentUserProvider");
  return id;
}
