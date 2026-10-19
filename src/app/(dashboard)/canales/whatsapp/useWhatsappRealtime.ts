"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

export type WhatsappNewMessageEvent = { conversationId: string; messageId: string | null };

/** Live-update layer for the WhatsApp page — a direct copy of
 * canales/redes-sociales/useSocialRealtime.ts's structure and reasoning.
 * Deliberately listens to the SAME "social:new-message"/"social:resync"
 * socket events and the same realtime-ws-service: the underlying Postgres
 * NOTIFY trigger (0009_notify_new_message.sql) fires on every `messages`
 * insert regardless of channel, so it already covers WhatsApp messages with
 * zero backend changes — only this thin per-page trigger is new. Like its
 * Social Media counterpart, this never carries message content, only a
 * pointer telling the caller to re-fetch through the existing authenticated
 * server actions. */
export function useWhatsappRealtime(onChange: (event: WhatsappNewMessageEvent | { reconnected: true }) => void) {
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

    socket.on("connect", () => {
      onChangeRef.current({ reconnected: true });
    });

    socket.on("social:new-message", (payload: WhatsappNewMessageEvent) => {
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
