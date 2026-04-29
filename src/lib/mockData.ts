// ============================================================================
// types & UI helpers — لا توجد بيانات وهمية. كل البيانات تأتي من /api.
// تم الإبقاء على المسار src/lib/mockData.ts للتوافق مع الاستيرادات الموجودة.
// ============================================================================

export type AgentStatus = "online" | "in_call" | "idle" | "break" | "offline";

export interface Agent {
  id: string;
  name: string;
  ext: string;
  avatar: string;
  status: AgentStatus;
  statusSince: number; // ms timestamp
  answered: number;
  missed: number;
  avgDuration: number; // seconds
  supervisor: string;
  role?: "admin" | "supervisor" | "agent";
}

export interface CallLog {
  id: string;
  agent: string;
  number: string;
  duration: number;
  status: "answered" | "missed" | "transferred";
  time: string;
}

export interface Activity {
  id: string;
  user: string;
  action: string;
  time: string;
  type: "info" | "warning" | "success" | "danger";
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  online: "متصل",
  in_call: "في مكالمة",
  idle: "خامل",
  break: "استراحة",
  offline: "غير متصل",
};

export const STATUS_HSL: Record<AgentStatus, string> = {
  online: "hsl(var(--success))",
  in_call: "hsl(var(--primary))",
  idle: "hsl(var(--warning))",
  break: "hsl(var(--info))",
  offline: "hsl(var(--muted-foreground))",
};

export function statusBadgeClass(s: AgentStatus): string {
  switch (s) {
    case "online":  return "bg-success/15 text-success border-success/30";
    case "in_call": return "bg-primary/15 text-primary border-primary/30";
    case "idle":    return "bg-warning/15 text-warning border-warning/30";
    case "break":   return "bg-info/15 text-info border-info/30";
    case "offline": return "bg-muted text-muted-foreground border-border";
  }
}

export function formatDuration(s: number): string {
  if (!s || !Number.isFinite(s)) return "00:00";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
