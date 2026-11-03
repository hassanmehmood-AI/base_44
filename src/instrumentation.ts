/** In-process Gmail inbound sync poller — replaces the originally-proposed
 * separate "gmail-sync-trigger" Railway service with zero new
 * infrastructure. Next.js calls register() exactly once per server
 * process start (both `next dev` and `next start`/production), which is
 * what makes this self-starting after every restart/redeploy without any
 * external scheduler.
 *
 * Why this is safe here specifically (verified live against Railway
 * production before writing this, not assumed):
 *  - base_44's `sleepApplication` is `false` — the process never idles out
 *    between requests, so a setInterval here keeps firing continuously.
 *  - `restartPolicyType` is ON_FAILURE (max 10 retries) — a crash restarts
 *    the process, which re-runs register(), so polling always resumes.
 *  - `numReplicas` is 1 today. If that ever changes, or during the brief
 *    overlap window of a rolling deploy, more than one process could run
 *    this interval concurrently — already safe: gmailSync.syncAllActiveAccounts
 *    takes a Postgres transaction-scoped advisory lock (pg_try_advisory_xact_lock)
 *    so only one caller's tick ever does real work at a time; every other
 *    concurrent tick just returns { skippedConcurrent: true } immediately.
 *
 * Deliberately reuses gmailSync.ts and google.ts completely unchanged —
 * this file only adds a trigger, never touches the sync/send/receive logic
 * itself (same functions already exercised locally via
 * scripts/dev-gmail-poll.ts and the Pub/Sub webhook path).
 *
 * 3-second interval — matches the local dev cadence that was already
 * proven working. Confirmed safe at this interval: Gmail's real quota is
 * 250 units/user/second, and a no-new-mail tick costs ~2 units
 * (users.history.list) — even with many connected mailboxes, each
 * account's own quota usage stays far under its limit (~0.7 units/sec per
 * account), since Gmail's per-user quota is independent per mailbox.
 * gmailSync.ts's per-account rate-limit cooldown (see
 * RATE_LIMIT_COOLDOWN_MS) is the defense-in-depth backstop for the
 * unlikely case Google rate-limits one mailbox anyway. Database load per
 * tick is a handful of small queries inside one short transaction — see
 * this module's own doc comment on why the advisory lock's transaction
 * never holds the actual sync work inside it. */
const POLL_INTERVAL_MS = 3_000;

export async function register() {
  // instrumentation.ts also runs once for the edge runtime if any route
  // uses it — this app doesn't, but guarding explicitly means this can
  // never accidentally start a setInterval in a context that doesn't
  // support one.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { isGoogleOAuthConfigured } = await import("@/server/integrations/google");
  if (!isGoogleOAuthConfigured()) {
    // Expected in any environment without Gmail set up yet (a contributor's
    // machine, a preview env) — nothing to poll, so nothing starts. Not an
    // error, and re-checked fresh on every process start, so connecting
    // Gmail for the first time only needs the next natural deploy/restart,
    // never a manual step here.
    return;
  }

  const { syncAllActiveAccounts } = await import("@/server/services/gmailSync");

  async function tick() {
    try {
      const result = await syncAllActiveAccounts();
      if (!result.skippedConcurrent) {
        console.log("[gmail poll]", result);
      }
    } catch (e) {
      // Never throws out of the interval — a failed tick (transient Google
      // API error, a momentary DB blip) is logged and simply retried on the
      // next tick, POLL_INTERVAL_MS later. This interval itself IS the
      // retry policy for transient failures; a persistent per-account
      // rate-limit is handled separately inside gmailSync.ts's own cooldown.
      console.error("[gmail poll] sync tick failed:", e instanceof Error ? e.message : e);
    }
  }

  setInterval(tick, POLL_INTERVAL_MS);
  // Also run once immediately on boot, rather than waiting a full interval
  // for the first check after every deploy/restart.
  tick();
}
