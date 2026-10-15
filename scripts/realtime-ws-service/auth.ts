import { jwtVerify } from "jose";

/** Mirrors the claims src/app/api/realtime-token/route.ts signs in the main
 * app — this service never derives or trusts company access on its own, it
 * only verifies a token minted by that one canonical, already-authenticated
 * endpoint. */
export type RealtimeTokenClaims = {
  userId: string;
  companyIds: string[];
  roleKey: string;
  expiresAt: number;
};

export class InvalidTokenError extends Error {}

export async function verifyRealtimeToken(token: string, secret: string): Promise<RealtimeTokenClaims> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret)));
  } catch {
    throw new InvalidTokenError("Token is missing, malformed, unsigned, or expired.");
  }

  const userId = payload.sub;
  const companyIds = payload.companyIds;
  const roleKey = payload.roleKey;
  const expiresAt = payload.exp;

  if (
    typeof userId !== "string" ||
    !Array.isArray(companyIds) ||
    typeof roleKey !== "string" ||
    typeof expiresAt !== "number"
  ) {
    throw new InvalidTokenError("Token payload has an unexpected shape.");
  }
  if (!companyIds.every((id): id is string => typeof id === "string")) {
    throw new InvalidTokenError("Token payload has an unexpected shape.");
  }

  return { userId, companyIds, roleKey, expiresAt };
}
