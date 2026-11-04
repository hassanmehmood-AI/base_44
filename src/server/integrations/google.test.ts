import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractBody,
  extractAttachments,
  parseFromHeader,
  parseFirstAddress,
  buildAuthorizationUrl,
  watchMailbox,
  listHistory,
  getMessage,
  getAttachment,
  getProfile,
  isGmailPubSubConfigured,
  sendGmailMessage,
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
    assert.equal(message.bodyHtml, null);
  } finally {
    mock.restore();
  }
});

test("getMessage: a multipart message with both text/plain and text/html parts exposes both — body stays plain text, bodyHtml carries the raw (unsanitized) HTML", async () => {
  const mock = mockFetchSequence([
    {
      status: 200,
      body: {
        id: "msg-2",
        threadId: "thread-2",
        labelIds: ["INBOX"],
        internalDate: "1700000000000",
        payload: {
          headers: [{ name: "From", value: "jane@example.com" }],
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: Buffer.from("Plain version").toString("base64url") } },
            { mimeType: "text/html", body: { data: Buffer.from("<p>HTML <b>version</b></p>").toString("base64url") } },
          ],
        },
      },
    },
  ]);
  try {
    const message = await getMessage("access-token", "msg-2");
    assert.equal(message.body, "Plain version");
    assert.equal(message.bodyHtml, "<p>HTML <b>version</b></p>");
  } finally {
    mock.restore();
  }
});

