import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { AGENTS as MOCK_AGENTS, formatDuration, STATUS_LABEL, type AgentStatus } from "@/lib/mockData";
import { useLiveAgents } from "@/hooks/useLiveAgents";
import { USE_REAL_API } from "@/lib/config";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calendar,
  Download,
  Filter,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Phone,
  PhoneOff,
  Coffee,
  Power,
  PhoneCall,
} from "lucide-react";
import Swal from "sweetalert2";
import { AgentDetailModal } from "@/components/performance/AgentDetailModal";

type SortKey = "name" | "answered" | "missed" | "outbound" | "avgDuration" | "idle";
type SortDir = "asc" | "desc";

interface Row {
  id: string;
  name: string;
  ext: string;
  supervisor: string;
  status: AgentStatus;
  answered: number;
  missed: number;
  outbound: number;
  avgDuration: number;
  idleSeconds: number;
}

// شارة الحالة بالألوان المطلوبة
const StatusPill = ({ status }: { status: AgentStatus }) => {
  const map: Record<AgentStatus, { bg: string; text: string; dot: string; Icon: typeof Phone }> = {
    in_call:  { bg: "bg-info/15",          text: "text-info",          dot: "bg-info",          Icon: PhoneCall },
    online:   { bg: "bg-success/15",       text: "text-success",       dot: "bg-success",       Icon: Phone },
    idle:     { bg: "bg-warning/15",       text: "text-warning",       dot: "bg-warning",       Icon: PhoneOff },
    break:    { bg: "bg-accent/15",        text: "text-accent",        dot: "bg-accent",        Icon: Coffee },
    offline:  { bg: "bg-muted",            text: "text-muted-foreground", dot: "bg-muted-foreground", Icon: Power },
  };
  const s = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold", s.bg, s.text)}>
      <span className="relative flex items-center justify-center">
        <span className={cn("w-1.5 h-1.5 rounded-full", s.dot)} />
        {(status === "in_call" || status === "online") && (
          <span className={cn("absolute inset-0 rounded-full animate-ping opacity-75", s.dot)} />
        )}
      </span>
      {STATUS_LABEL[status]}
      <s.Icon className="w-3 h-3 opacity-70" />
    </span>
  );
};

// لون شريط الخمول حسب المدة
const idleColor = (sec: number) => {
  const min = sec / 60;
  if (min >= 15) return "bg-destructive";
  if (min >= 10) return "bg-warning";
  if (min >= 5)  return "bg-info";
  if (min > 0)   return "bg-success";
  return "bg-muted-foreground/30";
};

// تنسيق وقت الخمول مختصر: "5 د" / "12 د"
const formatIdle = (sec: number) => {
  const min = Math.floor(sec / 60);
  if (min <= 0) return "0 د";
  if (min < 60) return `${min} د`;
  const h = Math.floor(min / 60);
  return `${h} س ${min % 60} د`;
};

