import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAttachmentKey, isAttachmentStorageConfigured } from "./emailAttachmentStorage";

test("buildAttachmentKey: namespaces by company and batch, includes the index and a sanitized filename", () => {
  const key = buildAttachmentKey("company-1", "batch-abc", 0, "invoice.pdf");
  assert.equal(key, "email-attachments/company-1/batch-abc/0-invoice.pdf");
});

test("buildAttachmentKey: two different companies with the same batch/index/filename never produce the same key", () => {
  const keyA = buildAttachmentKey("company-A", "batch-1", 0, "report.pdf");
  const keyB = buildAttachmentKey("company-B", "batch-1", 0, "report.pdf");
  assert.notEqual(keyA, keyB);
  assert.ok(keyA.startsWith("email-attachments/company-A/"));
  assert.ok(keyB.startsWith("email-attachments/company-B/"));
});

test("buildAttachmentKey: sanitizes unsafe filename characters (path traversal, slashes, spaces)", () => {
  const key = buildAttachmentKey("company-1", "batch-1", 0, "../../etc/passwd");
  assert.ok(!key.includes(".."));
  assert.ok(!key.includes("/etc/"));
});

test("buildAttachmentKey: different indexes for the same batch never collide", () => {
  const keyA = buildAttachmentKey("company-1", "batch-1", 0, "file.pdf");
  const keyB = buildAttachmentKey("company-1", "batch-1", 1, "file.pdf");
  assert.notEqual(keyA, keyB);
});

test("isAttachmentStorageConfigured: false unless AVATAR_STORAGE_ENABLED is exactly 'true' AND every connection var is set", () => {
  const saved = {
    enabled: process.env.AVATAR_STORAGE_ENABLED,
    endpoint: process.env.AVATAR_STORAGE_ENDPOINT,
    bucket: process.env.AVATAR_STORAGE_BUCKET,
    key: process.env.AVATAR_STORAGE_ACCESS_KEY_ID,
    secret: process.env.AVATAR_STORAGE_SECRET_ACCESS_KEY,
  };
  try {
    delete process.env.AVATAR_STORAGE_ENABLED;
    delete process.env.AVATAR_STORAGE_ENDPOINT;
    delete process.env.AVATAR_STORAGE_BUCKET;
    delete process.env.AVATAR_STORAGE_ACCESS_KEY_ID;
    delete process.env.AVATAR_STORAGE_SECRET_ACCESS_KEY;
    assert.equal(isAttachmentStorageConfigured(), false);

    process.env.AVATAR_STORAGE_ENDPOINT = "https://storage.example.com";
    process.env.AVATAR_STORAGE_BUCKET = "test-bucket";
    process.env.AVATAR_STORAGE_ACCESS_KEY_ID = "test-key";
    process.env.AVATAR_STORAGE_SECRET_ACCESS_KEY = "test-secret";
    assert.equal(isAttachmentStorageConfigured(), false); // still missing ENABLED=true

    process.env.AVATAR_STORAGE_ENABLED = "true";
    assert.equal(isAttachmentStorageConfigured(), true);
  } finally {
    if (saved.enabled === undefined) delete process.env.AVATAR_STORAGE_ENABLED;
    else process.env.AVATAR_STORAGE_ENABLED = saved.enabled;
    if (saved.endpoint === undefined) delete process.env.AVATAR_STORAGE_ENDPOINT;
    else process.env.AVATAR_STORAGE_ENDPOINT = saved.endpoint;
    if (saved.bucket === undefined) delete process.env.AVATAR_STORAGE_BUCKET;
    else process.env.AVATAR_STORAGE_BUCKET = saved.bucket;
    if (saved.key === undefined) delete process.env.AVATAR_STORAGE_ACCESS_KEY_ID;
    else process.env.AVATAR_STORAGE_ACCESS_KEY_ID = saved.key;
    if (saved.secret === undefined) delete process.env.AVATAR_STORAGE_SECRET_ACCESS_KEY;
    else process.env.AVATAR_STORAGE_SECRET_ACCESS_KEY = saved.secret;
  }
});
