import { test } from "node:test";
import assert from "node:assert/strict";
import { createChannel, getQrCode, getChannelHealth, setWebhook, sendTextMessage, getContactProfile, getGroupInfo, isWhapiPartnerConfigured, WhapiApiError } from "./whapi";

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

test("getContactProfile maps icon/icon_full and calls the correct URL with the channel token", async () => {
  const mock = mockFetchSequence([{ status: 200, body: { name: "Jane", about: "Hey there", icon: "https://pps.whatsapp.net/v/small", icon_full: "https://pps.whatsapp.net/v/full" } }]);
  try {
    const profile = await getContactProfile("https://gate.whapi.cloud", "channel-token", "15550001111@s.whatsapp.net");
    assert.equal(profile.name, "Jane");
    assert.equal(profile.icon, "https://pps.whatsapp.net/v/small");
    assert.equal(profile.iconFull, "https://pps.whatsapp.net/v/full");
    assert.match(mock.calls[0].url, /\/contacts\/15550001111%40s\.whatsapp\.net\/profile$/);
    assert.equal((mock.calls[0].init?.headers as Record<string, string>).Authorization, "Bearer channel-token");
  } finally {
    mock.restore();
  }
});

test("getContactProfile returns all-null fields on a 404 (contact has no profile picture) — never throws", async () => {
  const mock = mockFetchSequence([{ status: 404, body: { message: "not found" } }]);
  try {
    const profile = await getContactProfile("https://gate.whapi.cloud", "channel-token", "15550002222@s.whatsapp.net");
    assert.deepEqual(profile, { name: null, about: null, icon: null, iconFull: null });
  } finally {
    mock.restore();
  }
});

test("getContactProfile still throws on a genuine non-404 error", async () => {
  const mock = mockFetchSequence([{ status: 401, body: { message: "unauthorized" } }]);
  try {
    await assert.rejects(() => getContactProfile("https://gate.whapi.cloud", "channel-token", "15550003333@s.whatsapp.net"), WhapiApiError);
  } finally {
    mock.restore();
  }
});

test("getGroupInfo maps name/chat_pic/chat_pic_full and calls the correct URL with the channel token", async () => {
  const mock = mockFetchSequence([{ status: 200, body: { name: "Project Team", chat_pic: "https://pps.whatsapp.net/v/small", chat_pic_full: "https://pps.whatsapp.net/v/full" } }]);
  try {
    const info = await getGroupInfo("https://gate.whapi.cloud", "channel-token", "120363426877091849@g.us");
    assert.equal(info.name, "Project Team");
    assert.equal(info.chatPic, "https://pps.whatsapp.net/v/small");
    assert.equal(info.chatPicFull, "https://pps.whatsapp.net/v/full");
    assert.match(mock.calls[0].url, /\/groups\/120363426877091849%40g\.us$/);
    assert.equal((mock.calls[0].init?.headers as Record<string, string>).Authorization, "Bearer channel-token");
  } finally {
    mock.restore();
  }
});

test("getGroupInfo returns all-null fields on a 404 (group has no resolvable name/photo) — never throws", async () => {
  const mock = mockFetchSequence([{ status: 404, body: { message: "not found" } }]);
  try {
    const info = await getGroupInfo("https://gate.whapi.cloud", "channel-token", "120363999999999999@g.us");
    assert.deepEqual(info, { name: null, chatPic: null, chatPicFull: null });
  } finally {
    mock.restore();
  }
});

test("getGroupInfo still throws on a genuine non-404 error", async () => {
  const mock = mockFetchSequence([{ status: 401, body: { message: "unauthorized" } }]);
  try {
    await assert.rejects(() => getGroupInfo("https://gate.whapi.cloud", "channel-token", "120363888888888888@g.us"), WhapiApiError);
  } finally {
    mock.restore();
  }
});
