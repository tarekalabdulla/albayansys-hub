// Hook موحّد لاستهلاك أحداث Yeastar الحية على الـ Dashboard
import { useEffect, useState } from "react";
import { socketProvider } from "@/lib/socketProvider";

export interface LiveCall {
  id: string;
  extension?: string | null;
  agent_name?: string | null;
  caller_number?: string | null;
  callee_number?: string | null;
  direction?: string | null;
  status?: string | null;
  queue_name?: string | null;
  ts?: string;
}

export interface ExtStatus {
  extension: string;
  agent_name?: string | null;
  status: string;
  device_state?: string | null;
  ts?: string;
}

export interface CdrEvent extends LiveCall {
  duration?: number;
  billsec?: number;
  recording_file?: string | null;
}

export interface QueueEvent {
  action?: string;
  queue?: string;
  extension?: string;
  caller_number?: string;
  waited?: number;
  ts?: string;
}

/** يستمع لكل أحداث Yeastar ويعرض snapshot للمكالمات والتحويلات */
export function useYeastarLive() {
  const [calls, setCalls] = useState<Map<string, LiveCall>>(new Map());
  const [exts, setExts] = useState<Map<string, ExtStatus>>(new Map());
  const [recentCdr, setRecentCdr] = useState<CdrEvent[]>([]);
  const [queueEvents, setQueueEvents] = useState<QueueEvent[]>([]);

  useEffect(() => {
    socketProvider.start();

    const offCall = socketProvider.on("call:status", (p: LiveCall) => {
      setCalls((prev) => {
        const next = new Map(prev);
        if (p.status === "ended" || p.status === "hangup") next.delete(p.id);
        else next.set(p.id, { ...next.get(p.id), ...p });
        return next;
      });
    });

    const offExt = socketProvider.on("ext:status", (p: ExtStatus) => {
      setExts((prev) => {
        const next = new Map(prev);
        next.set(p.extension, { ...next.get(p.extension), ...p });
        return next;
      });
    });

    const offCdr = socketProvider.on("cdr:new", (p: CdrEvent) => {
      setRecentCdr((prev) => [p, ...prev].slice(0, 50));
      // أزل المكالمة الحية المقابلة
      setCalls((prev) => {
        const next = new Map(prev);
        next.delete(p.id);
        return next;
      });
    });

    const offQueue = socketProvider.on("queue:event", (p: QueueEvent) => {
      setQueueEvents((prev) => [p, ...prev].slice(0, 50));
    });

    return () => { offCall(); offExt(); offCdr(); offQueue(); };
  }, []);

  return {
    activeCalls: Array.from(calls.values()),
    extensions:  Array.from(exts.values()),
    recentCdr,
    queueEvents,
  };
}
