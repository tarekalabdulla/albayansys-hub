import { useEffect, useState } from "react";
import { socketProvider } from "@/lib/socketProvider";
import type { Agent } from "@/lib/mockData";

// Hook موحّد لمشاركة قائمة الموظفين الحيّة بين الصفحات
// يعمل مع mockSocket أو socket.io الحقيقي حسب VITE_USE_REAL_API
export function useLiveAgents(): Agent[] {
  const [agents, setAgents] = useState<Agent[]>(() => socketProvider.snapshot());

  useEffect(() => {
    socketProvider.start();

    const offList = socketProvider.on("agent:list", (list: Agent[]) => {
      setAgents(list);
    });
    const offUpd = socketProvider.on("agent:update", (a: Agent) => {
      setAgents((prev) => {
        const exists = prev.some((p) => p.id === a.id);
        return exists ? prev.map((p) => (p.id === a.id ? { ...p, ...a } : p)) : [...prev, a];
      });
    });

    return () => {
      offList();
      offUpd();
    };
  }, []);

  return agents;
}

export interface LiveAlert {
  id: string;
  level: "info" | "warning" | "danger";
  title: string;
  message: string;
  time: number;
}

export function useLiveAlerts(max = 6): LiveAlert[] {
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);

  useEffect(() => {
    socketProvider.start();
    const off = socketProvider.on("alert", (a: LiveAlert) => {
      setAlerts((prev) => [a, ...prev].slice(0, max));
    });
    return off;
  }, [max]);

  return alerts;
}
