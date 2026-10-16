import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { ProviderNotConfiguredError } from "./errors";

/** S3-compatible object storage for permanently-cached customer avatars (see
 * services/avatarCapture.ts) — written to work against Railway Storage
 * Buckets, but any S3-compatible endpoint works identically since this only
 * uses the standard S3 API surface.
 *
 * Disabled by default: AVATAR_STORAGE_ENABLED must be explicitly "true" on
 * top of the connection env vars being set, so this feature ships dark and
 * is opt-in even once deployed — see isAvatarStorageConfigured(). */

function requiredEnvVars(): { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string } | null {
  const endpoint = process.env.AVATAR_STORAGE_ENDPOINT;
  const bucket = process.env.AVATAR_STORAGE_BUCKET;
  const accessKeyId = process.env.AVATAR_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AVATAR_STORAGE_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

export function isAvatarStorageConfigured(): boolean {
  return process.env.AVATAR_STORAGE_ENABLED === "true" && requiredEnvVars() !== null;
}

let _client: S3Client | null = null;
let _bucket: string | null = null;

function getClient(): { client: S3Client; bucket: string } {
  const env = requiredEnvVars();
  if (!env) {
    throw new ProviderNotConfiguredError("Avatar storage", [
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
      // Railway Storage Buckets (and most non-AWS S3-compatible providers)
      // expect path-style addressing, not AWS's virtual-hosted-style default.
      forcePathStyle: true,
    });
    _bucket = env.bucket;
  }
  return { client: _client, bucket: _bucket! };
}

export async function putAvatar(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { client, bucket } = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      // Private by design — the only path to these bytes is this CRM's own
      // authenticated serving route (api/avatars/[conversationId]), never a
      // public bucket URL. See that route for the actual access check.
      ACL: "private",
    })
  );
}

/** Returns null if the key doesn't exist (callers treat that exactly like
 * "no avatar" — the serving route 404s, the frontend falls back to initials)
 * rather than throwing, since a missing object is an expected, routine case
 * here, not an error condition. */
export async function getAvatar(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
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