// تنسيق متوسط المدة بصيغة MM:SS
const fmtMMSS = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const Performance = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [from, setFrom] = useState("2025-04-01");
  const [to, setTo] = useState("2025-04-18");
  const [supervisor, setSupervisor] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<AgentStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("answered");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  useEffect(() => {
    const id = searchParams.get("agent");
    if (id) setSelectedAgent(id);
  }, [searchParams]);

  const closeAgent = () => {
    setSelectedAgent(null);
    if (searchParams.get("agent")) {
      const next = new URLSearchParams(searchParams);
      next.delete("agent");
      setSearchParams(next, { replace: true });
    }
  };

  const liveAgents = useLiveAgents();
  const sourceAgents = USE_REAL_API ? liveAgents : MOCK_AGENTS;

  const rows: Row[] = useMemo(
    () =>
      sourceAgents.map((a) => {
        // وقت الخمول مشتق من statusSince فقط للحالات غير النشطة
        const idleSec =
          (a.status === "idle" || a.status === "break")
            ? Math.max(0, Math.floor((Date.now() - a.statusSince) / 1000))
            : 0;
        // عدد المكالمات الصادرة قد لا يتوفر — نقرأه إن وُجد
        const outbound = (a as unknown as { outbound?: number }).outbound ?? 0;
        return {
          id: a.id,
          name: a.name,
          ext: a.ext,
          supervisor: a.supervisor,
          status: a.status,
          answered: a.answered,
          missed: a.missed,
          outbound,
          avgDuration: a.avgDuration,
          idleSeconds: idleSec,
        };
      }),
    [sourceAgents],
  );

  const supervisors = useMemo(
    () => Array.from(new Set(sourceAgents.map((a) => a.supervisor))),
    [sourceAgents],
  );

  const filtered = useMemo(() => {
    let arr = rows;
    if (supervisor !== "all") arr = arr.filter((r) => r.supervisor === supervisor);
    if (statusFilter !== "all") arr = arr.filter((r) => r.status === statusFilter);
    if (query) arr = arr.filter((r) => r.name.includes(query) || r.ext.includes(query));
    arr = [...arr].sort((a, b) => {
      const va = sortKey === "idle" ? a.idleSeconds : a[sortKey as keyof Row];
      const vb = sortKey === "idle" ? b.idleSeconds : b[sortKey as keyof Row];
      if (typeof va === "string" && typeof vb === "string") {
        return sortDir === "asc" ? va.localeCompare(vb, "ar") : vb.localeCompare(va, "ar");
      }
      return sortDir === "asc" ? Number(va) - Number(vb) : Number(vb) - Number(va);
    });
    return arr;
  }, [rows, supervisor, statusFilter, query, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  const totals = useMemo(() => ({
    answered: filtered.reduce((s, r) => s + r.answered, 0),
    missed: filtered.reduce((s, r) => s + r.missed, 0),
    outbound: filtered.reduce((s, r) => s + r.outbound, 0),
  }), [filtered]);

  const exportCSV = () => {
    const headers = ["الموظف", "التحويلة", "المشرف", "الحالة", "مجابة", "فائتة", "صادرة", "متوسط المدة", "وقت الخمول"];
    const lines = [headers.join(",")];
    filtered.forEach((r) => {
      lines.push([
        r.name, r.ext, r.supervisor, STATUS_LABEL[r.status],
        r.answered, r.missed, r.outbound, fmtMMSS(r.avgDuration), formatIdle(r.idleSeconds),
      ].join(","));
    });
    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `performance_${from}_${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    Swal.fire({
      icon: "success",
      title: "تم التصدير بنجاح",
      text: `تم تصدير ${filtered.length} سجل`,
      confirmButtonColor: "hsl(174 72% 38%)",
      timer: 2200,
    });
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="w-3 h-3 opacity-50" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  // لون خلفية الصف الخفيف حسب الحالة (مثل التصميم المرجعي)
  const rowTint = (s: AgentStatus) => {
    switch (s) {
      case "in_call":  return "bg-info/[0.04]";
      case "online":   return "bg-success/[0.04]";
      case "idle":     return "bg-warning/[0.05]";
      case "break":    return "bg-accent/[0.04]";
      case "offline":  return "";
      default:         return "";
    }
  };

  // لون شريط جانبي يميني للصف
  const rowBorder = (s: AgentStatus) => {
    switch (s) {
      case "in_call":  return "border-r-info";
      case "online":   return "border-r-success";
      case "idle":     return "border-r-warning";
      case "break":    return "border-r-accent";
      case "offline":  return "border-r-muted-foreground/40";
      default:         return "border-r-transparent";
    }
  };

  // لون أحرف الأفاتار حسب الحالة
  const avatarTone = (s: AgentStatus) => {
    switch (s) {
      case "in_call":  return "bg-info/15 text-info";
      case "online":   return "bg-success/15 text-success";
      case "idle":     return "bg-warning/15 text-warning";
      case "break":    return "bg-accent/15 text-accent";
      case "offline":  return "bg-muted text-muted-foreground";
      default:         return "bg-muted text-muted-foreground";
    }
  };

  return (
    <AppLayout title="جدول الأداء" subtitle="تقارير شاملة قابلة للتصدير">
      {/* Filters */}
      <section className="glass-card p-4 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold">أدوات التصفية</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="relative">
            <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="pr-10 bg-background/60" />
          </div>
          <div className="relative">
            <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="pr-10 bg-background/60" />
          </div>
          <Select value={supervisor} onValueChange={setSupervisor}>
            <SelectTrigger className="bg-background/60"><SelectValue placeholder="المشرف" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">جميع المشرفين</SelectItem>
              {supervisors.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as AgentStatus | "all")}>
            <SelectTrigger className="bg-background/60"><SelectValue placeholder="الحالة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">جميع الحالات</SelectItem>
              <SelectItem value="in_call">{STATUS_LABEL.in_call}</SelectItem>
              <SelectItem value="online">{STATUS_LABEL.online}</SelectItem>
              <SelectItem value="idle">{STATUS_LABEL.idle}</SelectItem>
              <SelectItem value="break">{STATUS_LABEL.break}</SelectItem>
              <SelectItem value="offline">{STATUS_LABEL.offline}</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="بحث..." value={query} onChange={(e) => setQuery(e.target.value)} className="pr-10 bg-background/60" />
          </div>
          <Button onClick={exportCSV} className="gradient-primary text-primary-foreground">
            <Download className="w-4 h-4 ml-2" /> تصدير CSV
          </Button>
        </div>
      </section>

      {/* Summary */}
      <section className="grid grid-cols-3 gap-3 mb-5">
        <div className="glass-card p-4">
          <p className="text-xs text-muted-foreground">إجمالي المجابة</p>
          <p className="text-2xl font-extrabold text-success mt-1 tabular-nums">{totals.answered}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-muted-foreground">إجمالي الفائتة</p>
          <p className="text-2xl font-extrabold text-destructive mt-1 tabular-nums">{totals.missed}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-muted-foreground">إجمالي الصادرة</p>
          <p className="text-2xl font-extrabold text-info mt-1 tabular-nums">{totals.outbound}</p>
        </div>
      </section>

      {/* Table */}
      <section className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-muted/40 text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3.5">
                  <button onClick={() => toggleSort("name")} className="flex items-center gap-1.5">
                    الموظف <SortIcon k="name" />
                  </button>
                </th>
                <th className="px-4 py-3.5">التحويلة</th>
                <th className="px-4 py-3.5">الحالة</th>
                <th className="px-4 py-3.5">
                  <button onClick={() => toggleSort("answered")} className="flex items-center gap-1.5">
                    مجابة <SortIcon k="answered" />
                  </button>
                </th>
                <th className="px-4 py-3.5">
                  <button onClick={() => toggleSort("missed")} className="flex items-center gap-1.5">
                    فائتة <SortIcon k="missed" />
                  </button>
                </th>
                <th className="px-4 py-3.5">
                  <button onClick={() => toggleSort("outbound")} className="flex items-center gap-1.5">
                    صادرة <SortIcon k="outbound" />
                  </button>
                </th>
                <th className="px-4 py-3.5">
                  <button onClick={() => toggleSort("avgDuration")} className="flex items-center gap-1.5">
                    متوسط المدة <SortIcon k="avgDuration" />
                  </button>
                </th>
                <th className="px-4 py-3.5">
                  <button onClick={() => toggleSort("idle")} className="flex items-center gap-1.5">
                    وقت الخمول <SortIcon k="idle" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const idleMin = Math.min(100, Math.round((r.idleSeconds / 60 / 20) * 100)); // 20د = 100%
                return (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-b border-border/50 border-r-[3px] transition-colors hover:bg-muted/40",
                      rowTint(r.status),
                      rowBorder(r.status),
                    )}
                  >
                    {/* الموظف */}
                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => setSelectedAgent(r.id)}
                        className="flex items-center gap-3 group text-right"
                      >
                        <div className={cn(
                          "w-10 h-10 rounded-full grid place-items-center text-sm font-extrabold transition-transform group-hover:scale-110",
                          avatarTone(r.status),
                        )}>
                          {r.name.split(" ").map(p => p[0]).join("").slice(0, 1)}
                        </div>
                        <div className="leading-tight">
                          <p className="text-sm font-bold group-hover:text-primary transition-colors">
                            {r.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{r.supervisor}</p>
                        </div>
                      </button>
                    </td>

                    {/* التحويلة */}
                    <td className="px-4 py-3.5 tabular-nums text-sm font-bold text-muted-foreground" dir="ltr">
                      {r.ext}
                    </td>

                    {/* الحالة */}
                    <td className="px-4 py-3.5">
                      <StatusPill status={r.status} />
                    </td>

                    {/* مجابة */}
                    <td className="px-4 py-3.5 text-sm font-extrabold text-success tabular-nums">{r.answered}</td>

                    {/* فائتة */}
                    <td className="px-4 py-3.5 text-sm font-extrabold text-destructive tabular-nums">{r.missed}</td>

                    {/* صادرة */}
                    <td className="px-4 py-3.5 text-sm font-extrabold text-info tabular-nums">{r.outbound}</td>

                    {/* متوسط المدة */}
                    <td className="px-4 py-3.5 text-sm tabular-nums font-semibold" dir="ltr">
                      {fmtMMSS(r.avgDuration)}
                    </td>

                    {/* وقت الخمول */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2 min-w-[110px]">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn("h-full rounded-full transition-all", idleColor(r.idleSeconds))}
                            style={{ width: `${Math.max(idleMin, r.idleSeconds > 0 ? 8 : 0)}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold tabular-nums whitespace-nowrap text-muted-foreground">
                          {formatIdle(r.idleSeconds)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    لا توجد نتائج للفلتر الحالي.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <AgentDetailModal
        agentId={selectedAgent}
        open={selectedAgent !== null}
        onClose={closeAgent}
      />
    </AppLayout>
  );
};

export default Performance;
