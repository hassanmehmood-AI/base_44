import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyWebhookSecret, mapIncomingMessage } from "./whatsapp";

// Pure-function regression coverage — no database or network call. DB-
// touching functions (resolveAuthenticatedChannel, processPendingWhapiEvents,
// replyToWhatsappConversation, ...) follow this codebase's existing
// convention (see metricoolOnboarding.ts) of not being unit-tested without a
// real database; their logic is kept as thin as possible around these pure
// helpers for exactly that reason.

test("verifyWebhookSecret: matching secret is authentic", () => {
  assert.equal(verifyWebhookSecret("correct-secret", "correct-secret"), true);
});

test("verifyWebhookSecret: wrong secret is rejected", () => {
  assert.equal(verifyWebhookSecret("correct-secret", "wrong-secret"), false);
});

test("verifyWebhookSecret: missing header is rejected, never throws", () => {
  assert.equal(verifyWebhookSecret("correct-secret", null), false);
});

test("verifyWebhookSecret: different-length values are rejected without throwing (timingSafeEqual would otherwise throw on length mismatch)", () => {
  assert.equal(verifyWebhookSecret("a-long-secret-value", "short"), false);
});

test("mapIncomingMessage: from_me true -> OUTBOUND, no senderLabel (it's this company's own number)", () => {
  const result = mapIncomingMessage({ id: "1", chat_id: "c1", from_me: true, type: "text", text: { body: "hi" }, from_name: "Brand" });
  assert.equal(result.direction, "OUTBOUND");
  assert.equal(result.senderLabel, null);
  assert.equal(result.body, "hi");
});

test("mapIncomingMessage: from_me false -> INBOUND, keeps the sender's display name", () => {
  const result = mapIncomingMessage({ id: "2", chat_id: "c1", from_me: false, type: "text", text: { body: "hello" }, from_name: "Customer Name" });
  assert.equal(result.direction, "INBOUND");
  assert.equal(result.senderLabel, "Customer Name");
  assert.equal(result.body, "hello");
});

test("mapIncomingMessage: non-text message types get a readable placeholder body, never crash on missing text.body", () => {
  const result = mapIncomingMessage({ id: "3", chat_id: "c1", from_me: false, type: "image" });
  assert.match(result.body, /unsupported message type: image/);
});

test("mapIncomingMessage: direction is derived strictly from from_me, never from message content", () => {
  // Two messages with identical text but opposite from_me must resolve independently.
  const inbound = mapIncomingMessage({ id: "4", chat_id: "c1", from_me: false, type: "text", text: { body: "same text" } });
  const outbound = mapIncomingMessage({ id: "5", chat_id: "c1", from_me: true, type: "text", text: { body: "same text" } });
  assert.equal(inbound.direction, "INBOUND");
  assert.equal(outbound.direction, "OUTBOUND");
});
