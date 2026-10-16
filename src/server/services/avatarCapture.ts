import * as avatarStorage from "@/server/integrations/avatarStorage";
import * as conversationsRepo from "@/server/repositories/conversations";
import type { Conversation } from "@/server/repositories/conversations";

/** Permanent customer-avatar capture, entirely independent of the messaging
 * path it's triggered from (see social.ts/syncMetricoolConversations and
 * api/cron/metricool-sync/route.ts). Every public function here either
 * no-ops (storage not configured) or catches its own failures — nothing in
 * this file is ever allowed to throw into a caller that also handles
 * message ingestion, by design, so a storage outage/timeout/bad response
 * can never block or break a reply, sync tick, or webhook.
 *
 * Two-step, durable-by-construction design (see Stage 3 plan): queuing a
 * pending capture is a cheap, synchronous DB write (markPendingCapture,
 * called inline from the sync path); the actual download+upload
 * (processPendingAvatarCaptures) is dispatched in the same cron tick via
 * next/server's after() so it doesn't wait for the next 75s cycle, but its
 * *trigger* already survived in Postgres before any network call happened —
 * so a crash mid-download loses nothing; the next tick's
 * processPendingAvatarCaptures just picks the still-pending row back up. */

// Confirmed live (Stage 3 feasibility test): Metricool's imageProfileUrl is
// itself a Facebook/Instagram Graph API endpoint (not a direct CDN link) —
// error responses observed were literally Graph API's own JSON error shape
// ("GraphMethodException" / "Invalid appsecret_time"). A valid request
// redirects to the actual image CDN host, so both must be allowed.
const ALLOWED_EXACT_HOSTS = new Set(["graph.facebook.com", "graph.instagram.com"]);
const ALLOWED_HOST_SUFFIXES = [".fbcdn.net", ".cdninstagram.com", ".fbsbx.com"];

export function isAllowedAvatarHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (ALLOWED_EXACT_HOSTS.has(normalized)) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function isAllowedContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const base = contentType.split(";")[0]?.trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.has(base ?? "");
}

/** Bounds how long/how often a pending capture is retried — see the schema
 * comment on customerAvatarCaptureAttempts/FirstSeenAt. A crash-and-retry on
 * the very next tick is worth doing; retrying minutes later against a URL
 * that's almost certainly already past its proven-dead window (Stage 3:
 * valid at ~24s, expired by ~6min) is not — so whichever bound is hit first
 * stops it, rather than retrying a dead URL forever. */
const MAX_CAPTURE_ATTEMPTS = 3;
const GIVE_UP_AFTER_MS = 10 * 60_000;

export function shouldAbandonPendingCapture(attempts: number, firstSeenAt: Date, now: Date): boolean {
  if (attempts >= MAX_CAPTURE_ATTEMPTS) return true;
  return now.getTime() - firstSeenAt.getTime() >= GIVE_UP_AFTER_MS;
}

const FETCH_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 5;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

/** Follows redirects manually (never fetch's automatic `redirect: "follow"`)
 * so every hop's host — not just the first URL — is checked against
 * isAllowedAvatarHost before being requested. This is what stops an
 * open-redirect on an allowed host from being used to pivot an SSRF fetch
 * to an arbitrary internal/external target. */
async function fetchFollowingRedirects(startUrl: string, signal: AbortSignal): Promise<Response> {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const host = new URL(currentUrl).hostname;
    if (!isAllowedAvatarHost(host)) {
      throw new Error("avatar url host is not in the allowlist");
    }
    const res = await fetch(currentUrl, { method: "GET", redirect: "manual", signal, headers: FETCH_HEADERS });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!location) throw new Error("redirect response had no Location header");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return res;
  }
  throw new Error("too many redirects while fetching avatar");
}

async function readBodyWithCap(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error("avatar response exceeded max allowed size");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Downloads and validates one candidate avatar url end-to-end. Throws on
 * any failure (disallowed host, timeout, non-2xx, disallowed content-type,
 * oversized body) — callers here are expected to catch, since a thrown
 * rejection from this function is the normal "this attempt didn't work"
 * path, not an exceptional one. */
export async function downloadAvatarBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFollowingRedirects(url, controller.signal);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`avatar fetch failed with status ${res.status}`);
    }
    const contentType = res.headers.get("content-type");
    if (!isAllowedContentType(contentType)) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`avatar response had a disallowed content-type: ${contentType ?? "none"}`);
    }
    const bytes = await readBodyWithCap(res, MAX_AVATAR_BYTES);
    return { bytes, contentType: contentType! };
  } finally {
    clearTimeout(timer);
  }
}

