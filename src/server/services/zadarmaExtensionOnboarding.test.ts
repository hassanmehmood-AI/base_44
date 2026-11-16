import { test } from "node:test";
import assert from "node:assert/strict";
import { isAmbiguousFailure, classifyError, extractCallerId } from "./zadarmaExtensionOnboarding";
import { ZadarmaAuthError, ZadarmaRateLimitError, ZadarmaApiError, ZadarmaNetworkError, ZadarmaProvisioningDisabledError } from "@/server/integrations/zadarma";
import { UnauthorizedError } from "@/server/services/authorization";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";

// Regression coverage for the duplicate-paid-extension safety classification
// — decides whether a failed createPbxExtension call is safely auto-
// retryable (FAILED) or must wait for a human to check Zadarma's dashboard
// first (FAILED_NEEDS_MANUAL_CHECK). No database or network call is made by
// this suite — mirrors whapiOnboarding.test.ts / the existing Zadarma number
// onboarding tests' approach exactly.

test("a clean rejection from Zadarma itself is NOT ambiguous", () => {
  assert.equal(isAmbiguousFailure(new ZadarmaAuthError("bad credentials")), false);
  assert.equal(isAmbiguousFailure(new ZadarmaRateLimitError("rate limited")), false);
  assert.equal(isAmbiguousFailure(new ZadarmaApiError("limit exceeded")), false);
});

test("our own provisioning-disabled gate refusing the call is NOT ambiguous — nothing was ever sent to Zadarma", () => {
  assert.equal(isAmbiguousFailure(new ZadarmaProvisioningDisabledError("create a PBX extension")), false);
});

test("a genuine network-level failure (no real response ever arrived) IS ambiguous", () => {
  assert.equal(isAmbiguousFailure(new ZadarmaNetworkError("fetch failed")), true);
  assert.equal(isAmbiguousFailure(new TypeError("fetch failed")), true);
  assert.equal(isAmbiguousFailure("not even an Error instance"), true);
});

test("classifyError maps the provisioning-disabled gate to its own distinct reason, never confused with a real Zadarma rejection", () => {
  const { reason, message } = classifyError(new ZadarmaProvisioningDisabledError("create a PBX extension"));
  assert.equal(reason, "provisioning_disabled");
  assert.match(message, /ZADARMA_LIVE_PBX_PROVISIONING/);
});

test("classifyError maps every other known error type to its own distinct reason", () => {
  assert.equal(classifyError(new ProviderNotConfiguredError("Zadarma", ["ZADARMA_API_KEY"])).reason, "not_configured");
  assert.equal(classifyError(new UnauthorizedError("nope")).reason, "unauthorized");
  assert.equal(classifyError(new ZadarmaAuthError("bad creds")).reason, "auth");
  assert.equal(classifyError(new ZadarmaRateLimitError("slow down")).reason, "rate_limit");
  assert.equal(classifyError(new ZadarmaNetworkError("no response")).reason, "network");
  assert.equal(classifyError(new Error("something else")).reason, "error");
  assert.equal(classifyError("not an Error at all").reason, "error");
});

// extractCallerId — "Add Existing SIP"'s best-effort read of Zadarma's
// getPbxExtensionInfo() response, whose real field names are unconfirmed
// (see zadarma.ts's ZadarmaPbxExtensionInfo comment). This must never
// fabricate a value for a field name that isn't actually present.

test("extractCallerId finds the Caller ID under any of the plausible real field names", () => {
  assert.equal(extractCallerId({ sip: "105", caller_id: "+15551234567" }), "+15551234567");
  assert.equal(extractCallerId({ sip: "105", callerid: "+15551234567" }), "+15551234567");
  assert.equal(extractCallerId({ sip: "105", callerId: "+15551234567" }), "+15551234567");
  assert.equal(extractCallerId({ sip: "105", caller_id_number: "+15551234567" }), "+15551234567");
});

test("extractCallerId returns null rather than guessing when none of the known field names are present", () => {
  assert.equal(extractCallerId({ sip: "105", some_other_field: "+15551234567" }), null);
  assert.equal(extractCallerId({ sip: "105" }), null);
});

test("extractCallerId ignores a non-string value under a known field name rather than returning garbage", () => {
  assert.equal(extractCallerId({ sip: "105", caller_id: 12345 }), null);
  assert.equal(extractCallerId({ sip: "105", caller_id: null }), null);
});
