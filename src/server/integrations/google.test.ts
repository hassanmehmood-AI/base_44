import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractBody,
  parseFromHeader,
  parseFirstAddress,
  buildAuthorizationUrl,
  watchMailbox,
  listHistory,
  getMessage,
  getProfile,
  isGmailPubSubConfigured,
  GoogleApiError,
} from "./google";

// Same mocked-fetch regression style as integrations/whapi.test.ts — no real
// Google API call is ever made by this suite.

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(call, responses.length - 1)];
    call++;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function setOAuthEnv() {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
  process.env.GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/oauth/google/callback";
}

test("buildAuthorizationUrl always forces access_type=offline and prompt=consent", () => {
  setOAuthEnv();
  const url = new URL(buildAuthorizationUrl("some-state"));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "some-state");
});

test("extractBody: prefers text/plain when present", () => {
  const body = extractBody({
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/plain", body: { data: Buffer.from("Hello plain").toString("base64url") } },
      { mimeType: "text/html", body: { data: Buffer.from("<p>Hello html</p>").toString("base64url") } },
    ],
  });
  assert.equal(body, "Hello plain");
});

test("extractBody: falls back to text/html (tags stripped) when no text/plain part exists", () => {
  const body = extractBody({
    mimeType: "text/html",
    body: { data: Buffer.from("<p>Hello <b>html</b> world</p>").toString("base64url") },
  });
  assert.equal(body, "Hello html world");
});

test("extractBody: returns empty string for an undefined payload rather than throwing", () => {
  assert.equal(extractBody(undefined), "");
});

test("extractBody: searches nested multipart/mixed parts, not just the top level", () => {
  const body = extractBody({
    mimeType: "multipart/mixed",
    parts: [{ mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: Buffer.from("Nested").toString("base64url") } }] }],
  });
  assert.equal(body, "Nested");
});

test("parseFromHeader: 'Name <email>' format splits correctly, email lowercased", () => {
  assert.deepEqual(parseFromHeader('"Jane Doe" <Jane.Doe@Example.com>'), { name: "Jane Doe", email: "jane.doe@example.com" });
});

test("parseFromHeader: bare email with no display name", () => {
  assert.deepEqual(parseFromHeader("jane@example.com"), { name: null, email: "jane@example.com" });
});

test("parseFromHeader: undefined input never throws", () => {
  assert.deepEqual(parseFromHeader(undefined), { name: null, email: null });
});

test("parseFirstAddress: a single 'Name <email>' header parses the same as parseFromHeader", () => {
  assert.deepEqual(parseFirstAddress('"Jane Doe" <jane@example.com>'), { name: "Jane Doe", email: "jane@example.com" });
});

test("parseFirstAddress: takes only the first of several comma-separated recipients", () => {
  assert.deepEqual(parseFirstAddress('"Jane Doe" <jane@example.com>, "John Doe" <john@example.com>'), {
    name: "Jane Doe",
    email: "jane@example.com",
  });
});

test("parseFirstAddress: a quoted display name containing a comma never causes a false split", () => {
  assert.deepEqual(parseFirstAddress('"Doe, Jane" <jane@example.com>, "John Doe" <john@example.com>'), {
    name: "Doe, Jane",
    email: "jane@example.com",
  });
});

test("parseFirstAddress: multiple bare (no angle-bracket) addresses still takes only the first", () => {
  assert.deepEqual(parseFirstAddress("jane@example.com, john@example.com"), { name: null, email: "jane@example.com" });
});

test("parseFirstAddress: undefined input never throws", () => {
  assert.deepEqual(parseFirstAddress(undefined), { name: null, email: null });
});

test("watchMailbox throws ProviderNotConfiguredError-style error when GOOGLE_PUBSUB_TOPIC is missing", async () => {
  delete process.env.GOOGLE_PUBSUB_TOPIC;
  await assert.rejects(() => watchMailbox("token"), /GOOGLE_PUBSUB_TOPIC/);
});

test("watchMailbox posts to users/me/watch with the configured topic and maps the response", async () => {
  process.env.GOOGLE_PUBSUB_TOPIC = "projects/test-project/topics/gmail-push";
  const mock = mockFetchSequence([{ status: 200, body: { historyId: "12345", expiration: "1700000000000" } }]);
  try {
    const result = await watchMailbox("access-token");
    assert.equal(result.historyId, "12345");
    assert.equal(result.expiration.getTime(), 1700000000000);
    assert.match(mock.calls[0].url, /\/users\/me\/watch$/);
    const sentBody = JSON.parse(mock.calls[0].init!.body as string);
    assert.equal(sentBody.topicName, "projects/test-project/topics/gmail-push");
  } finally {
    mock.restore();
  }
});

