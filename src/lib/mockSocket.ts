// محاكاة Socket.io دون سيرفر — pub/sub بسيط مع setInterval.
// يمكن استبداله لاحقاً بـ socket.io-client بدون تغيير المستهلكين.
import { AGENTS, type Agent, type AgentStatus } from "./mockData";

type EventName = "agent:update" | "agent:list" | "alert";
type Listener = (payload: any) => void;

const listeners = new Map<EventName, Set<Listener>>();
let started = false;
let tickHandle: number | null = null;

// نسخة قابلة للتغيير من قائمة الموظفين
const liveAgents: Agent[] = AGENTS.map((a) => ({ ...a }));

function emit(event: EventName, payload: any) {
  listeners.get(event)?.forEach((cb) => cb(payload));
}

function randomAgentTick() {
  // اختر موظفاً عشوائياً وغيّر حالته أحياناً
  const idx = Math.floor(Math.random() * liveAgents.length);
  const a = liveAgents[idx];
  const possible: AgentStatus[] = ["online", "in_call", "idle", "break"];

  // 35% احتمال تغير الحالة
  if (Math.random() < 0.35) {
    const next = possible[Math.floor(Math.random() * possible.length)];
    if (next !== a.status) {
      a.status = next;
      a.statusSince = Date.now();
      if (next === "in_call") {
        a.answered += 1;
      }
    }
  }

  // 10% احتمال زيادة الفائتة
  if (Math.random() < 0.1) a.missed += 1;

  emit("agent:update", { ...a });

  // تنبيه عشوائي عند الخمول الطويل (> 8 دقائق)
  if (a.status === "idle" && Date.now() - a.statusSince > 8 * 60_000 && Math.random() < 0.2) {
    emit("alert", {
      id: `AL-${Date.now()}`,
      level: "warning",
      title: "خمول مطوّل",
      message: `الموظف ${a.name} خامل منذ أكثر من 8 دقائق`,
      time: Date.now(),
    });
  }
}

export const mockSocket = {
  start() {
    if (started) return;
    started = true;
    // ابعث القائمة الأولية
    setTimeout(() => emit("agent:list", liveAgents.map((a) => ({ ...a }))), 0);
    tickHandle = window.setInterval(randomAgentTick, 3500);
  },
  stop() {
    if (tickHandle != null) window.clearInterval(tickHandle);
    tickHandle = null;
    started = false;
  },
  on(event: EventName, cb: Listener): () => void {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(cb);
    return () => {
      listeners.get(event)!.delete(cb);
    };
  },
  // Snapshot فوري للمستهلكين
  snapshot(): Agent[] {
    return liveAgents.map((a) => ({ ...a }));
  },
};
