import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  isLivePbxProvisioningEnabled,
  createPbxExtension,
  setExtensionCallerId,
  deleteExtensionCallerId,
  ZadarmaProvisioningDisabledError,
  verifyWebhookSignature,
} from "./zadarma";

// This is the one thing that must never regress: every real, chargeable, or
// state-changing PBX call refuses to reach the network unless
// ZADARMA_LIVE_PBX_PROVISIONING is explicitly "true" — no network call is
// made by this suite (every assertion below proves the call was refused
// BEFORE any fetch would happen, not that a fetch succeeded or failed).

test("isLivePbxProvisioningEnabled defaults to false when the env var is unset", () => {
  delete process.env.ZADARMA_LIVE_PBX_PROVISIONING;
  assert.equal(isLivePbxProvisioningEnabled(), false);
});

test("isLivePbxProvisioningEnabled is false for anything other than the literal string \"true\"", () => {
  process.env.ZADARMA_LIVE_PBX_PROVISIONING = "1";
  assert.equal(isLivePbxProvisioningEnabled(), false);
  process.env.ZADARMA_LIVE_PBX_PROVISIONING = "TRUE";
  assert.equal(isLivePbxProvisioningEnabled(), false);
  process.env.ZADARMA_LIVE_PBX_PROVISIONING = "yes";
  assert.equal(isLivePbxProvisioningEnabled(), false);
  delete process.env.ZADARMA_LIVE_PBX_PROVISIONING;
});

test("isLivePbxProvisioningEnabled is true only for the exact literal string \"true\"", () => {
  process.env.ZADARMA_LIVE_PBX_PROVISIONING = "true";
  assert.equal(isLivePbxProvisioningEnabled(), true);
  delete process.env.ZADARMA_LIVE_PBX_PROVISIONING;
});

test("createPbxExtension refuses to run (and never reaches fetch) while the gate is off", async () => {
  delete process.env.ZADARMA_LIVE_PBX_PROVISIONING;
  await assert.rejects(() => createPbxExtension({ quantity: 1 }), ZadarmaProvisioningDisabledError);
});

test("setExtensionCallerId refuses to run while the gate is off", async () => {
  delete process.env.ZADARMA_LIVE_PBX_PROVISIONING;
  await assert.rejects(() => setExtensionCallerId("100", "+15551234567"), ZadarmaProvisioningDisabledError);
});

test("deleteExtensionCallerId refuses to run while the gate is off", async () => {
  delete process.env.ZADARMA_LIVE_PBX_PROVISIONING;
  await assert.rejects(() => deleteExtensionCallerId("100"), ZadarmaProvisioningDisabledError);
});

// verifyWebhookSignature — the webhook construction derived from Zadarma's
// own SDK source (see zadarma.ts's webhookSignatureString doc comment),
// NOT yet confirmed against a live delivery. These tests only prove the
// HMAC math round-trips and that tampering is caught — they can't prove
// Zadarma actually signs this way in practice.
const TEST_SECRET = "test-secret-never-a-real-credential";

function signForTest(toSign: string): string {
  const hex = createHmac("sha1", TEST_SECRET).update(toSign).digest("hex");
  return Buffer.from(hex, "utf8").toString("base64");
}

test("verifyWebhookSignature accepts a correctly-signed NOTIFY_END payload", () => {
  process.env.ZADARMA_API_KEY = "test-key";
  process.env.ZADARMA_API_SECRET = TEST_SECRET;
  const fields = { caller_id: "15551234567", called_did: "15559876543", call_start: "2026-01-01 00:00:00" };
  const signature = signForTest(fields.caller_id + fields.called_did + fields.call_start);
  assert.equal(verifyWebhookSignature("NOTIFY_END", fields, signature), true);
  delete process.env.ZADARMA_API_KEY;
  delete process.env.ZADARMA_API_SECRET;
});

test("verifyWebhookSignature rejects a tampered field even if the signature header is otherwise well-formed", () => {
  process.env.ZADARMA_API_KEY = "test-key";
  process.env.ZADARMA_API_SECRET = TEST_SECRET;
  const fields = { caller_id: "15551234567", called_did: "15559876543", call_start: "2026-01-01 00:00:00" };
  const signature = signForTest(fields.caller_id + fields.called_did + fields.call_start);
  const tampered = { ...fields, caller_id: "19995551234" };
  assert.equal(verifyWebhookSignature("NOTIFY_END", tampered, signature), false);
  delete process.env.ZADARMA_API_KEY;
  delete process.env.ZADARMA_API_SECRET;
});

test("verifyWebhookSignature rejects a missing signature header without throwing", () => {
  process.env.ZADARMA_API_KEY = "test-key";
  process.env.ZADARMA_API_SECRET = TEST_SECRET;
  assert.equal(verifyWebhookSignature("NOTIFY_END", { caller_id: "1", called_did: "2", call_start: "3" }, null), false);
  delete process.env.ZADARMA_API_KEY;
  delete process.env.ZADARMA_API_SECRET;
});

test("verifyWebhookSignature rejects an unrecognized event type rather than guessing a signature string", () => {
  process.env.ZADARMA_API_KEY = "test-key";
  process.env.ZADARMA_API_SECRET = TEST_SECRET;
  assert.equal(verifyWebhookSignature("NOTIFY_SOMETHING_NEW", {}, "anything"), false);
  delete process.env.ZADARMA_API_KEY;
  delete process.env.ZADARMA_API_SECRET;
});
