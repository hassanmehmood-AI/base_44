import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRefreshDetailForEvent } from "./RedesSocialesClient";

// Regression coverage for the real-time refresh decision — in particular,
// that a resync/reconnect event (alwaysRefreshDetail: true) always refreshes
// the open conversation detail regardless of which conversationId, if any,
// the triggering event carried, since neither a reconnect nor a resync
// broadcast can say what (if anything) was actually missed.

test("alwaysRefreshDetail true: refreshes regardless of conversationId or selection", () => {
  assert.equal(shouldRefreshDetailForEvent({ alwaysRefreshDetail: true, conversationId: null }, "selected-1"), true);
  assert.equal(shouldRefreshDetailForEvent({ alwaysRefreshDetail: true, conversationId: "other" }, "selected-1"), true);
  assert.equal(shouldRefreshDetailForEvent({ alwaysRefreshDetail: true, conversationId: null }, null), true);
});

test("a targeted event matching the currently selected conversation refreshes detail", () => {
  assert.equal(
    shouldRefreshDetailForEvent({ alwaysRefreshDetail: false, conversationId: "convo-1" }, "convo-1"),
    true
  );
});

test("a targeted event for a DIFFERENT conversation than the one selected does not refresh detail", () => {
  assert.equal(
    shouldRefreshDetailForEvent({ alwaysRefreshDetail: false, conversationId: "convo-1" }, "convo-2"),
    false
  );
});

test("a targeted event with no conversation currently selected does not refresh detail", () => {
  assert.equal(shouldRefreshDetailForEvent({ alwaysRefreshDetail: false, conversationId: "convo-1" }, null), false);
});

test("an event with no conversationId and no forced refresh never refreshes detail", () => {
  assert.equal(shouldRefreshDetailForEvent({ alwaysRefreshDetail: false, conversationId: null }, "convo-1"), false);
  assert.equal(shouldRefreshDetailForEvent({ alwaysRefreshDetail: false, conversationId: null }, null), false);
});