test("getMessage: an HTML-only message derives body (plain text, tags stripped) AND keeps the original bodyHtml intact", async () => {
  const mock = mockFetchSequence([
    {
      status: 200,
      body: {
        id: "msg-3",
        threadId: "thread-3",
        labelIds: ["INBOX"],
        internalDate: "1700000000000",
        payload: {
          headers: [{ name: "From", value: "jane@example.com" }],
          mimeType: "text/html",
          body: { data: Buffer.from("<p>Only <i>HTML</i> here</p>").toString("base64url") },
        },
      },
    },
  ]);
  try {
    const message = await getMessage("access-token", "msg-3");
    assert.equal(message.body, "Only HTML here");
    assert.equal(message.bodyHtml, "<p>Only <i>HTML</i> here</p>");
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

// sendGmailMessage / the MIME message it builds — decodes the base64url
// "raw" field sent to Gmail's API to verify the actual MIME structure,
// not just that a request was made.

function decodeSentRawMessage(mock: ReturnType<typeof mockFetchSequence>): string {
  const sentBody = JSON.parse(mock.calls[0].init!.body as string);
  return Buffer.from(sentBody.raw, "base64url").toString("utf8");
}

test("sendGmailMessage: with no bodyHtml, sends a plain text/plain message — unchanged from before HTML support existed", async () => {
  const mock = mockFetchSequence([{ status: 200, body: { id: "sent-1" } }]);
  try {
    const result = await sendGmailMessage("access-token", { to: "jane@example.com", subject: "Hi", bodyText: "Hello there" });
    assert.equal(result.externalId, "sent-1");
    const raw = decodeSentRawMessage(mock);
    assert.match(raw, /Content-Type: text\/plain; charset=utf-8/);
    assert.ok(!raw.includes("multipart/alternative"));
    assert.ok(raw.includes("Hello there"));
  } finally {
    mock.restore();
  }
});

test("sendGmailMessage: with bodyHtml, sends a multipart/alternative message containing both the plain-text and HTML parts", async () => {
  const mock = mockFetchSequence([{ status: 200, body: { id: "sent-2" } }]);
  try {
    await sendGmailMessage("access-token", {
      to: "jane@example.com",
      subject: "Hi",
      bodyText: "Hello there",
      bodyHtml: "<p>Hello <b>there</b></p>",
    });
    const raw = decodeSentRawMessage(mock);
    assert.match(raw, /Content-Type: multipart\/alternative; boundary="/);
    assert.match(raw, /Content-Type: text\/plain; charset=utf-8/);
    assert.match(raw, /Content-Type: text\/html; charset=utf-8/);
    assert.ok(raw.includes("Hello there"));
    assert.ok(raw.includes("<p>Hello <b>there</b></p>"));
  } finally {
    mock.restore();
  }
});

test("sendGmailMessage: a Google API error (e.g. revoked token) throws GoogleApiError", async () => {
  const mock = mockFetchSequence([{ status: 401, body: { error: { message: "Invalid credentials" } } }]);
  try {
    await assert.rejects(
      () => sendGmailMessage("access-token", { to: "jane@example.com", subject: "Hi", bodyText: "Hello" }),
      GoogleApiError
    );
  } finally {
    mock.restore();
  }
});

test("sendGmailMessage: with attachments, sends a multipart/mixed message containing the body part AND each attachment as a base64 part with Content-Disposition: attachment", async () => {
  const mock = mockFetchSequence([{ status: 200, body: { id: "sent-3" } }]);
  try {
    await sendGmailMessage("access-token", {
      to: "jane@example.com",
      subject: "Invoice attached",
      bodyText: "See attached",
      attachments: [{ filename: "invoice.pdf", mimeType: "application/pdf", bytes: Buffer.from("fake pdf bytes") }],
    });
    const raw = decodeSentRawMessage(mock);
    assert.match(raw, /Content-Type: multipart\/mixed; boundary="/);
    assert.match(raw, /Content-Disposition: attachment; filename="invoice.pdf"/);
    assert.match(raw, /Content-Type: application\/pdf; name="invoice.pdf"/);
    assert.match(raw, /Content-Transfer-Encoding: base64/);
    assert.ok(raw.includes(Buffer.from("fake pdf bytes").toString("base64")));
    assert.ok(raw.includes("See attached"));
  } finally {
    mock.restore();
  }
});

test("sendGmailMessage: with bodyHtml AND attachments, nests multipart/alternative inside multipart/mixed correctly", async () => {
  const mock = mockFetchSequence([{ status: 200, body: { id: "sent-4" } }]);
  try {
    await sendGmailMessage("access-token", {
      to: "jane@example.com",
      subject: "Hi",
      bodyText: "Plain",
      bodyHtml: "<p>HTML</p>",
      attachments: [{ filename: "photo.png", mimeType: "image/png", bytes: Buffer.from("fake png bytes") }],
    });
    const raw = decodeSentRawMessage(mock);
    assert.match(raw, /Content-Type: multipart\/mixed; boundary="/);
    assert.match(raw, /Content-Type: multipart\/alternative; boundary="/);
    assert.ok(raw.includes("Plain"));
    assert.ok(raw.includes("<p>HTML</p>"));
    assert.match(raw, /Content-Disposition: attachment; filename="photo.png"/);
  } finally {
    mock.restore();
  }
});

test("sendGmailMessage: strips double-quotes from an attachment filename so it can't break the MIME header", async () => {
  const mock = mockFetchSequence([{ status: 200, body: { id: "sent-5" } }]);
  try {
    await sendGmailMessage("access-token", {
      to: "jane@example.com",
      subject: "Hi",
      bodyText: "Hello",
      attachments: [{ filename: 'evil".pdf', mimeType: "application/pdf", bytes: Buffer.from("x") }],
    });
    const raw = decodeSentRawMessage(mock);
    assert.match(raw, /Content-Disposition: attachment; filename="evil\.pdf"/);
  } finally {
    mock.restore();
  }
});

// extractAttachments / getMessage's attachment metadata — the "list what's
// attached" half, which needs no extra API call beyond the format=full
// response already fetched.

test("extractAttachments: a part with filename + body.attachmentId is an attachment", () => {
  const attachments = extractAttachments({
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "text/plain", body: { data: Buffer.from("body").toString("base64url") } },
      { mimeType: "application/pdf", filename: "report.pdf", body: { attachmentId: "att-1", size: 12345 } },
    ],
  });
  assert.deepEqual(attachments, [{ attachmentId: "att-1", filename: "report.pdf", mimeType: "application/pdf", size: 12345 }]);
});

test("extractAttachments: a part with a filename but inline body.data (no attachmentId) is NOT treated as an attachment", () => {
  const attachments = extractAttachments({
    mimeType: "multipart/related",
    parts: [{ mimeType: "image/png", filename: "signature.png", body: { data: Buffer.from("inline").toString("base64url") } }],
  });
  assert.deepEqual(attachments, []);
});

test("extractAttachments: a message with no attachments returns an empty array, never throws", () => {
  assert.deepEqual(extractAttachments({ mimeType: "text/plain", body: { data: Buffer.from("x").toString("base64url") } }), []);
  assert.deepEqual(extractAttachments(undefined), []);
});

test("extractAttachments: finds multiple attachments across nested parts", () => {
  const attachments = extractAttachments({
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [{ mimeType: "text/plain", body: { data: Buffer.from("body").toString("base64url") } }],
      },
      { mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "att-a", size: 100 } },
      { mimeType: "image/jpeg", filename: "b.jpg", body: { attachmentId: "att-b", size: 200 } },
    ],
  });
  assert.equal(attachments.length, 2);
  assert.deepEqual(attachments.map((a) => a.filename), ["a.pdf", "b.jpg"]);
});

test("getMessage: includes attachment metadata in the returned GmailMessage", async () => {
  const mock = mockFetchSequence([
    {
      status: 200,
      body: {
        id: "msg-4",
        threadId: "thread-4",
        labelIds: ["INBOX"],
        internalDate: "1700000000000",
        payload: {
          headers: [{ name: "From", value: "jane@example.com" }],
          mimeType: "multipart/mixed",
          parts: [
            { mimeType: "text/plain", body: { data: Buffer.from("See attached").toString("base64url") } },
            { mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "att-xyz", size: 5000 } },
          ],
        },
      },
    },
  ]);
  try {
    const message = await getMessage("access-token", "msg-4");
    assert.equal(message.attachments.length, 1);
    assert.deepEqual(message.attachments[0], { attachmentId: "att-xyz", filename: "invoice.pdf", mimeType: "application/pdf", size: 5000 });
  } finally {
    mock.restore();
  }
});

// getAttachment — the "download the bytes" half, only ever called for
// attachments that already passed size/type validation.

test("getAttachment: decodes the base64url data field into raw bytes", async () => {
  const fakeBytes = Buffer.from("fake attachment content");
  const mock = mockFetchSequence([{ status: 200, body: { size: fakeBytes.length, data: fakeBytes.toString("base64url") } }]);
  try {
    const result = await getAttachment("access-token", "msg-1", "att-1");
    assert.equal(Buffer.from(result.bytes).toString(), "fake attachment content");
    assert.equal(result.size, fakeBytes.length);
    assert.match(mock.calls[0].url, /\/messages\/msg-1\/attachments\/att-1$/);
  } finally {
    mock.restore();
  }
});

test("getAttachment: a Google API error throws GoogleApiError", async () => {
  const mock = mockFetchSequence([{ status: 404, body: { error: { message: "Attachment not found" } } }]);
  try {
    await assert.rejects(() => getAttachment("access-token", "msg-1", "att-missing"), GoogleApiError);
  } finally {
    mock.restore();
  }
});
