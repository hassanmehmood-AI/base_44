"use server";

import { revalidatePath } from "next/cache";
import { signIn, signOut } from "@/auth";
import { requireSession, UnauthorizedError } from "@/server/services/authorization";
import * as usersRepo from "@/server/repositories/users";
import { signImpersonationTicket } from "@/server/services/impersonationTicket";

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

export type ImpersonationResult = { error?: string; ok?: true };

// signIn({redirect:false}) sets the new session's cookie on the OUTGOING response,
// but the current request's incoming cookie jar (what auth() reads) is fixed at
// request start — so a same-request auth() call after signIn() still sees the OLD
// session, not the new one. Verify success from signIn()'s own return value instead:
// with redirect:false it resolves to a URL string, carrying an "error" search param
// only when authorize() rejected the credentials.
function signInSucceeded(result: unknown): boolean {
  if (typeof result !== "string") return false;
  try {
    return !new URL(result, "http://localhost").searchParams.has("error");
  } catch {
    return false;
  }
}

export async function startImpersonationAction(targetUserId: string): Promise<ImpersonationResult> {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") return { error: "Only Superusers can switch users." };
  if (session.user.impersonatorId) return { error: "Already switched to another user — return to your account first." };

  const target = await usersRepo.findById(targetUserId);
  if (!target || !target.isActive) return { error: "That user isn't available." };
  if (target.roleKey === "SUPERUSER") return { error: "Can't switch into another Superuser." };

  const ticket = signImpersonationTicket({ mode: "start", issuerId: session.user.id, targetId: target.id });

  let result: unknown;
  try {
    result = await signIn("impersonate", { ticket, redirect: false });
  } catch (e) {
    if (e instanceof UnauthorizedError) throw e;
    return { error: "Could not switch to that user." };
  }
  if (!signInSucceeded(result)) return { error: "Could not switch to that user." };

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function stopImpersonationAction(): Promise<ImpersonationResult> {
  const session = await requireSession();
  const expectedOriginalId = session.user.impersonatorId;
  if (!expectedOriginalId) return { error: "You're not currently switched to another user." };

  const ticket = signImpersonationTicket({ mode: "stop", issuerId: expectedOriginalId });

  let result: unknown;
  try {
    result = await signIn("impersonate", { ticket, redirect: false });
  } catch {
    return { error: "Could not return to your account." };
  }
  if (!signInSucceeded(result)) return { error: "Could not return to your account." };

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function getImpersonatableUsersAction() {
  try {
    const session = await requireSession();
    if (session.user.roleKey !== "SUPERUSER" || session.user.impersonatorId) return { users: [] };
    return { users: await usersRepo.findImpersonatableUsers() };
  } catch {
    return { users: [] };
  }
}
