import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAvatarCapturedNotifyPayload } from "./conversations";

// Regression coverage for the avatar-completion realtime notification — the
// payload shape here MUST exactly match what scripts/realtime-ws-service's
// server.ts expects from `JSON.parse(msg.payload)` (confirmed by reading
// that file directly, not guessed): conversationId/companyId required (a
// notification missing either is silently dropped there), messageId read
// as `parsed.messageId ?? null`. This is pure JSON-shape logic — no
// database or network call — so it's tested directly here, same
// "test the pure logic, not the DB orchestration" convention already used
// throughout this codebase (e.g. social.ts's resolveSyncedMessageDirection).

test("buildAvatarCapturedNotifyPayload: produces the exact shape the relay's server.ts expects", () => {
  const payload = buildAvatarCapturedNotifyPayload("conv-1", "company-1");
  const parsed = JSON.parse(payload);
  assert.deepEqual(parsed, { conversationId: "conv-1", companyId: "company-1", messageId: null });
});

test("buildAvatarCapturedNotifyPayload: always carries the exact companyId passed in — this is what the relay's company isolation (io.to(`company:${companyId}`)) actually relies on", () => {
  const payloadA = JSON.parse(buildAvatarCapturedNotifyPayload("conv-1", "company-A"));
  const payloadB = JSON.parse(buildAvatarCapturedNotifyPayload("conv-1", "company-B"));
  assert.equal(payloadA.companyId, "company-A");
  assert.equal(payloadB.companyId, "company-B");
  // Never cross-contaminated — company-A's payload never carries company-B's id.
  assert.notEqual(payloadA.companyId, payloadB.companyId);
});

test("buildAvatarCapturedNotifyPayload: messageId is always null (this notify is about an avatar, never a message) — matches the relay's own documented `?? null` fallback, not a workaround", () => {
  const parsed = JSON.parse(buildAvatarCapturedNotifyPayload("conv-1", "company-1"));
  assert.equal(parsed.messageId, null);
});

test("buildAvatarCapturedNotifyPayload: produces valid, parseable JSON for any conversationId/companyId pair", () => {
  assert.doesNotThrow(() => JSON.parse(buildAvatarCapturedNotifyPayload("c", "co")));
});
