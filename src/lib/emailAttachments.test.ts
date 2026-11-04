import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateAttachmentType,
  validateAttachmentSize,
  validateAttachment,
  formatFileSize,
  MAX_ATTACHMENT_BYTES,
  ALLOWED_ATTACHMENT_TYPES,
} from "./emailAttachments";

test("validateAttachmentType: accepts exactly the five approved formats", () => {
  assert.equal(validateAttachmentType("application/pdf"), true);
  assert.equal(validateAttachmentType("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), true);
  assert.equal(validateAttachmentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), true);
  assert.equal(validateAttachmentType("image/jpeg"), true);
  assert.equal(validateAttachmentType("image/png"), true);
});

test("validateAttachmentType: rejects anything not on the allow-list", () => {
  assert.equal(validateAttachmentType("application/x-msdownload"), false); // .exe
  assert.equal(validateAttachmentType("text/html"), false);
  assert.equal(validateAttachmentType("application/zip"), false);
  assert.equal(validateAttachmentType("image/svg+xml"), false); // can embed scripts
  assert.equal(validateAttachmentType(""), false);
});

test("validateAttachmentSize: accepts anything from 1 byte up to the cap, rejects 0 and anything over", () => {
  assert.equal(validateAttachmentSize(1), true);
  assert.equal(validateAttachmentSize(MAX_ATTACHMENT_BYTES), true);
  assert.equal(validateAttachmentSize(0), false);
  assert.equal(validateAttachmentSize(-1), false);
  assert.equal(validateAttachmentSize(MAX_ATTACHMENT_BYTES + 1), false);
});

test("validateAttachment: a valid PDF under the size cap passes with no error", () => {
  assert.equal(validateAttachment("application/pdf", 1024), null);
});

test("validateAttachment: a disallowed type is rejected even if the size is fine", () => {
  assert.equal(validateAttachment("application/x-sh", 100), "TYPE_NOT_ALLOWED");
});

test("validateAttachment: an allowed type over the size cap is rejected", () => {
  assert.equal(validateAttachment("image/png", MAX_ATTACHMENT_BYTES + 1), "TOO_LARGE");
});

test("validateAttachment: type is checked before size — a disallowed, oversized file reports TYPE_NOT_ALLOWED, not TOO_LARGE", () => {
  assert.equal(validateAttachment("application/exe", MAX_ATTACHMENT_BYTES * 2), "TYPE_NOT_ALLOWED");
});

test("formatFileSize: bytes, KB, and MB ranges format as expected", () => {
  assert.equal(formatFileSize(500), "500 B");
  assert.equal(formatFileSize(1536), "1.5 KB");
  assert.equal(formatFileSize(5 * 1024 * 1024), "5.0 MB");
});

test("ALLOWED_ATTACHMENT_TYPES: exactly five entries, matching the approved format list", () => {
  assert.equal(Object.keys(ALLOWED_ATTACHMENT_TYPES).length, 5);
  assert.deepEqual(new Set(Object.values(ALLOWED_ATTACHMENT_TYPES)), new Set(["PDF", "DOCX", "XLSX", "JPG", "PNG"]));
});
