import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { verifyRealtimeToken, InvalidTokenError } from "./auth";

const SECRET = "test-secret-at-least-32-bytes-long-for-hs256";
const key = new TextEncoder().encode(SECRET);

async function mintToken(overrides: { companyIds?: unknown; roleKey?: unknown; sub?: string; ttlSeconds?: number } = {}) {
  return new SignJWT({
    companyIds: overrides.companyIds ?? ["company-1", "company-2"],
    roleKey: overrides.roleKey ?? "MANAGER",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(overrides.sub ?? "user-1")
    .setIssuedAt()
    .setExpirationTime(`${overrides.ttlSeconds ?? 300}s`)
    .sign(key);
}

test("verifyRealtimeToken: accepts a validly signed, unexpired token and returns its claims", async () => {
  const token = await mintToken({ companyIds: ["c1", "c2"], roleKey: "SUPERUSER", sub: "user-42" });

  const claims = await verifyRealtimeToken(token, SECRET);

  assert.equal(claims.userId, "user-42");
  assert.deepEqual(claims.companyIds, ["c1", "c2"]);
  assert.equal(claims.roleKey, "SUPERUSER");
  assert.ok(claims.expiresAt > Date.now() / 1000);
});

test("verifyRealtimeToken: rejects a token signed with the wrong secret", async () => {
  const token = await mintToken();
  await assert.rejects(() => verifyRealtimeToken(token, "a-completely-different-secret-value"), InvalidTokenError);
});

test("verifyRealtimeToken: rejects an expired token", async () => {
  const token = await mintToken({ ttlSeconds: -1 });
  await assert.rejects(() => verifyRealtimeToken(token, SECRET), InvalidTokenError);
});

test("verifyRealtimeToken: rejects a malformed/garbage token", async () => {
  await assert.rejects(() => verifyRealtimeToken("not-a-real-token", SECRET), InvalidTokenError);
  await assert.rejects(() => verifyRealtimeToken("", SECRET), InvalidTokenError);
});

test("verifyRealtimeToken: rejects a token whose payload shape is wrong (companyIds not an array)", async () => {
  const token = await mintToken({ companyIds: "not-an-array" });
  await assert.rejects(() => verifyRealtimeToken(token, SECRET), InvalidTokenError);
});

test("verifyRealtimeToken: rejects a token with a non-string entry in companyIds", async () => {
  const token = await mintToken({ companyIds: ["c1", 12345] });
  await assert.rejects(() => verifyRealtimeToken(token, SECRET), InvalidTokenError);
});

test("verifyRealtimeToken: a tampered payload (signature no longer matches) is rejected", async () => {
  const token = await mintToken({ companyIds: ["c1"] });
  const [header, , signature] = token.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ companyIds: ["c1", "c2-not-authorized"] })).toString(
    "base64url"
  );
  const tampered = `${header}.${tamperedPayload}.${signature}`;

  await assert.rejects(() => verifyRealtimeToken(tampered, SECRET), InvalidTokenError);
});
