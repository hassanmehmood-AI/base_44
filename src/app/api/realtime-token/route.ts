import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { requireSession, UnauthorizedError } from "@/server/services/authorization";
import { getAllowedCompaniesForCurrentUser } from "@/server/services/companies";

/** Mints a short-lived token the browser uses to authenticate its Socket.IO
 * connection to the separate realtime service (scripts/realtime-ws-service).
 * That service lives on a different Railway origin than this app, so the
 * browser's NextAuth session cookie never reaches it directly — this is the
 * deliberate hand-off instead of sharing cookies across origins.
 *
 * Company authorization is resolved here, once, by the same canonical
 * getAllowedCompaniesForCurrentUser() every other authenticated company-scoped
 * read already uses (SUPERUSER correctly expands to every active company) —
 * never re-derived or trusted from client input on the realtime service's
 * side. The token is deliberately short-lived (5 minutes): the client fetches
 * a fresh one on every connect and reconnect, which is what makes a
 * permission change (e.g. a company unassigned from this user) take effect
 * automatically on the next reconnect rather than needing a separate
 * revalidation mechanism. */
const TOKEN_TTL_SECONDS = 5 * 60;

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  const secret = process.env.WS_AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WS_AUTH_SECRET is not configured." }, { status: 503 });
  }

  const companies = await getAllowedCompaniesForCurrentUser();
  const companyIds = companies.map((c) => c.id);

  const token = await new SignJWT({
    companyIds,
    roleKey: session.user.roleKey,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.user.id)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));

  return NextResponse.json({ token, expiresInSeconds: TOKEN_TTL_SECONDS });
}
