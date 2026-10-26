"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { getAccessToken, onTokenChange } from "./api";

// One shared socket.io connection to the API for live updates (payments, trip status, departure
// boards, parcel tracking, staff dashboards). Rooms are re-joined automatically after reconnects.

let socket: Socket | null = null;
const joined = new Map<string, number>();

function socketUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SOCKET_URL;
  if (configured) return configured;
  return `${window.location.protocol}//${window.location.hostname}:4000`;
}

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(socketUrl(), {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    auth: (cb) => cb({ token: getAccessToken() }),
    reconnectionDelayMax: 10_000,
  });
  socket.on("connect", () => {
    for (const room of joined.keys()) socket?.emit("subscribe", room);
  });
  // Reconnect with the new identity when the user signs in or out.
  onTokenChange(() => {
    if (socket?.connected) {
      socket.disconnect();
      socket.connect();
    }
  });
  return socket;
}

export function useSocketEvent<T>(event: string, handler: (payload: T) => void, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const s = getSocket();
    const listener = (payload: T) => ref.current(payload);
    s.on(event, listener);
    return () => {
      s.off(event, listener);
    };
  }, [event, enabled]);
}

export function useSocketRooms(rooms: (string | null | undefined)[]): void {
  const key = rooms.filter(Boolean).sort().join("|");
  useEffect(() => {
    if (!key) return;
    const s = getSocket();
    const list = key.split("|");
    for (const room of list) {
      joined.set(room, (joined.get(room) ?? 0) + 1);
      if (s.connected) s.emit("subscribe", room);
    }
    return () => {
      for (const room of list) {
        const n = (joined.get(room) ?? 1) - 1;
        if (n <= 0) {
          joined.delete(room);
          s.emit("unsubscribe", room);
        } else joined.set(room, n);
      }
    };
  }, [key]);
}
