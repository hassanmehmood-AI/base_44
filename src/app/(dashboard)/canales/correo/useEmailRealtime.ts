"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

export type EmailNewMessageEvent = { conversationId: string; messageId: string | null };

/** Dev-only fallback when the real realtime-ws-service isn't configured
 * (NEXT_PUBLIC_REALTIME_WS_URL unset — true for a plain `next dev` unless
 * that separate service is also started locally; Railway's base_44 service
 * always has this var set — see .railway/railway.ts's env preserve list —
 * so this branch can never run in production even if NODE_ENV were ever
 * misconfigured there). Re-uses the exact same "reconnected" signal the
 * real socket sends, which the caller already treats as "something may
 * have changed, refetch everything currently open" — this is what makes
 * scripts/dev-gmail-poll.ts's backend sync visible in the UI without a
 * manual refresh while testing locally, with zero changes to CorreoClient.
 * Guarded a second, independent way (explicit NODE_ENV check) as defense
 * in depth, not just inferred from the URL being unset.
 *
 * Kept tight (matches scripts/dev-gmail-poll.ts's own interval) so the UI
 * reflects a newly-synced message almost as soon as the backend poll has
 * it, rather than adding its own separate multi-second lag on top — dev
 * convenience only, this entire branch never runs in production. */
const DEV_POLL_INTERVAL_MS = 3_000;

/** Live-update layer for the Correo (Email) page — a direct copy of
 * canales/whatsapp/useWhatsappRealtime.ts's structure and reasoning.
 * Deliberately listens to the SAME "social:new-message"/"social:resync"
 * socket events and the same realtime-ws-service: the underlying Postgres
 * NOTIFY trigger (0009_notify_new_message.sql) fires on every `messages`
 * insert regardless of channel, so it already covers Gmail-synced inbound
 * messages with zero backend changes — only this thin per-page hook is new.
 * Like its WhatsApp/Social counterparts, this never carries message
 * content, only a pointer telling the caller to re-fetch through the
 * existing authenticated server actions. */
export function useEmailRealtime(onChange: (event: EmailNewMessageEvent | { reconnected: true }) => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_REALTIME_WS_URL;
    if (!wsUrl) {
      if (process.env.NODE_ENV === "production") return;
      const interval = setInterval(() => onChangeRef.current({ reconnected: true }), DEV_POLL_INTERVAL_MS);
      return () => clearInterval(interval);
    }

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

    socket.on("connect", () => {
      onChangeRef.current({ reconnected: true });
    });

    socket.on("social:new-message", (payload: EmailNewMessageEvent) => {
      onChangeRef.current(payload);
    });

    socket.on("social:resync", () => {
      onChangeRef.current({ reconnected: true });
    });

    socket.on("connect_error", (err) => {
      console.error("[realtime] connection failed:", err.message);
    });

    return () => {
      socket.close();
    };
  }, []);
}
