import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedAvatarHost,
  isAllowedContentType,
  shouldAbandonPendingCapture,
  downloadAvatarBytes,
} from "./avatarCapture";

// Regression coverage for the permanent-avatar-storage feature (Phase 3).
// These test the pure validation/decision logic plus downloadAvatarBytes's
// SSRF-sensitive redirect handling via a fake global fetch — the same
// technique metricool.test.ts already uses — never a real network call or
// database.

test("isAllowedAvatarHost: Meta Graph API hosts are allowed", () => {
  assert.equal(isAllowedAvatarHost("graph.facebook.com"), true);
  assert.equal(isAllowedAvatarHost("graph.instagram.com"), true);
  assert.equal(isAllowedAvatarHost("GRAPH.FACEBOOK.COM"), true);
});

test("isAllowedAvatarHost: Meta CDN host suffixes are allowed", () => {
  assert.equal(isAllowedAvatarHost("scontent.xx.fbcdn.net"), true);
  assert.equal(isAllowedAvatarHost("platform-lookaside.fbsbx.com"), true);
  assert.equal(isAllowedAvatarHost("scontent-iad3-1.cdninstagram.com"), true);
});

test("isAllowedAvatarHost: an arbitrary/attacker-controlled host is rejected (SSRF guard)", () => {
  assert.equal(isAllowedAvatarHost("evil.example.com"), false);
  assert.equal(isAllowedAvatarHost("localhost"), false);
  assert.equal(isAllowedAvatarHost("169.254.169.254"), false);
  // Not fooled by a host that merely contains the allowed suffix as a
  // substring rather than a true subdomain.
  assert.equal(isAllowedAvatarHost("fbcdn.net.evil.com"), false);
  assert.equal(isAllowedAvatarHost("notfbcdn.net"), false);
});

// Regression coverage for widening the allowlist to support WhatsApp (Whapi.Cloud)
// avatars — confirms the new entry works AND that it never weakens the
// existing Meta-only checks above (same two tests, unmodified, still pass).
test("isAllowedAvatarHost: WhatsApp's own profile-picture CDN host is allowed", () => {
  assert.equal(isAllowedAvatarHost("pps.whatsapp.net"), true);
  assert.equal(isAllowedAvatarHost("PPS.WHATSAPP.NET"), true);
});

test("isAllowedAvatarHost: a lookalike WhatsApp host is still rejected (SSRF guard holds for the new entry too)", () => {
  assert.equal(isAllowedAvatarHost("pps.whatsapp.net.evil.com"), false);
  assert.equal(isAllowedAvatarHost("notpps.whatsapp.net"), false);
});

test("isAllowedContentType: common image types are allowed", () => {
  assert.equal(isAllowedContentType("image/jpeg"), true);
  assert.equal(isAllowedContentType("image/png"), true);
  assert.equal(isAllowedContentType("image/webp; charset=binary"), true);
});

test("isAllowedContentType: non-image or missing content-type is rejected", () => {
  assert.equal(isAllowedContentType("text/html"), false);
  assert.equal(isAllowedContentType("application/json"), false);
  assert.equal(isAllowedContentType(null), false);
  assert.equal(isAllowedContentType(undefined), false);
  assert.equal(isAllowedContentType(""), false);
});

test("shouldAbandonPendingCapture: abandons once the attempt cap is reached", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  const firstSeenAt = new Date("2026-10-16T11:59:50Z"); // 10s ago, well within the time budget
  assert.equal(shouldAbandonPendingCapture(3, firstSeenAt, now), true);
  assert.equal(shouldAbandonPendingCapture(2, firstSeenAt, now), false);
});

test("shouldAbandonPendingCapture: abandons once the time budget is exceeded, regardless of attempt count", () => {
  const now = new Date("2026-10-16T12:10:01Z");
  const firstSeenAt = new Date("2026-10-16T12:00:00Z"); // just over 10 minutes ago
  assert.equal(shouldAbandonPendingCapture(1, firstSeenAt, now), true);
});

