// بيانات وهمية لمحاكاة مركز الاتصال
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

const ARABIC_NAMES = [
  "أحمد العتيبي", "فاطمة الزهراء", "محمد القحطاني", "نورة السبيعي",
  "خالد الدوسري", "سارة المطيري", "عبدالله الشهري", "ريم الحربي",
  "يوسف الغامدي", "هند الرشيد", "ماجد الزهراني", "لمى العنزي",
];

const SUPERVISORS = ["أ. سلمان", "أ. منى", "أ. بدر"];

export const AGENTS: Agent[] = ARABIC_NAMES.map((name, i) => {
  const statuses: AgentStatus[] = ["online", "in_call", "idle", "break", "offline"];
  const status = statuses[i % statuses.length];
  return {
    id: `AG-${1000 + i}`,
    name,
    ext: `${2100 + i}`,
    avatar: name.split(" ").map(p => p[0]).join("").slice(0, 2),
    status,
    statusSince: Date.now() - Math.floor(Math.random() * 1800_000),
    answered: 20 + Math.floor(Math.random() * 60),
    missed: Math.floor(Math.random() * 8),
    avgDuration: 90 + Math.floor(Math.random() * 240),
    supervisor: SUPERVISORS[i % SUPERVISORS.length],
  };
});

export const RECENT_CALLS: CallLog[] = Array.from({ length: 8 }).map((_, i) => ({
  id: `C-${5000 + i}`,
  agent: AGENTS[i % AGENTS.length].name,
  number: `+9665${Math.floor(10000000 + Math.random() * 89999999)}`,
  duration: 30 + Math.floor(Math.random() * 600),
  status: (["answered", "answered", "answered", "missed", "transferred"] as const)[i % 5],
  time: `${String(Math.floor(Math.random() * 23)).padStart(2, "0")}:${String(Math.floor(Math.random() * 59)).padStart(2, "0")}`,
}));

export const ACTIVITIES: Activity[] = [
  { id: "1", user: "نظام", action: "تم تسجيل دخول الموظف أحمد العتيبي", time: "منذ دقيقتين", type: "success" },
  { id: "2", user: "أ. سلمان", action: "نقل المكالمة #5021 إلى قسم الفواتير", time: "منذ 5 د", type: "info" },
  { id: "3", user: "نظام", action: "تنبيه: الموظفة هند خاملة منذ 12 دقيقة", time: "منذ 8 د", type: "warning" },
  { id: "4", user: "أ. منى", action: "أنهت جلسة استماع لمكالمة الموظف خالد", time: "منذ 15 د", type: "info" },
  { id: "5", user: "نظام", action: "تجاوز SLA في الانتظار - 6 مكالمات", time: "منذ 22 د", type: "danger" },
  { id: "6", user: "نظام", action: "نسخة احتياطية للقاعدة تمت بنجاح", time: "منذ ساعة", type: "success" },
];

export const SUPERVISOR_PERFORMANCE = SUPERVISORS.map((name, i) => ({
  name,
  team: 4,
  answered: 120 + i * 20,
  sla: 88 + i * 3,
}));

export const STATUS_LABEL: Record<AgentStatus, string> = {
  online: "متصل",
  in_call: "في مكالمة",
  idle: "خامل",
  break: "استراحة",
  offline: "غير متصل",
};

// HSL var() pulls — used in chart colors
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
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
