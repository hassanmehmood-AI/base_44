import { test } from "node:test";
import assert from "node:assert/strict";
import { isAmbiguousFailure, classifyError, extractCallerId, evaluateReactivation, isAmbiguousCallerId } from "./zadarmaExtensionOnboarding";
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

// evaluateReactivation / isAmbiguousCallerId — the "Reactivate a REVOKED
// SIP extension" feature's pure decision logic. No database or network
// call is made by this suite; every fact the decision needs is passed in
// directly, same approach as the suites above.

test("isAmbiguousCallerId recognizes every known non-comparable value, case/whitespace-insensitively", () => {
  assert.equal(isAmbiguousCallerId("External line"), true);
  assert.equal(isAmbiguousCallerId("  UNKNOWN  "), true);
  assert.equal(isAmbiguousCallerId(""), true);
  assert.equal(isAmbiguousCallerId("+15551234567"), false);
});

test("evaluateReactivation: a real, active extension whose Caller ID genuinely matches the company's active number succeeds", () => {
  const result = evaluateReactivation({
    currentStatus: "REVOKED",
    agentAlreadyHasExtension: false,
    existsOnZadarmaAccount: true,
    reportedCallerId: "+15551234567",
    companyActiveNumber: "+15551234567",
  });
  assert.deepEqual(result, { ok: true });
});

test("evaluateReactivation: a Caller ID differing only by a leading '+' is the SAME number, and must succeed, not be refused as a mismatch", () => {
  // Real-world case: Zadarma's getPbxExtensionInfo reported "+34865443004"
  // while this company's stored zadarma_numbers.number is "34865443004" —
  // identical real number, different formatting. A naive !== comparison
  // wrongly refused reactivation here; phonesMatch (used elsewhere in this
  // codebase for the exact same problem) is what evaluateReactivation must
  // use instead.
  const result = evaluateReactivation({
    currentStatus: "REVOKED",
    agentAlreadyHasExtension: false,
    existsOnZadarmaAccount: true,
    reportedCallerId: "+34865443004",
    companyActiveNumber: "34865443004",
  });
  assert.deepEqual(result, { ok: true });
});

test("evaluateReactivation: a genuine Caller ID mismatch is refused with a distinct reason, never silently relinked", () => {
  const result = evaluateReactivation({
    currentStatus: "REVOKED",
    agentAlreadyHasExtension: false,
    existsOnZadarmaAccount: true,
    reportedCallerId: "+15551234567",
    companyActiveNumber: "+19998887777",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "caller_id_mismatch");
    assert.match(result.message, /\+15551234567/);
    assert.match(result.message, /\+19998887777/);
  }
});

test("evaluateReactivation: an ambiguous Caller ID (e.g. Zadarma's 'External line') is refused, never treated as a match", () => {
  const result = evaluateReactivation({
    currentStatus: "REVOKED",
    agentAlreadyHasExtension: false,
    existsOnZadarmaAccount: true,
    reportedCallerId: "External line",
    companyActiveNumber: "+15551234567",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "caller_id_ambiguous");
});

test("evaluateReactivation: a null/absent Caller ID is treated the same as ambiguous, never silently approved", () => {
  const result = evaluateReactivation({
    currentStatus: "REVOKED",
    agentAlreadyHasExtension: false,
    existsOnZadarmaAccount: true,
    reportedCallerId: null,
    companyActiveNumber: "+15551234567",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "caller_id_ambiguous");
});

test("evaluateReactivation: a non-REVOKED extension (e.g. already ACTIVE, or PENDING) is refused before any Caller ID reasoning", () => {
  for (const status of ["ACTIVE", "PENDING", "FAILED", "FAILED_NEEDS_MANUAL_CHECK"] as const) {
    const result = evaluateReactivation({
      currentStatus: status,
      agentAlreadyHasExtension: false,
      existsOnZadarmaAccount: true,
      reportedCallerId: "+15551234567",
      companyActiveNumber: "+15551234567",
    });
    assert.equal(result.ok, false, `status ${status} must be refused`);
    if (!result.ok) assert.equal(result.reason, "not_revoked");
  }
});

test("evaluateReactivation: an agent who already holds a different active/pending extension is refused — one agent, one extension", () => {
  const result = evaluateReactivation({
    currentStatus: "REVOKED",
    agentAlreadyHasExtension: true,
    existsOnZadarmaAccount: true,
    reportedCallerId: "+15551234567",
    companyActiveNumber: "+15551234567",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "already_has_extension");
});

test("evaluateReactivation: an extension no longer found on the real Zadarma account is refused, never reactivated against a phantom number", () => {
  const result = evaluateReactivation({
    currentStatus: "REVOKED",
    agentAlreadyHasExtension: false,
    existsOnZadarmaAccount: false,
    reportedCallerId: "+15551234567",
    companyActiveNumber: "+15551234567",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_found_on_account");
});

test("evaluateReactivation: a company with no active Zadarma number at all is refused — nothing to verify the Caller ID against", () => {
  const result = evaluateReactivation({
    currentStatus: "REVOKED",
    agentAlreadyHasExtension: false,
    existsOnZadarmaAccount: true,
    reportedCallerId: "+15551234567",
    companyActiveNumber: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "no_number");
});
