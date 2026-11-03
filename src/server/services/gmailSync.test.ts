import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair } from "jose";
import { verifyWebhookSecret, shouldRenewWatch, verifyPubSubOidcToken, establishHistoryBaseline, isRateLimitError } from "./gmailSync";
import { GoogleApiError } from "../integrations/google";

// Mocks the global fetch gmailSync.ts's googleProvider calls hit — same
// style as integrations/google.test.ts's own mockFetchSequence, kept local
// to this file since it's testing establishHistoryBaseline's fallback
// BRANCHING (watchMailbox vs. getProfile), not integrations/google.ts's
// own request-building logic (already covered there).
function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const next = responses[Math.min(call, responses.length - 1)];
    call++;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

// Same style as whatsapp.test.ts's verifyWebhookSecret coverage — this is
// the compensating control for Pub/Sub push having no payload signature.

test("verifyWebhookSecret: matching secret is authentic", () => {
  assert.equal(verifyWebhookSecret("correct-secret", "correct-secret"), true);
});

test("verifyWebhookSecret: wrong secret is rejected", () => {
  assert.equal(verifyWebhookSecret("correct-secret", "wrong-secret"), false);
});

test("verifyWebhookSecret: missing token is rejected, never throws", () => {
  assert.equal(verifyWebhookSecret("correct-secret", null), false);
});

test("verifyWebhookSecret: different-length values are rejected without throwing", () => {
  assert.equal(verifyWebhookSecret("a-long-secret-value", "short"), false);
});

// shouldRenewWatch — Gmail watches expire after at most ~7 days; renewing a
// full day ahead of that is the deliberately generous margin.

test("shouldRenewWatch: no watchExpiration at all (never registered) is always due", () => {
  assert.equal(shouldRenewWatch({ watchExpiration: null }), true);
});

test("shouldRenewWatch: expiration far in the future is not due", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const expiration = new Date("2026-01-05T00:00:00Z"); // 4 days out
  assert.equal(shouldRenewWatch({ watchExpiration: expiration }, now), false);
});

test("shouldRenewWatch: expiration within the 24h margin is due", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const expiration = new Date("2026-01-01T12:00:00Z"); // 12h out
  assert.equal(shouldRenewWatch({ watchExpiration: expiration }, now), true);
});

test("shouldRenewWatch: expiration already in the past is due", () => {
  const now = new Date("2026-01-05T00:00:00Z");
  const expiration = new Date("2026-01-01T00:00:00Z");
  assert.equal(shouldRenewWatch({ watchExpiration: expiration }, now), true);
});

// verifyPubSubOidcToken — signs real JWTs against a local, test-only keypair
// (never a real network fetch to Google's JWKS endpoint) to exercise every
// validation layer: signature, issuer, audience, service account identity,
// and expiration.

async function signTestToken(
  privateKey: CryptoKey,
  overrides: Partial<{ issuer: string; audience: string; email: string; emailVerified: boolean; expiredSecondsAgo: number }> = {}
) {
  const now = Math.floor(Date.now() / 1000);
  const exp = overrides.expiredSecondsAgo ? now - overrides.expiredSecondsAgo : now + 3600;
  return new SignJWT({ email: overrides.email ?? "push@test-project.iam.gserviceaccount.com", email_verified: overrides.emailVerified ?? true })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now)
    .setIssuer(overrides.issuer ?? "https://accounts.google.com")
    .setAudience(overrides.audience ?? "https://growthon.up.railway.app/api/webhooks/gmail")
    .setExpirationTime(exp)
    .sign(privateKey);
}

const TEST_CONFIG = {
  audience: "https://growthon.up.railway.app/api/webhooks/gmail",
  serviceAccountEmail: "push@test-project.iam.gserviceaccount.com",
};

test("verifyPubSubOidcToken: a correctly signed token with matching claims is authentic", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const token = await signTestToken(privateKey);
  assert.equal(await verifyPubSubOidcToken(`Bearer ${token}`, TEST_CONFIG, publicKey), true);
});

test("verifyPubSubOidcToken: missing Authorization header is rejected, never throws", async () => {
  assert.equal(await verifyPubSubOidcToken(null, TEST_CONFIG), false);
});

test("verifyPubSubOidcToken: a header without the Bearer prefix is rejected", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const token = await signTestToken(privateKey);
  assert.equal(await verifyPubSubOidcToken(token, TEST_CONFIG, publicKey), false);
});

test("verifyPubSubOidcToken: signed by a different (untrusted) key is rejected", async () => {
  const { privateKey: wrongKey } = await generateKeyPair("RS256");
  const { publicKey } = await generateKeyPair("RS256"); // a different, trusted key's public half
  const token = await signTestToken(wrongKey);
  assert.equal(await verifyPubSubOidcToken(`Bearer ${token}`, TEST_CONFIG, publicKey), false);
});

