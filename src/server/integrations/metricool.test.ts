import { test } from "node:test";
import assert from "node:assert/strict";
import { getBrand } from "./metricool";

// Regression coverage for Stage 1's retry/backoff: metricoolFetch must retry
// transient failures (429/5xx) and give up immediately on anything else, so
// a flaky Metricool response doesn't abort an entire sync tick, while a
// genuine client error (bad request, auth failure, etc.) still fails fast.

function mockFetchSequence(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  let call = 0;
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url));
    const next = responses[Math.min(call, responses.length - 1)];
    call++;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers,
    });
  }) as typeof fetch;
  return {
    callCount: () => call,
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("metricoolFetch (via getBrand): succeeds immediately on a clean 200, no retries", async () => {
  process.env.METRICOOL_API_TOKEN = "test-token";
  process.env.METRICOOL_USER_ID = "test-user";
  const mock = mockFetchSequence([{ status: 200, body: { data: { id: 1, label: "Test" } } }]);
  try {
    const brand = await getBrand("blog-1");
    assert.equal(brand.id, 1);
    assert.equal(mock.callCount(), 1);
  } finally {
    mock.restore();
  }
});

test("metricoolFetch: retries a 429 and succeeds on the next attempt", async () => {
  process.env.METRICOOL_API_TOKEN = "test-token";
  process.env.METRICOOL_USER_ID = "test-user";
  // Retry-After: 0 keeps this test fast — it still exercises the
  // header-priority branch of the backoff calculation, just with no delay.
  const mock = mockFetchSequence([
    { status: 429, body: { message: "Rate limited" }, headers: { "Retry-After": "0" } },
    { status: 200, body: { data: { id: 2, label: "Test" } } },
  ]);
  try {
    const brand = await getBrand("blog-2");
    assert.equal(brand.id, 2);
    assert.equal(mock.callCount(), 2);
  } finally {
    mock.restore();
  }
});

test("metricoolFetch: retries persistent 5xx up to the cap, then throws", async () => {
  process.env.METRICOOL_API_TOKEN = "test-token";
  process.env.METRICOOL_USER_ID = "test-user";
  const mock = mockFetchSequence([
    { status: 503, body: { message: "Service unavailable" }, headers: { "Retry-After": "0" } },
  ]);
  try {
    await assert.rejects(() => getBrand("blog-3"), /Metricool API error \(503\)/);
    // 1 initial attempt + 3 retries = 4 total calls, per MAX_RETRY_ATTEMPTS.
    assert.equal(mock.callCount(), 4);
  } finally {
    mock.restore();
  }
});

test("metricoolFetch: a non-retryable 4xx fails immediately with no retries", async () => {
  process.env.METRICOOL_API_TOKEN = "test-token";
  process.env.METRICOOL_USER_ID = "test-user";
  const mock = mockFetchSequence([{ status: 400, body: { message: "Bad request" } }]);
  try {
    await assert.rejects(() => getBrand("blog-4"), /Metricool API error \(400\)/);
    assert.equal(mock.callCount(), 1);
  } finally {
    mock.restore();
  }
});
