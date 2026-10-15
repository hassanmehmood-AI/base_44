import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSyncedMessageDirection,
  selectUnseenRemoteMessages,
  getCachedBrand,
  looksLikeUsableMetricoolMessageId,
  matchAlreadySentOutboundMessages,
  type BrandCache,
} from "./social";
import type { MetricoolBrand } from "@/server/integrations/metricool";

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

// Regression coverage for Stage 1's getBrand caching: must dedupe repeated
// calls for the same blogId within one sync run (the Facebook/Instagram rows
// that share a brand), but must never carry a result over from a different
// run/cache instance — that's what keeps a connection toggle on Metricool's
// side picked up on the very next poll instead of serving stale data.

function fakeBrand(id: number): MetricoolBrand {
  return { id, label: `brand-${id}`, title: `brand-${id}`, image: "", availableConnectors: [] };
}

test("getCachedBrand: a second call for the same blogId in the same cache reuses the first result", async () => {
  const cache: BrandCache = new Map();
  let calls = 0;
  const fetchBrand = async (blogId: string) => {
    calls++;
    return fakeBrand(Number(blogId));
  };

  const first = await getCachedBrand(cache, "123", fetchBrand);
  const second = await getCachedBrand(cache, "123", fetchBrand);

  assert.equal(calls, 1);
  assert.equal(first.id, 123);
  assert.equal(second.id, 123);
});

test("getCachedBrand: different blogIds in the same cache each fetch independently", async () => {
  const cache: BrandCache = new Map();
  let calls = 0;
  const fetchBrand = async (blogId: string) => {
    calls++;
    return fakeBrand(Number(blogId));
  };

  await getCachedBrand(cache, "111", fetchBrand);
  await getCachedBrand(cache, "222", fetchBrand);

  assert.equal(calls, 2);
});

test("getCachedBrand: a fresh cache (new run) never reuses a prior run's result", async () => {
  let calls = 0;
  const fetchBrand = async (blogId: string) => {
    calls++;
    return fakeBrand(Number(blogId));
  };

  const runOneCache: BrandCache = new Map();
  await getCachedBrand(runOneCache, "999", fetchBrand);

  // A brand new Map, exactly as the cron route creates per request — must
  // NOT see run one's cached entry.
  const runTwoCache: BrandCache = new Map();
  await getCachedBrand(runTwoCache, "999", fetchBrand);

  assert.equal(calls, 2);
});

// Regression coverage for Stage 2's duplicate-outgoing-message fix: confirmed
// live that Metricool's send response is not reliably a usable id (this
// account's endpoint returns the literal string "OK" on every observed send,
// both Facebook and Instagram) — looksLikeUsableMetricoolMessageId stops a
// fake value from being trusted as a dedup key, and
// matchAlreadySentOutboundMessages is the sync-side safety net that still
// prevents a duplicate when that id was never captured.

test("looksLikeUsableMetricoolMessageId: Metricool's generic acknowledgment is rejected", () => {
  assert.equal(looksLikeUsableMetricoolMessageId("OK"), false);
  assert.equal(looksLikeUsableMetricoolMessageId("ok"), false);
  assert.equal(looksLikeUsableMetricoolMessageId("  Ok  "), false);
});

test("looksLikeUsableMetricoolMessageId: null, undefined, and empty are rejected", () => {
  assert.equal(looksLikeUsableMetricoolMessageId(null), false);
  assert.equal(looksLikeUsableMetricoolMessageId(undefined), false);
  assert.equal(looksLikeUsableMetricoolMessageId(""), false);
  assert.equal(looksLikeUsableMetricoolMessageId("   "), false);
});

test("looksLikeUsableMetricoolMessageId: a real-looking id (either observed shape) is accepted", () => {
  assert.equal(looksLikeUsableMetricoolMessageId("m_hfXizJHgQkCKkKeqPd7gnfAFvt76p5QXLXS9DIAHNM8"), true);
  assert.equal(
    looksLikeUsableMetricoolMessageId("aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDc1NTM1Mjc0MzY4"),
    true
  );
});

type FakeRemoteSelfSent = { id: string; text: string; publicationDateTime: string };
type FakeLocalOutbound = { id: string; body: string; sentAt: Date };

