import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useLiveAgents, useLiveAlerts } from "@/hooks/useLiveAgents";
import { useLiveTimer } from "@/hooks/useLiveTimer";
import {
  STATUS_LABEL,
  statusBadgeClass,
  type AgentStatus,
  type Agent,
} from "@/lib/mockData";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Search,
  Headphones,
  PhoneOff,
  Eye,
  AlertTriangle,
  Activity as ActivityIcon,
  X,
} from "lucide-react";
import Swal from "sweetalert2";
import { AgentDetailModal } from "@/components/performance/AgentDetailModal";

const STATUS_FILTERS: Array<{ id: "all" | AgentStatus; label: string }> = [
  { id: "all", label: "الكل" },
  { id: "online", label: "متصل" },
  { id: "in_call", label: "في مكالمة" },
  { id: "idle", label: "خامل" },
  { id: "break", label: "استراحة" },
  { id: "offline", label: "غير متصل" },
];

// لون حافة البطاقة حسب الحالة
const BORDER_BY_STATUS: Record<AgentStatus, string> = {
  online:  "border-success/60 shadow-[0_0_0_1px_hsl(var(--success)/0.3)]",
  in_call: "border-primary/60 shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]",
  idle:    "border-warning/60 shadow-[0_0_0_1px_hsl(var(--warning)/0.35)]",
  break:   "border-info/60 shadow-[0_0_0_1px_hsl(var(--info)/0.35)]",
  offline: "border-border",
};

const DOT_BY_STATUS: Record<AgentStatus, string> = {
  online:  "bg-success",
  in_call: "bg-primary",
  idle:    "bg-warning",
  break:   "bg-info",
  offline: "bg-muted-foreground",
};

function AgentCard({ agent, onOpen }: { agent: Agent; onOpen: (id: string) => void }) {
  const timer = useLiveTimer(agent.statusSince);
  const isLive = agent.status === "in_call" || agent.status === "online";

  const handleListen = () => {
    Swal.fire({
      title: `الاستماع لمكالمة ${agent.name}`,
      text: "سيتم بدء جلسة استماع صامتة (Silent Monitoring).",
      icon: "info",
      confirmButtonText: "بدء الاستماع",
      cancelButtonText: "إلغاء",
      showCancelButton: true,
      confirmButtonColor: "hsl(174 72% 38%)",
    });
  };

  return (
    <div
      className={cn(
        "glass-card p-4 border-2 transition-all hover:-translate-y-0.5",
        BORDER_BY_STATUS[agent.status],
      )}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <div className="w-12 h-12 rounded-xl gradient-primary grid place-items-center text-sm font-bold text-primary-foreground shadow-soft">
            {agent.avatar}
          </div>
          <span
            className={cn(
              "absolute -bottom-0.5 -left-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-card",
              DOT_BY_STATUS[agent.status],
              isLive && "animate-pulse",
            )}
          />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate">{agent.name}</p>
          <p className="text-[11px] text-muted-foreground">
            تحويلة <span dir="ltr" className="font-semibold">{agent.ext}</span> · {agent.supervisor}
          </p>
          <span className={cn(
            "inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border",
            statusBadgeClass(agent.status),
          )}>
            {STATUS_LABEL[agent.status]}
          </span>
        </div>

        <div className="text-left">
          <p className="text-[10px] text-muted-foreground">منذ</p>
          <p className="font-bold tabular-nums text-sm text-primary">{timer}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-border/60">
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">مجابة</p>
          <p className="text-sm font-bold text-success">{agent.answered}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">فائتة</p>
          <p className="text-sm font-bold text-destructive">{agent.missed}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">متوسط</p>
          <p className="text-sm font-bold tabular-nums">
            {Math.floor(agent.avgDuration / 60)}:{String(agent.avgDuration % 60).padStart(2, "0")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 mt-3">
        <Button size="sm" variant="outline" className="text-xs h-8" onClick={handleListen}>
          <Headphones className="w-3 h-3 ml-1" /> استماع
        </Button>
        <Button size="sm" variant="outline" className="text-xs h-8">
          <Eye className="w-3 h-3 ml-1" /> تفاصيل
        </Button>
        <Button size="sm" variant="outline" className="text-xs h-8 text-destructive hover:text-destructive">
          <PhoneOff className="w-3 h-3 ml-1" /> فصل
        </Button>
      </div>
    </div>
  );
}

const Monitoring = () => {
  const agents = useLiveAgents();
  const alerts = useLiveAlerts(5);
  const [filter, setFilter] = useState<"all" | AgentStatus>("all");
  const [query, setQuery] = useState("");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: agents.length };
    agents.forEach((a) => { c[a.status] = (c[a.status] || 0) + 1; });
    return c;
  }, [agents]);

  const filtered = agents.filter((a) => {
    if (filter !== "all" && a.status !== filter) return false;
    if (query && !a.name.includes(query) && !a.ext.includes(query)) return false;
    return true;
  });

  const visibleAlerts = alerts.filter((a) => !dismissed.has(a.id));

  return (
    <AppLayout
      title="مراقبة الموظفين"
      subtitle="تحديثات حية كل بضع ثوانٍ"
    >
      {/* Smart Alerts */}
      <section className="space-y-2 mb-5">
        {visibleAlerts.length === 0 ? (
          <div className="glass-card flex items-center gap-3 p-3.5">
            <div className="w-9 h-9 rounded-lg bg-success/15 text-success grid place-items-center">
              <ActivityIcon className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">جميع الموظفين تحت السيطرة</p>
              <p className="text-[11px] text-muted-foreground">لا توجد تنبيهات حرجة في هذه اللحظة.</p>
            </div>
            <span className="text-[10px] px-2 py-1 rounded-full bg-success/15 text-success font-bold">LIVE</span>
          </div>
        ) : (
          visibleAlerts.map((al) => (
            <div
              key={al.id}
              className={cn(
                "glass-card flex items-center gap-3 p-3.5 border-r-4 anim-slide-up",
                al.level === "danger"  && "border-r-destructive",
                al.level === "warning" && "border-r-warning",
                al.level === "info"    && "border-r-info",
              )}
            >
              <div className={cn(
                "w-9 h-9 rounded-lg grid place-items-center",
                al.level === "danger"  && "bg-destructive/15 text-destructive",
                al.level === "warning" && "bg-warning/15 text-warning",
                al.level === "info"    && "bg-info/15 text-info",
              )}>
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{al.title}</p>
                <p className="text-[11px] text-muted-foreground truncate">{al.message}</p>
              </div>
              <button
                onClick={() => setDismissed((p) => new Set(p).add(al.id))}
                className="text-muted-foreground hover:text-foreground p-1 rounded"
                aria-label="إغلاق التنبيه"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </section>

      {/* Toolbar */}
      <section className="glass-card p-4 mb-5">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="ابحث بالاسم أو رقم التحويلة..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pr-10 bg-background/60"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                  filter === f.id
                    ? "gradient-primary text-primary-foreground border-transparent shadow-soft"
                    : "bg-background/60 border-border hover:border-primary/40",
                )}
              >
                {f.label}
                <span className={cn(
                  "mr-1.5 px-1.5 py-0.5 rounded-md text-[10px]",
                  filter === f.id ? "bg-white/25" : "bg-muted",
                )}>
                  {counts[f.id] ?? 0}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Cards Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {filtered.map((a) => (
          <AgentCard key={a.id} agent={a} />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full glass-card p-10 text-center">
            <p className="text-muted-foreground">لا يوجد موظفون مطابقون للفلتر الحالي.</p>
          </div>
        )}
      </section>
    </AppLayout>
  );
};

export default Monitoring;