test("shouldAbandonPendingCapture: keeps retrying when neither cap is hit", () => {
  const now = new Date("2026-10-16T12:00:30Z");
  const firstSeenAt = new Date("2026-10-16T12:00:00Z"); // 30s ago
  assert.equal(shouldAbandonPendingCapture(1, firstSeenAt, now), false);
});

// --- downloadAvatarBytes ---------------------------------------------------

type FakeResponder = (url: string) => { status: number; headers?: Record<string, string>; body?: Uint8Array };

function withFakeFetch(responder: FakeResponder, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    const def = responder(url);
    const headers = new Headers(def.headers ?? {});
    let body: ArrayBuffer | null = null;
    if (def.body) {
      body = new ArrayBuffer(def.body.byteLength);
      new Uint8Array(body).set(def.body);
    }
    return new Response(body, { status: def.status, headers });
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("downloadAvatarBytes: a disallowed host is rejected before any fetch is attempted", async () => {
  let fetchCalled = false;
  await withFakeFetch(
    () => {
      fetchCalled = true;
      return { status: 200 };
    },
    async () => {
      await assert.rejects(() => downloadAvatarBytes("https://evil.example.com/x.jpg"), /allowlist/);
    }
  );
  assert.equal(fetchCalled, false);
});

test("downloadAvatarBytes: success on an allowed host with a valid image response", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  await withFakeFetch(
    () => ({ status: 200, headers: { "content-type": "image/jpeg" }, body: bytes }),
    async () => {
      const result = await downloadAvatarBytes("https://graph.facebook.com/123/picture");
      assert.deepEqual([...result.bytes], [1, 2, 3, 4]);
      assert.equal(result.contentType, "image/jpeg");
    }
  );
});

test("downloadAvatarBytes: follows a redirect to another ALLOWED host and succeeds", async () => {
  const bytes = new Uint8Array([9, 9]);
  await withFakeFetch(
    (url) => {
      if (url.includes("graph.facebook.com")) {
        return { status: 302, headers: { location: "https://scontent.fbcdn.net/final.jpg" } as Record<string, string> };
      }
      return { status: 200, headers: { "content-type": "image/png" }, body: bytes };
    },
    async () => {
      const result = await downloadAvatarBytes("https://graph.facebook.com/123/picture");
      assert.deepEqual([...result.bytes], [9, 9]);
    }
  );
});

test("downloadAvatarBytes: a redirect to a DISALLOWED host is rejected, not followed (SSRF guard)", async () => {
  await withFakeFetch(
    (url) => {
      if (url.includes("graph.facebook.com")) {
        return { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } as Record<string, string> };
      }
      return { status: 200, headers: { "content-type": "image/jpeg" }, body: new Uint8Array([1]) };
    },
    async () => {
      await assert.rejects(() => downloadAvatarBytes("https://graph.facebook.com/123/picture"), /allowlist/);
    }
  );
});

test("downloadAvatarBytes: a non-2xx response (e.g. expired appsecret_time) is rejected", async () => {
  await withFakeFetch(
    () => ({ status: 400 }),
    async () => {
      await assert.rejects(() => downloadAvatarBytes("https://graph.facebook.com/123/picture"), /status 400/);
    }
  );
});

test("downloadAvatarBytes: a disallowed content-type is rejected even on a 200", async () => {
  await withFakeFetch(
    () => ({ status: 200, headers: { "content-type": "text/html" }, body: new Uint8Array([1]) }),
    async () => {
      await assert.rejects(() => downloadAvatarBytes("https://graph.facebook.com/123/picture"), /content-type/);
    }
  );
});

test("downloadAvatarBytes: a response exceeding the max size is rejected", async () => {
  const huge = new Uint8Array(6 * 1024 * 1024); // over the 5MB cap
  await withFakeFetch(
    () => ({ status: 200, headers: { "content-type": "image/jpeg" }, body: huge }),
    async () => {
      await assert.rejects(() => downloadAvatarBytes("https://graph.facebook.com/123/picture"), /max allowed size/);
    }
  );
});
