import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyWebhookSecret, mapIncomingMessage, shouldFetchContactAvatar, resolveInitialConversationSubject } from "./whatsapp";

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

// Regression coverage for the avatar-fetch gate (requirement: avoid
// unnecessary Whapi API calls and duplicate downloads) — see
// shouldFetchContactAvatar's doc comment in whatsapp.ts for the three
// conditions this encodes.

test("shouldFetchContactAvatar: fetches for a fresh inbound message with no avatar yet", () => {
  assert.equal(shouldFetchContactAvatar("INBOUND", { customerAvatarKey: null, customerAvatarPendingUrl: null }), true);
});

test("shouldFetchContactAvatar: never fetches for our own OUTBOUND echo", () => {
  assert.equal(shouldFetchContactAvatar("OUTBOUND", { customerAvatarKey: null, customerAvatarPendingUrl: null }), false);
});

test("shouldFetchContactAvatar: never re-fetches once permanently captured (customerAvatarKey set)", () => {
  assert.equal(shouldFetchContactAvatar("INBOUND", { customerAvatarKey: "avatars/conv-1", customerAvatarPendingUrl: null }), false);
});

test("shouldFetchContactAvatar: never re-fetches while a capture is already queued — this is what caps Whapi calls at one per conversation, not one per message", () => {
  assert.equal(shouldFetchContactAvatar("INBOUND", { customerAvatarKey: null, customerAvatarPendingUrl: "https://pps.whatsapp.net/v/..." }), false);
});

// Regression coverage for the confirmed-live bug: group conversations were
// labeled with whichever individual member happened to send the first
// message, instead of the group's real name (resolved separately via
// maybeEnrichConversationIdentity's getGroupInfo call).

test("resolveInitialConversationSubject: a personal chat uses the sender's own from_name directly — unchanged existing behavior", () => {
  assert.equal(resolveInitialConversationSubject("923244373788@s.whatsapp.net", "Haider"), "Haider");
});

test("resolveInitialConversationSubject: a group chat NEVER uses the triggering message's from_name — this is the direct fix for the mislabeled-group bug", () => {
  assert.equal(resolveInitialConversationSubject("120363426877091849@g.us", "Itzaz khalid"), null);
});

test("resolveInitialConversationSubject: a personal chat with no from_name at all resolves to null, not a crash", () => {
  assert.equal(resolveInitialConversationSubject("923244373788@s.whatsapp.net", null), null);
  assert.equal(resolveInitialConversationSubject("923244373788@s.whatsapp.net", undefined), null);
});

test("resolveInitialConversationSubject: classification is purely from the chat_id's JID shape, never the name — identical from_name produces different results for a personal vs. a group chat_id", () => {
  const sameFromName = "Itzaz khalid";
  assert.equal(resolveInitialConversationSubject("923244373788@s.whatsapp.net", sameFromName), sameFromName);
  assert.equal(resolveInitialConversationSubject("120363426877091849@g.us", sameFromName), null);
});