test("verifyPubSubOidcToken: wrong issuer is rejected", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const token = await signTestToken(privateKey, { issuer: "https://evil.example.com" });
  assert.equal(await verifyPubSubOidcToken(`Bearer ${token}`, TEST_CONFIG, publicKey), false);
});

test("verifyPubSubOidcToken: wrong audience is rejected — a token Google issued for a DIFFERENT subscription/service can't be replayed here", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const token = await signTestToken(privateKey, { audience: "https://some-other-service.example.com/webhook" });
  assert.equal(await verifyPubSubOidcToken(`Bearer ${token}`, TEST_CONFIG, publicKey), false);
});

test("verifyPubSubOidcToken: a valid, correctly-audienced token from a DIFFERENT service account is still rejected", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const token = await signTestToken(privateKey, { email: "someone-else@other-project.iam.gserviceaccount.com" });
  assert.equal(await verifyPubSubOidcToken(`Bearer ${token}`, TEST_CONFIG, publicKey), false);
});

test("verifyPubSubOidcToken: email_verified false is rejected even with the right email/audience/issuer", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const token = await signTestToken(privateKey, { emailVerified: false });
  assert.equal(await verifyPubSubOidcToken(`Bearer ${token}`, TEST_CONFIG, publicKey), false);
});

test("verifyPubSubOidcToken: an expired token is rejected", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const token = await signTestToken(privateKey, { expiredSecondsAgo: 60 });
  assert.equal(await verifyPubSubOidcToken(`Bearer ${token}`, TEST_CONFIG, publicKey), false);
});

// establishHistoryBaseline — the dev-polling-without-Pub/Sub fallback this
// turn's "no ngrok, no Pub/Sub" requirement depends on.

test("establishHistoryBaseline: uses watchMailbox's result when Pub/Sub IS configured (production path, unchanged)", async () => {
  process.env.GOOGLE_PUBSUB_TOPIC = "projects/test-project/topics/gmail-push";
  const mock = mockFetchSequence([{ status: 200, body: { historyId: "111", expiration: "1700000000000" } }]);
  try {
    const baseline = await establishHistoryBaseline("access-token");
    assert.equal(baseline.historyId, "111");
    assert.equal(baseline.watchExpiration?.getTime(), 1700000000000);
  } finally {
    mock.restore();
    delete process.env.GOOGLE_PUBSUB_TOPIC;
  }
});

test("establishHistoryBaseline: falls back to getProfile when Pub/Sub is NOT configured (local dev polling path) — no watchExpiration set, since there's no real watch", async () => {
  delete process.env.GOOGLE_PUBSUB_TOPIC;
  const mock = mockFetchSequence([{ status: 200, body: { emailAddress: "test@example.com", historyId: 222 } }]);
  try {
    const baseline = await establishHistoryBaseline("access-token");
    assert.equal(baseline.historyId, "222");
    assert.equal(baseline.watchExpiration, undefined);
  } finally {
    mock.restore();
  }
});

test("establishHistoryBaseline: a genuine Google API error (not a config issue) propagates rather than being silently swallowed", async () => {
  process.env.GOOGLE_PUBSUB_TOPIC = "projects/test-project/topics/gmail-push";
  const mock = mockFetchSequence([{ status: 401, body: { error: { message: "Invalid credentials" } } }]);
  try {
    await assert.rejects(() => establishHistoryBaseline("access-token"));
  } finally {
    mock.restore();
    delete process.env.GOOGLE_PUBSUB_TOPIC;
  }
});

// isRateLimitError — the per-account backoff that makes a tight (3s in
// production) poll interval safe against Google's own rate limiting.

test("isRateLimitError: a 429 GoogleApiError is a rate-limit error", () => {
  assert.equal(isRateLimitError(new GoogleApiError(429, "Too Many Requests")), true);
});

test("isRateLimitError: a 403 GoogleApiError is treated as a rate-limit error (Google uses 403 for some quota-exceeded responses too)", () => {
  assert.equal(isRateLimitError(new GoogleApiError(403, "Quota exceeded")), true);
});

test("isRateLimitError: a 401 (auth) GoogleApiError is NOT a rate-limit error — must not be backed off like one", () => {
  assert.equal(isRateLimitError(new GoogleApiError(401, "Invalid credentials")), false);
});

test("isRateLimitError: a 500 GoogleApiError is NOT a rate-limit error", () => {
  assert.equal(isRateLimitError(new GoogleApiError(500, "Internal error")), false);
});

test("isRateLimitError: a plain Error (not GoogleApiError) is never treated as a rate-limit error", () => {
  assert.equal(isRateLimitError(new Error("some other failure")), false);
});

test("isRateLimitError: non-error values never throw, resolve to false", () => {
  assert.equal(isRateLimitError(undefined), false);
  assert.equal(isRateLimitError(null), false);
  assert.equal(isRateLimitError("string"), false);
});
