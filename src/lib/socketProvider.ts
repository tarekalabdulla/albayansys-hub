// مزوّد socket حقيقي عبر socket.io متصل بـ backend على VPS.
// واجهة موحّدة على نفس shape الذي يستخدمه useLiveAgents.
import { API_URL } from "./config";
import { tokenStorage } from "./api";
import type { Agent } from "./mockData";
import { io, Socket } from "socket.io-client";

type EventName =
  | "agent:update" | "agent:list" | "alert"
  | "call:status" | "ext:status" | "cdr:new" | "queue:event";
type Listener = (payload: any) => void;

interface SocketProvider {
  start: () => void;
  stop: () => void;
  on: (event: EventName, cb: Listener) => () => void;
  snapshot: () => Agent[];
}

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
      // أحداث Yeastar الحية (تأتي من webhook → Socket.io)
      socket.on("call:status", (p: any) => emit("call:status", p));
      socket.on("ext:status",  (p: any) => emit("ext:status", p));
      socket.on("cdr:new",     (p: any) => emit("cdr:new", p));
      socket.on("queue:event", (p: any) => emit("queue:event", p));
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

export const socketProvider: SocketProvider = createRealProvider();
