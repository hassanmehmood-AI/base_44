import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM encrypt/decrypt for SMTP/IMAP mailbox passwords stored at
 * rest in company_email_accounts. Deliberately a separate module and a
 * separate key (SMTP_CREDENTIAL_ENCRYPTION_KEY) from secretBox.ts's
 * WHAPI_TOKEN_ENCRYPTION_KEY and googleSecretBox.ts's
 * GOOGLE_TOKEN_ENCRYPTION_KEY — same reasoning as googleSecretBox.ts's own
 * doc comment: these are unrelated providers' secrets, and keeping their
 * keys independent means rotating or ever revoking one provider's key
 * never touches the others. The actual AES-256-GCM scheme (same versioned
 * "v1:<iv>:<tag>:<cipher>" string format) is identical to the other two
 * modules on purpose — only the key name and env var differ. */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const CURRENT_VERSION = "v1";

export class EncryptionKeyNotConfiguredError extends Error {
  constructor() {
    super(
      "SMTP_CREDENTIAL_ENCRYPTION_KEY is not configured. Generate one with `openssl rand -hex 32` and set it as a Railway environment variable — never commit it or paste it into chat/logs."
    );
    this.name = "EncryptionKeyNotConfiguredError";
  }
}

export class SecretDecryptionError extends Error {
  constructor(reason: string) {
    super(`Failed to decrypt stored SMTP/IMAP credential: ${reason}`);
    this.name = "SecretDecryptionError";
  }
}

function loadKey(): Buffer {
  const raw = process.env.SMTP_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) throw new EncryptionKeyNotConfiguredError();

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }
  if (key.length !== 32) {
    throw new Error(
      "SMTP_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars, or base64 for 32 raw bytes)."
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
    throw new SecretDecryptionError(e instanceof Error ? e.message : "unknown error");
  }
}
