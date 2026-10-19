import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Generic AES-256-GCM encrypt/decrypt for secrets this app must store at
 * rest — currently just each company's Whapi channel token and its webhook
 * header secret (see db/schema.ts's whapiChannels comment for why those, and
 * only those, need real encryption rather than a plain column: unlike
 * Metricool's single shared account token, every company's Whapi channel has
 * its own distinct bearer credential).
 *
 * The output is a single versioned string ("v1:<ivB64>:<authTagB64>:<cipherB64>")
 * rather than three separate columns — keeps the schema simple and leaves room
 * for a "v2" scheme later (e.g. a rotated key) without a migration, since the
 * version prefix is parsed back out on decrypt. */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit IV is the AES-GCM standard/recommended size
const CURRENT_VERSION = "v1";

export class EncryptionKeyNotConfiguredError extends Error {
  constructor() {
    super(
      "WHAPI_TOKEN_ENCRYPTION_KEY is not configured. Generate one with `openssl rand -hex 32` and set it as a Railway environment variable — never commit it or paste it into chat/logs."
    );
    this.name = "EncryptionKeyNotConfiguredError";
  }
}

export class SecretDecryptionError extends Error {
  constructor(reason: string) {
    super(`Failed to decrypt stored secret: ${reason}`);
    this.name = "SecretDecryptionError";
  }
}

/** Accepts the key as 64 hex chars (32 bytes) — what `openssl rand -hex 32`
 * produces — or a 32-byte base64 string, so either generation method works.
 * Never logs or echoes the key itself, only throws a message naming the env
 * var to fix. */
function loadKey(): Buffer {
  const raw = process.env.WHAPI_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new EncryptionKeyNotConfiguredError();

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }
  if (key.length !== 32) {
    throw new Error(
      "WHAPI_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars, or base64 for 32 raw bytes)."
    );
  }
  return key;
}

export function isEncryptionKeyConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [CURRENT_VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const key = loadKey();
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== CURRENT_VERSION) {
    throw new SecretDecryptionError("unrecognized format or version");
  }
  const [, ivB64, authTagB64, cipherB64] = parts;
  try {
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const ciphertext = Buffer.from(cipherB64, "base64");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (e) {
    // Never includes the ciphertext/key/iv in the error — just enough to
    // diagnose "the key changed" vs. "the stored value is corrupt" from logs.
    throw new SecretDecryptionError(e instanceof Error ? e.message : "unknown error");
  }
}
