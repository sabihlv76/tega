import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { config } from "./config";
import { logger } from "./lib/logger";
import { verifyAccessToken } from "./services/tokens";

// WebSocket layer (socket.io). Private rooms are joined automatically from the access token;
// public rooms (departure boards, live trip status, parcel tracking) can be subscribed to freely.

let io: Server | null = null;

export const rooms = {
  user: (id: string) => `user:${id}`,
  operator: (id: string) => `operator:${id}`,
  station: (id: string) => `station:${id}`,
  admin: () => "admin",
  board: (stationId: string) => `board:${stationId}`,
  trip: (tripId: string) => `trip:${tripId}`,
  parcel: (code: string) => `parcel:${code}`,
};

const PUBLIC_ROOM = /^(board:[a-f0-9]{24}|trip:[a-f0-9]{24}|parcel:FP-[0-9A-Z]{8})$/;

export function initRealtime(server: HttpServer): Server {
  io = new Server(server, {
    cors: { origin: config.corsOrigins, credentials: true },
    path: "/socket.io",
    serveClient: false,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (token) {
      const claims = await verifyAccessToken(token);
      if (claims) socket.data.user = claims;
    }
    next();
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user as Awaited<ReturnType<typeof verifyAccessToken>>;
    if (user) {
      socket.join(rooms.user(user.sub));
      if (user.role === "operator" && user.op) socket.join(rooms.operator(user.op));
      if (user.role === "station" && user.st) socket.join(rooms.station(user.st));
      if (user.role === "admin") socket.join(rooms.admin());
    }
    socket.on("subscribe", (room: unknown) => {
      if (typeof room === "string" && PUBLIC_ROOM.test(room)) socket.join(room);
    });
    socket.on("unsubscribe", (room: unknown) => {
      if (typeof room === "string") socket.leave(room);
    });
  });

  logger.info("Realtime (socket.io) ready");
  return io;
}

export function emit(room: string | string[], event: string, payload: unknown): void {
  if (!io) return;
  io.to(room).emit(event, payload);
}

export async function closeRealtime(): Promise<void> {
  if (io) {
    await io.close();
    io = null;
  }
}