test("listHistory paginates through nextPageToken and aggregates messageAdded ids", async () => {
  const mock = mockFetchSequence([
    { status: 200, body: { history: [{ messagesAdded: [{ message: { id: "m1" } }] }], nextPageToken: "page2", historyId: "200" } },
    { status: 200, body: { history: [{ messagesAdded: [{ message: { id: "m2" } }] }], historyId: "201" } },
  ]);
  try {
    const result = await listHistory("access-token", "100");
    assert.deepEqual(result.messageIds, ["m1", "m2"]);
    assert.equal(result.newHistoryId, "201");
    assert.equal(result.expired, false);
  } finally {
    mock.restore();
  }
});

test("listHistory: a 404 (startHistoryId too old) is reported as expired, not thrown", async () => {
  const mock = mockFetchSequence([{ status: 404, body: { error: { message: "Not found" } } }]);
  try {
    const result = await listHistory("access-token", "stale-id");
    assert.equal(result.expired, true);
    assert.deepEqual(result.messageIds, []);
    assert.equal(result.newHistoryId, "stale-id");
  } finally {
    mock.restore();
  }
});

test("listHistory: a non-404 error still throws GoogleApiError", async () => {
  const mock = mockFetchSequence([{ status: 500, body: { error: { message: "Internal error" } } }]);
  try {
    await assert.rejects(() => listHistory("access-token", "100"), GoogleApiError);
  } finally {
    mock.restore();
  }
});

test("listHistory: no messagesAdded records produces an empty list without crashing", async () => {
  const mock = mockFetchSequence([{ status: 200, body: { historyId: "100" } }]);
  try {
    const result = await listHistory("access-token", "100");
    assert.deepEqual(result.messageIds, []);
    assert.equal(result.expired, false);
  } finally {
    mock.restore();
  }
});

test("getMessage: maps headers/body/labels into the GmailMessage shape", async () => {
  const mock = mockFetchSequence([
    {
      status: 200,
      body: {
        id: "msg-1",
        threadId: "thread-1",
        labelIds: ["INBOX", "UNREAD"],
        internalDate: "1700000000000",
        payload: {
          headers: [
            { name: "From", value: '"Jane Doe" <jane@example.com>' },
            { name: "To", value: '"Support" <support@example.com>' },
            { name: "Subject", value: "Hello there" },
          ],
          mimeType: "text/plain",
          body: { data: Buffer.from("Message body").toString("base64url") },
        },
      },
    },
  ]);
  try {
    const message = await getMessage("access-token", "msg-1");
    assert.equal(message.id, "msg-1");
    assert.equal(message.threadId, "thread-1");
    assert.deepEqual(message.labelIds, ["INBOX", "UNREAD"]);
    assert.equal(message.internalDate.getTime(), 1700000000000);
    assert.deepEqual(message.from, { name: "Jane Doe", email: "jane@example.com" });
    assert.deepEqual(message.to, { name: "Support", email: "support@example.com" });
    assert.equal(message.subject, "Hello there");
    assert.equal(message.body, "Message body");
  } finally {
    mock.restore();
  }
});

test("getMessage: a Google API error (e.g. revoked token) throws GoogleApiError", async () => {
  const mock = mockFetchSequence([{ status: 401, body: { error: { message: "Invalid credentials" } } }]);
  try {
    await assert.rejects(() => getMessage("access-token", "msg-1"), GoogleApiError);
  } finally {
    mock.restore();
  }
});

test("isGmailPubSubConfigured: false when GOOGLE_PUBSUB_TOPIC is unset, true when set", () => {
  delete process.env.GOOGLE_PUBSUB_TOPIC;
  assert.equal(isGmailPubSubConfigured(), false);
  process.env.GOOGLE_PUBSUB_TOPIC = "projects/test-project/topics/gmail-push";
  assert.equal(isGmailPubSubConfigured(), true);
  delete process.env.GOOGLE_PUBSUB_TOPIC;
});

test("getProfile: needs no Pub/Sub topic — calls users/me/profile and maps emailAddress/historyId", async () => {
  delete process.env.GOOGLE_PUBSUB_TOPIC;
  const mock = mockFetchSequence([{ status: 200, body: { emailAddress: "test@example.com", historyId: 54321 } }]);
  try {
    const profile = await getProfile("access-token");
    assert.equal(profile.emailAddress, "test@example.com");
    assert.equal(profile.historyId, "54321");
    assert.match(mock.calls[0].url, /\/users\/me\/profile$/);
  } finally {
    mock.restore();
  }
});

test("getProfile: a Google API error throws GoogleApiError", async () => {
  const mock = mockFetchSequence([{ status: 401, body: { error: { message: "Invalid credentials" } } }]);
  try {
    await assert.rejects(() => getProfile("access-token"), GoogleApiError);
  } finally {
    mock.restore();
  }
});
