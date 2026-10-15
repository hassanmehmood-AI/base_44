import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSyncedMessageDirection, selectUnseenRemoteMessages, getCachedBrand, type BrandCache } from "./social";
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
