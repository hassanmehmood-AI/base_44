import { createServer } from "node:http";
import { Server } from "socket.io";
import { Client as PgClient } from "pg";
import { verifyRealtimeToken, InvalidTokenError } from "./auth";

/** Standalone realtime notification service for the GROWTH-ON CRM — a
 * separate Railway service from the main Next.js app, not a custom server
 * grafted onto it. `next start` (what the main app runs) has no WebSocket
 * upgrade hook, and Next's own docs steer away from a custom server unless
 * strictly necessary; running this as its own small service (same pattern
 * already used for metricool-sync-trigger/metricool-sync-worker) keeps a bug
 * here from ever being able to take down the CRM itself.
 *
 * This service is deliberately "dumb": it holds exactly one Postgres
 * connection (LISTEN, never a pool — browsers never open their own DB
 * connections through this), forwards a bare pointer ({conversationId,
 * messageId}, never message content) to whichever company room is
 * authorized, and does nothing else. Postgres and the existing
 * authenticated server actions remain the only source of truth; this
 * service cannot lose a message because it never stores one. */

const PORT = Number(process.env.PORT ?? 8080);
const WS_AUTH_SECRET = process.env.WS_AUTH_SECRET;
const CRM_BASE_URL = process.env.CRM_BASE_URL;
const DATABASE_URL = process.env.DATABASE_URL;
const NOTIFY_CHANNEL = "social_messages";

if (!WS_AUTH_SECRET) throw new Error("WS_AUTH_SECRET is not set on this service.");
if (!CRM_BASE_URL) throw new Error("CRM_BASE_URL is not set on this service.");
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set on this service.");

let connectedSockets = 0;
let pgListenerHealthy = false;

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(pgListenerHealthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: pgListenerHealthy ? "ok" : "degraded", connectedSockets }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, {
  // Socket.IO's default — starts on HTTP long-polling and upgrades to a real
  // WebSocket. Confirmed against Railway's own official Socket.IO deployment
  // guide: this is what they recommend and confirm "works reliably through
  // Railway's proxy" (not assumed — checked before building this).
  transports: ["polling", "websocket"],
  cors: { origin: CRM_BASE_URL, credentials: false },
});

// Token verification happens once per connection attempt, never trusting
// anything the client claims about itself beyond what the token (minted by
// the main app's /api/realtime-token, which already ran the real
// authorization check) says.
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (typeof token !== "string" || !token) {
    next(new Error("Missing token"));
    return;
  }
  try {
    const claims = await verifyRealtimeToken(token, WS_AUTH_SECRET!);
    socket.data.userId = claims.userId;
    socket.data.companyIds = claims.companyIds;
    socket.data.roleKey = claims.roleKey;
    socket.data.expiresAt = claims.expiresAt;
    next();
  } catch (e) {
    next(e instanceof InvalidTokenError ? e : new Error("Authentication failed"));
  }
});

io.on("connection", (socket) => {
  connectedSockets++;
  const companyIds: string[] = socket.data.companyIds;
  // Each socket only ever joins the rooms its *verified* token grants —
  // never a client-supplied list. A SUPERUSER's token already carries every
  // active company (resolved server-side at mint time by the same
  // getAllowedCompaniesForCurrentUser every other authenticated read uses),
  // so no special-casing is needed here.
  for (const companyId of companyIds) {
    socket.join(`company:${companyId}`);
  }

  // Forces a reconnect once the token expires, rather than letting a
  // long-lived socket run forever on a permission snapshot that may be
  // stale. The client re-fetches a fresh token (reflecting current company
  // access) on every reconnect — this is what "revalidate access when
  // permissions change" actually means here: there's no separate push
  // mechanism for permission changes, just a short enough leash that a
  // revoked company shows up within one token lifetime.
  const expiresAt: number = socket.data.expiresAt;
  const msUntilExpiry = expiresAt * 1000 - Date.now();
  const expiryTimer = setTimeout(
    () => socket.disconnect(true),
    Math.max(msUntilExpiry, 0)
  );

  socket.on("disconnect", () => {
    clearTimeout(expiryTimer);
    connectedSockets--;
  });
});

// One dedicated connection for LISTEN — never a pool, never one per browser.
// Reconnects with backoff on its own if the connection drops, independent of
// any browser socket's lifecycle.
let pgReconnectDelayMs = 1000;
const PG_RECONNECT_MAX_DELAY_MS = 30_000;

async function startPgListener() {
  const client = new PgClient({ connectionString: DATABASE_URL });

  client.on("notification", (msg) => {
    if (msg.channel !== NOTIFY_CHANNEL || !msg.payload) return;
    let parsed: { conversationId?: string; companyId?: string; messageId?: string };
    try {
      parsed = JSON.parse(msg.payload);
    } catch {
      return;
    }
    if (!parsed.companyId || !parsed.conversationId) return;
    // Payload is deliberately a bare pointer — the client re-fetches the
    // actual message/conversation through the existing authenticated server
    // actions, never trusts content carried over this channel.
    io.to(`company:${parsed.companyId}`).emit("social:new-message", {
      conversationId: parsed.conversationId,
      messageId: parsed.messageId ?? null,
    });
  });

  client.on("error", () => {
    pgListenerHealthy = false;
    client.end().catch(() => {});
    scheduleReconnect();
  });

  client.on("end", () => {
    pgListenerHealthy = false;
    scheduleReconnect();
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    pgListenerHealthy = true;
    pgReconnectDelayMs = 1000;
    console.log(`[realtime-ws] listening on Postgres channel "${NOTIFY_CHANNEL}"`);
  } catch (e) {
    console.error("[realtime-ws] failed to start Postgres listener:", e);
    pgListenerHealthy = false;
    scheduleReconnect();
  }
}

let reconnectTimer: NodeJS.Timeout | null = null;
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    pgReconnectDelayMs = Math.min(pgReconnectDelayMs * 2, PG_RECONNECT_MAX_DELAY_MS);
    startPgListener();
  }, pgReconnectDelayMs);
}

startPgListener();

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[realtime-ws] listening on 0.0.0.0:${PORT}`);
});

process.on("SIGTERM", () => {
  httpServer.close(() => process.exit(0));
});
