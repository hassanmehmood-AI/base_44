import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { ProviderNotConfiguredError } from "./errors";

/** S3-compatible object storage for email attachments — deliberately reuses
 * the exact same bucket/credentials as avatarStorage.ts (AVATAR_STORAGE_*
 * env vars, the same Railway Storage Bucket) rather than provisioning a
 * second bucket, per the approved plan: this needs zero new Railway
 * resources. Attachments live under their own key prefix
 * ("email-attachments/...", see buildAttachmentKey) so they can never
 * collide with an avatar key, and this module's own size/type limits are
 * independent of avatarStorage's (a 5MB avatar image cap has nothing to do
 * with a 20MB document attachment cap).
 *
 * Gated by the SAME AVATAR_STORAGE_ENABLED flag as avatars — there is only
 * one storage feature-flag in this app, not one per use of the bucket. */

function requiredEnvVars(): { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string } | null {
  const endpoint = process.env.AVATAR_STORAGE_ENDPOINT;
  const bucket = process.env.AVATAR_STORAGE_BUCKET;
  const accessKeyId = process.env.AVATAR_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AVATAR_STORAGE_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

export function isAttachmentStorageConfigured(): boolean {
  return process.env.AVATAR_STORAGE_ENABLED === "true" && requiredEnvVars() !== null;
}

let _client: S3Client | null = null;
let _bucket: string | null = null;

function getClient(): { client: S3Client; bucket: string } {
  const env = requiredEnvVars();
  if (!env) {
    throw new ProviderNotConfiguredError("Email attachment storage", [
      "AVATAR_STORAGE_ENDPOINT",
      "AVATAR_STORAGE_BUCKET",
      "AVATAR_STORAGE_ACCESS_KEY_ID",
      "AVATAR_STORAGE_SECRET_ACCESS_KEY",
    ]);
  }
  if (!_client) {
    _client = new S3Client({
      endpoint: env.endpoint,
      region: "auto",
      credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
      forcePathStyle: true,
    });
    _bucket = env.bucket;
  }
  return { client: _client, bucket: _bucket! };
}

/** Namespaced by company AND conversation AND message, in that order — so
 * a leaked/guessed key for one company's attachment can never resolve to
 * another company's object even if an attacker enumerated keys directly
 * against the bucket (defense in depth; the real enforcement is still the
 * serving route's own assertCompanyAccess check, same as avatars).
 *
 * batchId identifies "the one message/send this attachment belongs to" —
 * for an INBOUND message that's simply Gmail's own message.id (already
 * globally unique within the mailbox, available before any CRM row
 * exists); for an OUTBOUND send it's a freshly generated UUID, because the
 * real message row (and sometimes the conversation itself, for a
 * brand-new thread) doesn't exist yet at upload time — uploading happens
 * BEFORE the send call, specifically so a failed upload/validation never
 * results in an email actually being sent with an attachment the CRM can't
 * later display. index disambiguates multiple attachments in the same
 * batch. */
export function buildAttachmentKey(companyId: string, batchId: string, index: number, filename: string): string {
  // "." is in the allow-list (needed for the file extension), so a run of
  // 2+ dots — the only way a path-traversal segment ("..") can survive —
  // is collapsed separately, after everything else (notably "/") is
  // already turned into "_".
  const safeName = filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, "_")
    .slice(-150);
  return `email-attachments/${companyId}/${batchId}/${index}-${safeName}`;
}

export async function putAttachment(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { client, bucket } = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      // Private by design, identical reasoning to avatarStorage.ts — the
      // only path to these bytes is this CRM's own authenticated serving
      // route, never a public bucket URL.
      ACL: "private",
    })
  );
}

/** Returns null for a missing object (treated as "attachment unavailable"
 * by the serving route, a 404, not a 500) rather than throwing. */
export async function getAttachment(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const { client, bucket } = getClient();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) return null;
    return { bytes, contentType: result.ContentType ?? "application/octet-stream" };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw e;
  }
}
