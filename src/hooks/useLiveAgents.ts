import { useEffect, useState } from "react";
import { mockSocket } from "@/lib/mockSocket";
import type { Agent } from "@/lib/mockData";

// Hook موحّد لمشاركة قائمة الموظفين الحيّة بين الصفحات
export function useLiveAgents(): Agent[] {
  const [agents, setAgents] = useState<Agent[]>(() => mockSocket.snapshot());

  useEffect(() => {
    mockSocket.start();

    const offList = mockSocket.on("agent:list", (list: Agent[]) => {
      setAgents(list);
    });
    const offUpd = mockSocket.on("agent:update", (a: Agent) => {
      setAgents((prev) => prev.map((p) => (p.id === a.id ? a : p)));
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
    mockSocket.start();
    const off = mockSocket.on("alert", (a: LiveAlert) => {
      setAlerts((prev) => [a, ...prev].slice(0, max));
    });
    return off;
  }, [max]);

  return alerts;
}
