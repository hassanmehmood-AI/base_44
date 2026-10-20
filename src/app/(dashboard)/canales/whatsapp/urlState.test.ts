import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInitialView, resolveInitialSelectedId, buildWhatsappSearchParams } from "./whatsappUrlState";

// Regression coverage for "refresh always lands back on the Pipeline view
// and closes the open chat": page.tsx resolves the initial view/
// conversation from the URL's query params (written there by
// WhatsAppClient's own router.replace effect) via these exact pure
// functions — tested directly here, without rendering the component or
// touching Next's router, same convention as the Social Media page's own
// urlState.test.ts.

test("resolveInitialView: 'chat' in the URL is preserved — this is the direct fix for refresh-always-shows-pipeline", () => {
  assert.equal(resolveInitialView("chat"), "chat");
});

test("resolveInitialView: 'pipeline' in the URL stays 'pipeline'", () => {
  assert.equal(resolveInitialView("pipeline"), "pipeline");
});

test("resolveInitialView: a missing param (fresh visit, no query string yet) defaults to 'pipeline' — the existing, unchanged default", () => {
  assert.equal(resolveInitialView(undefined), "pipeline");
  assert.equal(resolveInitialView(null), "pipeline");
});

test("resolveInitialView: a garbled/unrecognized value degrades safely to 'pipeline' rather than erroring", () => {
  assert.equal(resolveInitialView("CHAT"), "pipeline"); // wrong case
  assert.equal(resolveInitialView("board"), "pipeline");
  assert.equal(resolveInitialView(""), "pipeline");
});

test("resolveInitialSelectedId: a requested id that's actually in the (already permission-scoped) list wins — this is the direct fix for the open-chat-closes-on-refresh bug", () => {
  const conversations = [{ id: "convo-1" }, { id: "convo-2" }];
  assert.equal(resolveInitialSelectedId("convo-2", conversations), "convo-2");
});

test("resolveInitialSelectedId: a requested id that no longer exists (deleted/inaccessible) falls back gracefully to the first conversation, never throws or leaks access", () => {
  const conversations = [{ id: "convo-1" }, { id: "convo-2" }];
  assert.equal(resolveInitialSelectedId("convo-does-not-exist", conversations), "convo-1");
});

test("resolveInitialSelectedId: no requested id and no conversations at all resolves to null (empty state), never throws", () => {
  assert.equal(resolveInitialSelectedId(undefined, []), null);
  assert.equal(resolveInitialSelectedId(null, []), null);
});

test("resolveInitialSelectedId: no requested id falls back to the first conversation — unchanged existing default behavior for a fresh visit", () => {
  const conversations = [{ id: "convo-1" }, { id: "convo-2" }];
  assert.equal(resolveInitialSelectedId(undefined, conversations), "convo-1");
});

test("buildWhatsappSearchParams: includes both view and conversationId when a conversation is selected", () => {
  const query = buildWhatsappSearchParams("chat", "convo-1");
  const parsed = new URLSearchParams(query);
  assert.equal(parsed.get("view"), "chat");
  assert.equal(parsed.get("conversationId"), "convo-1");
});

test("buildWhatsappSearchParams: omits conversationId entirely when nothing is selected (never writes an empty/null param)", () => {
  const query = buildWhatsappSearchParams("pipeline", null);
  const parsed = new URLSearchParams(query);
  assert.equal(parsed.get("view"), "pipeline");
  assert.equal(parsed.has("conversationId"), false);
});

// --- Full lifecycle: simulates opening a chat, then a refresh ---

test("full lifecycle: opening a chat, then 'refreshing' (re-resolving from the written URL), restores the exact same view and conversation", () => {
  // Step 1: user opens a conversation — selectConversation() sets
  // view='chat' alongside selecting it, which is what the client's
  // router.replace effect would write to the URL together.
  const writtenQuery = buildWhatsappSearchParams("chat", "convo-7");
  const params = new URLSearchParams(writtenQuery);

  // Step 2: "refresh" — page.tsx re-resolves initial state from that exact URL.
  const resolvedView = resolveInitialView(params.get("view"));
  const conversations = [{ id: "convo-7" }, { id: "convo-8" }];
  const resolvedSelectedId = resolveInitialSelectedId(params.get("conversationId"), conversations);

  assert.equal(resolvedView, "chat");
  assert.equal(resolvedSelectedId, "convo-7");
});

test("full lifecycle: a conversation deleted between the write and the refresh falls back gracefully instead of breaking the page", () => {
  const writtenQuery = buildWhatsappSearchParams("chat", "convo-deleted");
  const params = new URLSearchParams(writtenQuery);

  const resolvedView = resolveInitialView(params.get("view"));
  const conversations = [{ id: "convo-1" }];
  const resolvedSelectedId = resolveInitialSelectedId(params.get("conversationId"), conversations);

  assert.equal(resolvedView, "chat");
  assert.equal(resolvedSelectedId, "convo-1");
});

test("full lifecycle: switching to Pipeline view (no conversation open) and refreshing stays on Pipeline, not Chat", () => {
  const writtenQuery = buildWhatsappSearchParams("pipeline", null);
  const params = new URLSearchParams(writtenQuery);

  const resolvedView = resolveInitialView(params.get("view"));
  assert.equal(resolvedView, "pipeline");
});
