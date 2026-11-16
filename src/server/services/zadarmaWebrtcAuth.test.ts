import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyError, resolveFullSipLogin } from "./zadarmaWebrtcAuth";
import { ZadarmaAuthError, ZadarmaRateLimitError, ZadarmaNetworkError, ZadarmaProvisioningDisabledError } from "@/server/integrations/zadarma";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";

// Pure classification logic only — no database, no network, no session.

test("classifyError maps the provisioning-disabled gate to its own distinct reason", () => {
  assert.equal(classifyError(new ZadarmaProvisioningDisabledError("mint a WebRTC key")).reason, "provisioning_disabled");
});

test("classifyError maps every other known error type to its own distinct reason", () => {
  assert.equal(classifyError(new ProviderNotConfiguredError("Zadarma", ["ZADARMA_API_KEY"])).reason, "not_configured");
  assert.equal(classifyError(new ZadarmaAuthError("bad creds")).reason, "auth");
  assert.equal(classifyError(new ZadarmaRateLimitError("slow down")).reason, "rate_limit");
  assert.equal(classifyError(new ZadarmaNetworkError("no response")).reason, "network");
  assert.equal(classifyError(new Error("something else")).reason, "error");
  assert.equal(classifyError("not an Error at all").reason, "error");
});

// resolveFullSipLogin — only the short-circuit path is testable without a
// real/mocked network call (this codebase has no mocking framework; other
// tests avoid real I/O the same way). The live pbxId-fetching branch needs
// a real account and is covered by manual testing, not this suite.

test("resolveFullSipLogin leaves an already-full SIP login (containing '-') unchanged, never double-prefixing it", async () => {
  assert.equal(await resolveFullSipLogin("588158-100"), "588158-100");
});
