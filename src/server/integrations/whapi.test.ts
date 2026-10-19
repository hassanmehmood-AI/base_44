import { test } from "node:test";
import assert from "node:assert/strict";
import { createChannel, getQrCode, getChannelHealth, setWebhook, sendTextMessage, isWhapiPartnerConfigured, WhapiApiError } from "./whapi";

// Same mocked-fetch regression style as integrations/metricool.test.ts — no
// real Whapi call is ever made by this suite, and no paid channel is ever
// created. Every test sets its own env vars and restores globalThis.fetch.

function mockFetchSequence(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  let call = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(call, responses.length - 1)];
    call++;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: next.headers });
  }) as typeof fetch;
  return {
    callCount: () => call,
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("isWhapiPartnerConfigured is false unless both partner env vars are set", () => {
  delete process.env.WHAPI_PARTNER_TOKEN;
  delete process.env.WHAPI_PROJECT_ID;
  assert.equal(isWhapiPartnerConfigured(), false);
  process.env.WHAPI_PARTNER_TOKEN = "test-partner-token";
  assert.equal(isWhapiPartnerConfigured(), false);
  process.env.WHAPI_PROJECT_ID = "test-project";
  assert.equal(isWhapiPartnerConfigured(), true);
});

test("createChannel sends PUT to manager.whapi.cloud/channels with name+projectId, returns the channel's own token", async () => {
  process.env.WHAPI_PARTNER_TOKEN = "partner-token";
  process.env.WHAPI_PROJECT_ID = "project-1";
  const mock = mockFetchSequence([
    { status: 200, body: { id: "CHAN-1", token: "channel-secret-token", apiUrl: "https://gate.whapi.cloud", server: "s1" } },
  ]);
  try {
    const result = await createChannel("Acme Co");
    assert.equal(result.id, "CHAN-1");
    assert.equal(result.token, "channel-secret-token");
    assert.equal(result.apiUrl, "https://gate.whapi.cloud");
    assert.equal(mock.callCount(), 1);
    assert.match(mock.calls[0].url, /^https:\/\/manager\.whapi\.cloud\/channels/);
    assert.equal(mock.calls[0].init?.method, "PUT");
    const sentBody = JSON.parse(String(mock.calls[0].init?.body));
    assert.deepEqual(sentBody, { name: "Acme Co", projectId: "project-1" });
  } finally {
    mock.restore();
  }
});

test("createChannel never retries a 403 (brand/channel limit) — fails fast", async () => {
  process.env.WHAPI_PARTNER_TOKEN = "partner-token";
  process.env.WHAPI_PROJECT_ID = "project-1";
  const mock = mockFetchSequence([{ status: 403, body: { message: "channel limit reached" } }]);
  try {
    await assert.rejects(() => createChannel("Acme Co"), WhapiApiError);
    assert.equal(mock.callCount(), 1);
  } finally {
    mock.restore();
  }
});

test("createChannel retries a 429 and succeeds on the next attempt", async () => {
  process.env.WHAPI_PARTNER_TOKEN = "partner-token";
  process.env.WHAPI_PROJECT_ID = "project-1";
  const mock = mockFetchSequence([
    { status: 429, body: { message: "rate limited" }, headers: { "retry-after": "0" } },
    { status: 200, body: { id: "CHAN-2", token: "tok", apiUrl: "https://gate.whapi.cloud", server: "s1" } },
  ]);
  try {
    const result = await createChannel("Acme Co");
    assert.equal(result.id, "CHAN-2");
    assert.equal(mock.callCount(), 2);
  } finally {
    mock.restore();
  }
});

test("getQrCode calls the channel's own apiUrl with the channel token, returns status+base64", async () => {
  const mock = mockFetchSequence([{ status: 200, body: { status: "WAITING", base64: "data:image/png;base64,AAA" } }]);
  try {
    const result = await getQrCode("https://gate.whapi.cloud", "channel-token");
    assert.equal(result.status, "WAITING");
    assert.equal(result.base64, "data:image/png;base64,AAA");
    assert.match(mock.calls[0].url, /^https:\/\/gate\.whapi\.cloud\/users\/login/);
    assert.equal((mock.calls[0].init?.headers as Record<string, string>).Authorization, "Bearer channel-token");
  } finally {
    mock.restore();
  }
});

test("getChannelHealth: status.text AUTH maps to connected:true", async () => {
  const mock = mockFetchSequence([{ status: 200, body: { status: { text: "AUTH" }, user: { phone: "15551234567" } } }]);
  try {
    const result = await getChannelHealth("https://gate.whapi.cloud", "channel-token");
    assert.equal(result.connected, true);
    assert.equal(result.phone, "15551234567");
  } finally {
    mock.restore();
  }
});

test("getChannelHealth: status.text QR (not yet linked) maps to connected:false", async () => {
  const mock = mockFetchSequence([{ status: 200, body: { status: { text: "QR" } } }]);
  try {
    const result = await getChannelHealth("https://gate.whapi.cloud", "channel-token");
    assert.equal(result.connected, false);
    assert.equal(result.statusText, "QR");
  } finally {
    mock.restore();
  }
});

test("setWebhook PATCHes /settings with the full webhooks block, including the custom secret header", async () => {
  const mock = mockFetchSequence([{ status: 200, body: {} }]);
  try {
    await setWebhook("https://gate.whapi.cloud", "channel-token", "https://crm.example.com/api/webhooks/whapi", "X-Whapi-Webhook-Secret", "sekret");
    assert.equal(mock.calls[0].init?.method, "PATCH");
    const body = JSON.parse(String(mock.calls[0].init?.body));
    assert.equal(body.webhooks[0].url, "https://crm.example.com/api/webhooks/whapi");
    assert.deepEqual(body.webhooks[0].headers, { "X-Whapi-Webhook-Secret": "sekret" });
  } finally {
    mock.restore();
  }
});

test("sendTextMessage posts {to, body} and returns the provider's message id", async () => {
  const mock = mockFetchSequence([{ status: 200, body: { sent: true, message: { id: "msg-123" } } }]);
  try {
    const id = await sendTextMessage("https://gate.whapi.cloud", "channel-token", "15550001111@s.whatsapp.net", "hello");
    assert.equal(id, "msg-123");
    const body = JSON.parse(String(mock.calls[0].init?.body));
    assert.deepEqual(body, { to: "15550001111@s.whatsapp.net", body: "hello" });
  } finally {
    mock.restore();
  }
});

test("sendTextMessage throws when Whapi reports sent:false", async () => {
  const mock = mockFetchSequence([{ status: 200, body: { sent: false } }]);
  try {
    await assert.rejects(() => sendTextMessage("https://gate.whapi.cloud", "channel-token", "to", "hi"));
  } finally {
    mock.restore();
  }
});
