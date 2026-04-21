// مزوّد socket موحّد — يختار بين mockSocket و socket.io الحقيقي
// حسب VITE_USE_REAL_API. واجهة موحّدة على نفس shape الذي يستخدمه useLiveAgents.
import { USE_REAL_API, API_URL } from "./config";
import { mockSocket } from "./mockSocket";
import { tokenStorage } from "./api";
import type { Agent } from "./mockData";
import { io, Socket } from "socket.io-client";

type EventName = "agent:update" | "agent:list" | "alert" | "call:live" | "call:ended";
type Listener = (payload: any) => void;

interface SocketProvider {
  start: () => void;
  stop: () => void;
  on: (event: EventName, cb: Listener) => () => void;
  snapshot: () => Agent[];
}

// ============== Real Socket.io provider ==============
function createRealProvider(): SocketProvider {
  let socket: Socket | null = null;
  let started = false;
  const cache: Agent[] = [];
  const listeners = new Map<EventName, Set<Listener>>();

  const emit = (e: EventName, p: any) => listeners.get(e)?.forEach((cb) => cb(p));

  return {
    start() {
      if (started) return;
      started = true;
      socket = io(API_URL, {
        path: "/socket.io",
        transports: ["websocket", "polling"],
        auth: { token: tokenStorage.get() },
        reconnection: true,
      });
      socket.on("agent:list", (list: Agent[]) => {
        cache.splice(0, cache.length, ...list);
        emit("agent:list", list);
      });
      socket.on("agent:update", (a: Partial<Agent>) => {
        const idx = cache.findIndex((x) => x.id === a.id);
        if (idx >= 0) cache[idx] = { ...cache[idx], ...a } as Agent;
        emit("agent:update", a);
      });
      socket.on("alert", (a: any) => emit("alert", a));
      socket.on("call:live", (p: any) => emit("call:live", p));
      socket.on("call:ended", (p: any) => emit("call:ended", p));
      socket.on("connect_error", (e) => console.warn("[socket]", e.message));
    },
    stop() {
      socket?.disconnect();
      socket = null;
      started = false;
    },
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return () => listeners.get(event)!.delete(cb);
    },
    snapshot() {
      return cache.map((a) => ({ ...a }));
    },
  };
}

export const socketProvider: SocketProvider = USE_REAL_API
  ? createRealProvider()
  : mockSocket;