test("matchAlreadySentOutboundMessages: duplicate prevention — a remote echo within the window matches its local send", () => {
  const local: FakeLocalOutbound[] = [{ id: "local-1", body: "hi", sentAt: new Date("2026-10-15T09:16:04.256Z") }];
  const remote: FakeRemoteSelfSent[] = [
    { id: "m_remote1", text: "hi", publicationDateTime: "2026-10-15T09:16:04.000Z" },
  ];

  const matched = matchAlreadySentOutboundMessages(remote, local);

  assert.equal(matched.size, 1);
  assert.ok(matched.has(remote[0]));
});

test("matchAlreadySentOutboundMessages: identical messages — two real back-to-back sends both still get represented, neither lost", () => {
  const local: FakeLocalOutbound[] = [
    { id: "local-1", body: "hi", sentAt: new Date("2026-10-15T09:16:04.000Z") },
    { id: "local-2", body: "hi", sentAt: new Date("2026-10-15T09:16:07.000Z") },
  ];
  const remote: FakeRemoteSelfSent[] = [
    { id: "m_remote1", text: "hi", publicationDateTime: "2026-10-15T09:16:04.300Z" },
    { id: "m_remote2", text: "hi", publicationDateTime: "2026-10-15T09:16:07.300Z" },
  ];

  const matched = matchAlreadySentOutboundMessages(remote, local);

  // Both remote echoes are matched (to their own nearest local send) — if
  // the match were ambiguous/wrong, one local row could absorb both remote
  // messages and leave the other appearing "new" (i.e. duplicated).
  assert.equal(matched.size, 2);
  assert.ok(matched.has(remote[0]));
  assert.ok(matched.has(remote[1]));
});

test("matchAlreadySentOutboundMessages: never matches by text alone — a remote message with no local counterpart stays unmatched", () => {
  const local: FakeLocalOutbound[] = [{ id: "local-1", body: "hi", sentAt: new Date("2026-10-15T09:16:04.000Z") }];
  // A genuine reply sent from Metricool's own web UI, bypassing this CRM —
  // same text, but no corresponding local row at all.
  const remote: FakeRemoteSelfSent[] = [
    { id: "m_remote1", text: "hi", publicationDateTime: "2026-10-16T12:00:00.000Z" },
  ];

  const matched = matchAlreadySentOutboundMessages(remote, local);

  assert.equal(matched.size, 0);
});

test("matchAlreadySentOutboundMessages: unmatched messages — different body text never matches regardless of timing", () => {
  const local: FakeLocalOutbound[] = [{ id: "local-1", body: "hi", sentAt: new Date("2026-10-15T09:16:04.000Z") }];
  const remote: FakeRemoteSelfSent[] = [
    { id: "m_remote1", text: "hello", publicationDateTime: "2026-10-15T09:16:04.000Z" },
  ];

  const matched = matchAlreadySentOutboundMessages(remote, local);

  assert.equal(matched.size, 0);
});

test("matchAlreadySentOutboundMessages: delayed Metricool response just inside the tolerance window still matches", () => {
  const local: FakeLocalOutbound[] = [{ id: "local-1", body: "hi", sentAt: new Date("2026-10-15T09:16:00.000Z") }];
  const remote: FakeRemoteSelfSent[] = [
    // 9.9s later — just inside the default 10s tolerance.
    { id: "m_remote1", text: "hi", publicationDateTime: "2026-10-15T09:16:09.900Z" },
  ];

  const matched = matchAlreadySentOutboundMessages(remote, local);

  assert.equal(matched.size, 1);
});

test("matchAlreadySentOutboundMessages: delayed Metricool response just outside the tolerance window is left unmatched (documented limit, not a crash)", () => {
  const local: FakeLocalOutbound[] = [{ id: "local-1", body: "hi", sentAt: new Date("2026-10-15T09:16:00.000Z") }];
  const remote: FakeRemoteSelfSent[] = [
    // 10.1s later — just outside the default 10s tolerance.
    { id: "m_remote1", text: "hi", publicationDateTime: "2026-10-15T09:16:10.100Z" },
  ];

  const matched = matchAlreadySentOutboundMessages(remote, local);

  assert.equal(matched.size, 0);
});

test("matchAlreadySentOutboundMessages: a custom tolerance window is respected", () => {
  const local: FakeLocalOutbound[] = [{ id: "local-1", body: "hi", sentAt: new Date("2026-10-15T09:16:00.000Z") }];
  const remote: FakeRemoteSelfSent[] = [
    { id: "m_remote1", text: "hi", publicationDateTime: "2026-10-15T09:16:03.000Z" },
  ];

  assert.equal(matchAlreadySentOutboundMessages(remote, local, 2).size, 0);
  assert.equal(matchAlreadySentOutboundMessages(remote, local, 5).size, 1);
});
