import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInitialPlatform, resolveInitialSelectedId, buildSocialMediaSearchParams } from "./socialPlatformUrl";

// Regression coverage for "refresh resets to the Facebook tab and closes
// the open chat": page.tsx resolves the initial platform/conversation from
// the URL's query params (written there by RedesSocialesClient's own
// router.replace effect) via these exact pure functions — tested directly
// here, without rendering the component or touching Next's router, same
// convention as shouldRefreshDetailForEvent in useSocialRealtime.test.ts.

test("resolveInitialPlatform: INSTAGRAM in the URL is preserved — this is the direct fix for the Instagram-tab-resets-to-Facebook bug", () => {
  assert.equal(resolveInitialPlatform("INSTAGRAM"), "INSTAGRAM");
});

test("resolveInitialPlatform: FACEBOOK in the URL stays FACEBOOK", () => {
  assert.equal(resolveInitialPlatform("FACEBOOK"), "FACEBOOK");
});

test("resolveInitialPlatform: a missing param (fresh visit, no query string yet) defaults to FACEBOOK — the existing, unchanged default", () => {
  assert.equal(resolveInitialPlatform(undefined), "FACEBOOK");
  assert.equal(resolveInitialPlatform(null), "FACEBOOK");
});

test("resolveInitialPlatform: a garbled/unrecognized value degrades safely to FACEBOOK rather than erroring", () => {
  assert.equal(resolveInitialPlatform("instagram"), "FACEBOOK"); // wrong case
  assert.equal(resolveInitialPlatform("TIKTOK"), "FACEBOOK");
  assert.equal(resolveInitialPlatform(""), "FACEBOOK");
});

test("resolveInitialSelectedId: a requested id that's actually in the (already company/platform-scoped) list wins — this is the direct fix for the open-chat-closes-on-refresh bug", () => {
  const platformConversations = [{ id: "convo-1" }, { id: "convo-2" }];
  assert.equal(resolveInitialSelectedId("convo-2", platformConversations), "convo-2");
});

test("resolveInitialSelectedId: a requested id that no longer exists (deleted/inaccessible) falls back gracefully to the first conversation, never throws or leaks access", () => {
  const platformConversations = [{ id: "convo-1" }, { id: "convo-2" }];
  assert.equal(resolveInitialSelectedId("convo-does-not-exist", platformConversations), "convo-1");
});

test("resolveInitialSelectedId: a requested id belonging to the OTHER platform's conversations (not in this platform's scoped list) also falls back gracefully — never cross-platform leakage", () => {
  // Simulates: URL says conversationId=X, but X is a Facebook conversation
  // and the resolved platform for this load is Instagram — the Instagram
  // tab's own conversations list won't contain X, so it must fall back,
  // never silently render a Facebook conversation under the Instagram tab.
  const instagramConversations = [{ id: "ig-convo-1" }];
  assert.equal(resolveInitialSelectedId("fb-convo-99", instagramConversations), "ig-convo-1");
});

test("resolveInitialSelectedId: no requested id and no conversations at all resolves to null (empty state), never throws", () => {
  assert.equal(resolveInitialSelectedId(undefined, []), null);
  assert.equal(resolveInitialSelectedId(null, []), null);
});

test("resolveInitialSelectedId: no requested id falls back to the first conversation — unchanged existing default behavior for a fresh visit", () => {
  const platformConversations = [{ id: "convo-1" }, { id: "convo-2" }];
  assert.equal(resolveInitialSelectedId(undefined, platformConversations), "convo-1");
});

test("buildSocialMediaSearchParams: includes both platform and conversationId when a conversation is selected", () => {
  const query = buildSocialMediaSearchParams("INSTAGRAM", "convo-1");
  const parsed = new URLSearchParams(query);
  assert.equal(parsed.get("platform"), "INSTAGRAM");
  assert.equal(parsed.get("conversationId"), "convo-1");
});

test("buildSocialMediaSearchParams: omits conversationId entirely when nothing is selected (never writes an empty/null param)", () => {
  const query = buildSocialMediaSearchParams("FACEBOOK", null);
  const parsed = new URLSearchParams(query);
  assert.equal(parsed.get("platform"), "FACEBOOK");
  assert.equal(parsed.has("conversationId"), false);
});

// --- Full lifecycle: simulates switching tabs/conversations, then a refresh ---

test("full lifecycle: switching to Instagram and opening a conversation, then 'refreshing' (re-resolving from the written URL), restores the exact same tab and conversation", () => {
  // Step 1: user switches to Instagram and opens a conversation — this is
  // what the client's router.replace effect would write to the URL.
  const writtenQuery = buildSocialMediaSearchParams("INSTAGRAM", "ig-convo-7");
  const params = new URLSearchParams(writtenQuery);

  // Step 2: "refresh" — page.tsx re-resolves initial state from that exact URL.
  const resolvedPlatform = resolveInitialPlatform(params.get("platform"));
  const instagramConversations = [{ id: "ig-convo-7" }, { id: "ig-convo-8" }];
  const resolvedSelectedId = resolveInitialSelectedId(params.get("conversationId"), instagramConversations);

  assert.equal(resolvedPlatform, "INSTAGRAM");
  assert.equal(resolvedSelectedId, "ig-convo-7");
});

test("full lifecycle: a conversation deleted between the write and the refresh falls back gracefully instead of breaking the page", () => {
  const writtenQuery = buildSocialMediaSearchParams("FACEBOOK", "fb-convo-deleted");
  const params = new URLSearchParams(writtenQuery);

  const resolvedPlatform = resolveInitialPlatform(params.get("platform"));
  // The previously-open conversation no longer exists in the fresh list.
  const facebookConversations = [{ id: "fb-convo-1" }];
  const resolvedSelectedId = resolveInitialSelectedId(params.get("conversationId"), facebookConversations);

  assert.equal(resolvedPlatform, "FACEBOOK");
  assert.equal(resolvedSelectedId, "fb-convo-1");
});
