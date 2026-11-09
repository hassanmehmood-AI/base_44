import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret, isEncryptionKeyConfigured, EncryptionKeyNotConfiguredError, SecretDecryptionError } from "./smtpSecretBox";

// Test-only key, generated the same way `openssl rand -hex 32` would — never
// a real key, never reused anywhere outside this file.
const TEST_KEY_HEX = "0".repeat(63) + "2"; // 64 hex chars, deterministic and obviously not a real secret

test("encryptSecret -> decryptSecret round-trips the original plaintext", () => {
  process.env.SMTP_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
  const plaintext = "mailbox-password-example-not-real";
  const stored = encryptSecret(plaintext);
  assert.notEqual(stored, plaintext);
  assert.equal(decryptSecret(stored), plaintext);
});

test("encryptSecret never reuses an IV across calls (ciphertext differs even for identical plaintext)", () => {
  process.env.SMTP_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
  const a = encryptSecret("same-value");
  const b = encryptSecret("same-value");
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), "same-value");
  assert.equal(decryptSecret(b), "same-value");
});

test("decryptSecret throws SecretDecryptionError when the key has changed (authTag check fails)", () => {
  process.env.SMTP_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
  const stored = encryptSecret("secret-under-key-1");
  process.env.SMTP_CREDENTIAL_ENCRYPTION_KEY = "f".repeat(64);
  assert.throws(() => decryptSecret(stored), SecretDecryptionError);
  process.env.SMTP_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
});

test("decryptSecret throws SecretDecryptionError on a garbage/corrupted stored value", () => {
  process.env.SMTP_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
  assert.throws(() => decryptSecret("not-a-real-stored-value"), SecretDecryptionError);
});

test("loadKey rejects a key that isn't exactly 32 bytes", () => {
  process.env.SMTP_CREDENTIAL_ENCRYPTION_KEY = "tooshort";
  assert.throws(() => encryptSecret("x"));
  process.env.SMTP_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
});

test("isEncryptionKeyConfigured reflects whether the env var is set and valid", () => {
  delete process.env.SMTP_CREDENTIAL_ENCRYPTION_KEY;
  assert.equal(isEncryptionKeyConfigured(), false);
  process.env.SMTP_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
  assert.equal(isEncryptionKeyConfigured(), true);
});

test("encryptSecret throws EncryptionKeyNotConfiguredError when the env var is unset", () => {
  delete process.env.SMTP_CREDENTIAL_ENCRYPTION_KEY;
  assert.throws(() => encryptSecret("x"), EncryptionKeyNotConfiguredError);
  process.env.SMTP_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
});
