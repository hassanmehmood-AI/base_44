import { test } from "node:test";
import assert from "node:assert/strict";
import { isAmbiguousFailure } from "./whapiOnboarding";
import { WhapiApiError } from "@/server/integrations/whapi";

// Regression coverage for the duplicate-paid-channel safety classification:
// this decides whether a failed createChannel call is safely auto-retryable
// (FAILED) or must wait for a human to check Whapi's dashboard first
// (FAILED_NEEDS_MANUAL_CHECK) — see createChannelForCompany's doc comment.
// No database or network call is made by this suite.

test("a clean 4xx (Whapi rejected the request before creating anything) is NOT ambiguous", () => {
  assert.equal(isAmbiguousFailure(new WhapiApiError(400, "bad request")), false);
  assert.equal(isAmbiguousFailure(new WhapiApiError(404, "project not found")), false);
  assert.equal(isAmbiguousFailure(new WhapiApiError(403, "channel limit reached")), false);
});

test("a persistent 5xx after retries exhausted IS ambiguous", () => {
  assert.equal(isAmbiguousFailure(new WhapiApiError(500, "internal error")), true);
  assert.equal(isAmbiguousFailure(new WhapiApiError(503, "unavailable")), true);
});

test("a thrown network/timeout error (not even a WhapiApiError) IS ambiguous", () => {
  assert.equal(isAmbiguousFailure(new TypeError("fetch failed")), true);
  assert.equal(isAmbiguousFailure(new Error("timeout")), true);
  assert.equal(isAmbiguousFailure("not even an Error instance"), true);
});
