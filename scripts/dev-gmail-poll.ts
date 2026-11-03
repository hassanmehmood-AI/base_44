/**
 * Local development-only Gmail sync poller.
 *
 * Purpose: let incoming Gmail messages appear in Correo on localhost
 * WITHOUT Google Cloud Pub/Sub or a public tunnel (ngrok) — neither is
 * reachable from/needed by this. Runs in a second terminal, alongside
 * `npm run dev`, and repeatedly hits the exact same production-bound
 * endpoint (/api/cron/gmail-sync) Railway's cron-trigger service will call
 * on a schedule once deployed (see scripts/gmail-sync-trigger, not yet
 * wired into .railway/railway.ts). That route calls
 * gmailSync.syncAllActiveAccounts(), which for every ACTIVE mailbox:
 *   - establishes a historyId baseline via users.getProfile if one doesn't
 *     exist yet (no Pub/Sub topic needed for this — see gmailSync.ts's
 *     establishHistoryBaseline) — this is also what makes "sync only new
 *     messages, no historical import" true: the very first poll just
 *     records Gmail's current position and returns, nothing earlier is
 *     ever imported.
 *   - lists history since the last saved cursor and ingests any new
 *     messages (resolved to a CRM contact's conversation, or the
 *     Unassigned Email Inbox — see gmailSync.ts's resolveConversation).
 *
 * This script is never built into a Docker image or referenced by
 * .railway/railway.ts, is not started by `next build`/`next start`, and
 * refuses to run at all if NODE_ENV is "production" — three independent
 * reasons it can never run outside a developer's own machine.
 *
 * Usage: npm run dev:gmail-poll   (from the repo root, with `npm run dev`
 * already running in another terminal)
 */
import "dotenv/config";

// Tight on purpose — this single call (one mailbox) costs only a few Gmail
// API quota units (users.getProfile/history.list are ~1-2 units each,
// against a 250 units/second per-user default quota), so polling every few
// seconds for local testing is negligible. This IS the latency ceiling for
// "real time" without Pub/Sub: a message can't appear any faster than the
// next tick picks it up. True push-based delivery (sub-second, no polling
// floor at all) needs Google Cloud Pub/Sub with a publicly reachable
// webhook — not available locally without ngrok, which this script exists
// specifically to avoid; see api/webhooks/gmail/route.ts for that path,
// planned for the Railway deployment phase.
const POLL_INTERVAL_MS = 3_000;

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("[gmail-poll] refusing to run with NODE_ENV=production.");
    process.exit(1);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[gmail-poll] CRON_SECRET is not set in .env.local.");
    process.exit(1);
  }
  const baseUrl = (process.env.CRM_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  console.log(`[gmail-poll] polling ${baseUrl}/api/cron/gmail-sync every ${POLL_INTERVAL_MS / 1000}s — Ctrl+C to stop.`);

  // Guards against overlapping ticks piling up if one request happens to
  // run longer than the interval (e.g. a slow Gmail API response) — the
  // next tick just skips instead of firing a second concurrent sync.
  let inFlight = false;

  async function tick() {
    if (inFlight) return;
    inFlight = true;
    try {
      const res = await fetch(`${baseUrl}/api/cron/gmail-sync`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error(`[gmail-poll] sync request failed (${res.status}):`, body);
        return;
      }
      console.log(`[gmail-poll] ${new Date().toISOString()} —`, body);
    } catch (e) {
      console.error("[gmail-poll] sync request errored:", e instanceof Error ? e.message : e);
    } finally {
      inFlight = false;
    }
  }

  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

main();