/** Called inline from the sync path (social.ts) the moment a genuinely new
 * inbound message is seen — a single cheap, awaited DB write, never a
 * network call, so it can't meaningfully slow down or fail the message
 * insert it's attached to. No-ops entirely when storage isn't configured,
 * when there's no url to try, or when this conversation already has a
 * captured avatar (never re-queues/overwrites a success). */
export async function maybeQueuePendingCapture(conversation: Pick<Conversation, "id" | "customerAvatarKey">, imageUrl: string | null | undefined): Promise<void> {
  if (!avatarStorage.isAvatarStorageConfigured()) return;
  if (!imageUrl) return;
  if (conversation.customerAvatarKey) return;
  try {
    await conversationsRepo.markAvatarPending(conversation.id, imageUrl);
  } catch {
    // Best-effort: a failure to queue just means this message's capture is
    // skipped this time around — never thrown back into the sync path.
  }
}

function storageKeyFor(conversationId: string): string {
  return `avatars/${conversationId}`;
}

/** The actual download+upload step — dispatched via next/server's after()
 * from the cron route (see hook-in point in api/cron/metricool-sync),
 * running in the same tick a pending capture was just queued in rather than
 * waiting for the next one, but also sweeping up anything left pending from
 * a previous tick that crashed before finishing. Every per-row failure is
 * caught and recorded (attempt bump or abandon) — this function itself
 * never throws, so it can never affect the cron route's own response. */
export async function processPendingAvatarCaptures(
  limit = 10
): Promise<{ attempted: number; captured: number; abandoned: number; failed: number }> {
  if (!avatarStorage.isAvatarStorageConfigured()) {
    return { attempted: 0, captured: 0, abandoned: 0, failed: 0 };
  }

  let pending: Conversation[];
  try {
    pending = await conversationsRepo.findPendingAvatarCaptures(limit);
  } catch (e) {
    console.error("[avatarCapture] failed to load pending captures:", e instanceof Error ? e.message : e);
    return { attempted: 0, captured: 0, abandoned: 0, failed: 0 };
  }

  let captured = 0;
  let abandoned = 0;
  let failed = 0;

  for (const candidate of pending) {
    // Atomically claims this row (and bumps its attempt count in the same
    // statement) before doing anything else — see claimPendingAvatarCapture
    // for why this is what makes two overlapping processPendingAvatarCaptures
    // runs safe. A claim returning nothing means another concurrent run (or
    // a success that landed between the SELECT above and now) already
    // resolved this row — skip it, not a failure.
    let claimed;
    try {
      claimed = await conversationsRepo.claimPendingAvatarCapture(candidate.id);
    } catch (e) {
      console.error(`[avatarCapture] failed to claim conversation ${candidate.id}:`, e instanceof Error ? e.message : e);
      continue;
    }
    if (!claimed || !claimed.customerAvatarPendingUrl) continue;

    try {
      const { bytes, contentType } = await downloadAvatarBytes(claimed.customerAvatarPendingUrl);
      await avatarStorage.putAvatar(storageKeyFor(claimed.id), bytes, contentType);
      await conversationsRepo.markAvatarCaptured(claimed.id, storageKeyFor(claimed.id));
      captured++;
    } catch (e) {
      failed++;
      const firstSeenAt = claimed.customerAvatarCaptureFirstSeenAt ?? new Date();
      try {
        if (shouldAbandonPendingCapture(claimed.customerAvatarCaptureAttempts, firstSeenAt, new Date())) {
          await conversationsRepo.abandonPendingAvatar(claimed.id);
          abandoned++;
        }
        // Otherwise: nothing further to write — the claim above already
        // recorded this attempt, and the pending url is left as-is for the
        // next tick to retry.
      } catch (dbError) {
        console.error("[avatarCapture] failed to record capture abandonment:", dbError instanceof Error ? dbError.message : dbError);
      }
      console.error(`[avatarCapture] capture failed for conversation ${claimed.id}:`, e instanceof Error ? e.message : e);
    }
  }

  return { attempted: pending.length, captured, abandoned, failed };
}
