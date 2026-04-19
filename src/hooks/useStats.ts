import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { USE_REAL_API } from "@/lib/config";

export interface StatsOverview {
  totals: {
    agents: number;
    inCall: number;
    answered: number;
    missed: number;
    avgDuration: number;
    sla: number;
  };
  statusCounts: {
    online: number;
    in_call: number;
    idle: number;
    break: number;
    offline: number;
  };
  trend: { date: string; answered: number; missed: number }[];
  hourly: { hour: number; count: number }[];
  supervisors: { name: string; team: number; answered: number; sla: number }[];
}

const EMPTY: StatsOverview = {
  totals: { agents: 0, inCall: 0, answered: 0, missed: 0, avgDuration: 0, sla: 0 },
  statusCounts: { online: 0, in_call: 0, idle: 0, break: 0, offline: 0 },
  trend: [],
  hourly: [],
  supervisors: [],
};

export function useStats(refreshMs = 15_000): StatsOverview {
  const [data, setData] = useState<StatsOverview>(EMPTY);

  useEffect(() => {
    if (!USE_REAL_API) return;
    let cancel = false;

    const load = async () => {
      try {
        const { data } = await api.get<StatsOverview>("/stats/overview");
        if (!cancel) setData(data);
      } catch {
        /* احتفظ بالقيم الفارغة */
      }
    };
    load();
    const id = setInterval(load, refreshMs);
    return () => { cancel = true; clearInterval(id); };
  }, [refreshMs]);

  return data;
}

export interface RecentCall {
  id: string;
  agent: string;
  number: string;
  duration: number;
  status: string;
  time: string;
}

export function useRecentCalls(refreshMs = 15_000): RecentCall[] {
  const [calls, setCalls] = useState<RecentCall[]>([]);
  useEffect(() => {
    if (!USE_REAL_API) return;
    let cancel = false;
    const load = async () => {
      try {
        const { data } = await api.get<{ calls: RecentCall[] }>("/stats/recent-calls");
        if (!cancel) setCalls(data.calls || []);
      } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, refreshMs);
    return () => { cancel = true; clearInterval(id); };
  }, [refreshMs]);
  return calls;
}

export interface ActivityItem {
  id: string;
  type: "info" | "warning" | "danger";
  action: string;
  message?: string;
  time: string;
}

export function useActivities(refreshMs = 20_000): ActivityItem[] {
  const [items, setItems] = useState<ActivityItem[]>([]);
  useEffect(() => {
    if (!USE_REAL_API) return;
    let cancel = false;
    const load = async () => {
      try {
        const { data } = await api.get<{ activities: ActivityItem[] }>("/stats/activities");
        if (!cancel) setItems(data.activities || []);
      } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, refreshMs);
    return () => { cancel = true; clearInterval(id); };
  }, [refreshMs]);
  return items;
}
