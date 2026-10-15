import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSyncedMessageDirection, selectUnseenRemoteMessages } from "./social";

// Regression coverage for the Metricool sync bug where a reply sent through
// this CRM re-appeared as a second, mislabeled INBOUND message once the next
// poll fetched it back from Metricool (see commit introducing this file).

test("resolveSyncedMessageDirection: brand's own id -> OUTBOUND", () => {
  assert.equal(resolveSyncedMessageDirection("brand-123", "brand-123"), "OUTBOUND");
});

test("resolveSyncedMessageDirection: any other id -> INBOUND", () => {
  assert.equal(resolveSyncedMessageDirection("customer-456", "brand-123"), "INBOUND");
});

test("resolveSyncedMessageDirection: never inferred from message text or position — only the id matters", () => {
  // Two different senders sending the exact same text must still resolve
  // independently, purely from id equality against `self`.
  assert.equal(resolveSyncedMessageDirection("brand-123", "brand-123"), "OUTBOUND");
  assert.equal(resolveSyncedMessageDirection("brand-123", "customer-456"), "INBOUND");
});

type FakeRemoteMessage = { id: string; publicationDateTime: string };

test("selectUnseenRemoteMessages: a message already stored (by id) is never re-selected", () => {
  // This is the exact shape of the original bug: a CRM-sent reply, once it
  // shows up in Metricool's response, must be filtered out here because its
  // id is already in seenExternalIds — not re-inserted as a "new" message.
  const remote: FakeRemoteMessage[] = [
    { id: "msg-1", publicationDateTime: "2026-01-01T00:00:00Z" },
    { id: "msg-2-already-sent-via-crm", publicationDateTime: "2026-01-01T00:01:00Z" },
  ];
  const seen = new Set(["msg-2-already-sent-via-crm"]);

  const result = selectUnseenRemoteMessages(remote, seen);

  assert.deepEqual(result.map((m) => m.id), ["msg-1"]);
});

test("selectUnseenRemoteMessages: identical text from two distinct remote ids is never deduped by text", () => {
  const remote: FakeRemoteMessage[] = [
    { id: "msg-a", publicationDateTime: "2026-01-01T00:00:00Z" },
    { id: "msg-b", publicationDateTime: "2026-01-01T00:05:00Z" },
  ];

  const result = selectUnseenRemoteMessages(remote, new Set<string>());

  assert.equal(result.length, 2);
});

test("selectUnseenRemoteMessages: orders chronologically regardless of input order", () => {
  const remote: FakeRemoteMessage[] = [
    { id: "later", publicationDateTime: "2026-01-01T00:05:00Z" },
    { id: "earlier", publicationDateTime: "2026-01-01T00:00:00Z" },
  ];

  const result = selectUnseenRemoteMessages(remote, new Set<string>());

  assert.deepEqual(result.map((m) => m.id), ["earlier", "later"]);
});
