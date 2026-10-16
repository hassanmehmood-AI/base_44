"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

export type SocialNewMessageEvent = { conversationId: string; messageId: string | null };

/** Live-update layer for the Social Media inbox — a thin trigger, never a
 * data source. The realtime-ws-service (a separate Railway service, see
 * scripts/realtime-ws-service) only ever forwards a bare pointer
 * ({conversationId}), so every callback here exists purely to tell the
 * caller "go re-fetch", through the exact same authenticated server actions
 * already used elsewhere on this page. This is also what makes duplicate
 * display structurally impossible from this layer: nothing from a WS event
 * is ever written into local state directly, so there's nothing here that
 * could duplicate what the existing dedup logic (Stage 1/2 fixes in
 * social.ts) already guarantees server-side.
 *
 * NEXT_PUBLIC_REALTIME_WS_URL is optional by design: if it's unset (not yet
 * provisioned, or intentionally disabled), this hook is a no-op and the page
 * behaves exactly as it did before realtime existed — manual actions and a
 * full page reload still work, nothing regresses.
 *
 * Auth is a function, not a static value (Socket.IO calls it fresh on every
 * connect AND every reconnect) — the token is minted server-side per
 * request via /api/realtime-token, so a reconnect always carries the
 * caller's *current* company access, not a snapshot from whenever the page
 * first loaded. Combined with the realtime-ws-service's own short token TTL
 * (which force-disconnects an expired socket), this is what satisfies
 * "revalidate access when permissions change" — there's no separate push
 * channel for permission changes, just a short enough leash that a change
 * takes effect within one token lifetime. */
export function useSocialRealtime(onChange: (event: SocialNewMessageEvent | { reconnected: true }) => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_REALTIME_WS_URL;
    if (!wsUrl) return;

    const socket: Socket = io(wsUrl, {
      auth: async (callback) => {
        try {
          const res = await fetch("/api/realtime-token");
          if (!res.ok) {
            callback({});
            return;
          }
          const { token } = (await res.json()) as { token: string };
          callback({ token });
        } catch {
          callback({});
        }
      },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
    });

    // Fires on the initial connect AND every reconnect (including after the
    // server force-disconnects an expired token, or this service restarts).
    // One unconditional refresh here is what covers whatever happened while
    // disconnected — there's no attempt to track which individual events
    // were missed, since the client never trusted event payloads as data in
    // the first place.
    socket.on("connect", () => {
      onChangeRef.current({ reconnected: true });
    });

    socket.on("social:new-message", (payload: SocialNewMessageEvent) => {
      onChangeRef.current(payload);
    });

    // Emitted by the relay service itself whenever its own Postgres LISTEN
    // connection recovers from a drop (see server.ts's onPgListenerConnected)
    // — pg_notify has no durability/replay, so anything inserted during that
    // downtime is permanently lost with no per-event signal. This carries no
    // payload on purpose (never which company changed, since the relay
    // doesn't know what it missed) — treated exactly like a browser-side
    // reconnect: an unconditional full resync is the only correct recovery
    // for "something may have been missed, no way to know what."
    socket.on("social:resync", () => {
      onChangeRef.current({ reconnected: true });
    });

    // Previously silent — a failed connection (bad/expired token, the
    // realtime service being unreachable, etc.) gave zero visibility beyond
    // Socket.IO's own default console noise. Logged here so a broken
    // connection is diagnosable instead of looking identical to "nothing
    // happened yet".
    socket.on("connect_error", (err) => {
      console.error("[realtime] connection failed:", err.message);
    });

    return () => {
      socket.close();
    };
  }, []);
}
