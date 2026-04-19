import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { formatDuration } from "@/lib/mockData";
import { useLiveAgents } from "@/hooks/useLiveAgents";
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
} from "lucide-react";
import Swal from "sweetalert2";
import { AgentDetailModal } from "@/components/performance/AgentDetailModal";

type SortKey = "name" | "answered" | "missed" | "avgDuration" | "rate";
type SortDir = "asc" | "desc";

interface Row {
  id: string;
  name: string;
  ext: string;
  supervisor: string;
  answered: number;
  missed: number;
  avgDuration: number;
  rate: number;
}

const Performance = () => {
  const [from, setFrom] = useState("2025-04-01");
  const [to, setTo] = useState("2025-04-18");
  const [supervisor, setSupervisor] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("answered");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const rows: Row[] = useMemo(
    () =>
      AGENTS.map((a) => {
        const total = a.answered + a.missed;
        return {
          id: a.id,
          name: a.name,
          ext: a.ext,
          supervisor: a.supervisor,
          answered: a.answered,
          missed: a.missed,
          avgDuration: a.avgDuration,
          rate: total === 0 ? 0 : Math.round((a.answered / total) * 100),
        };
      }),
    [],
  );

  const supervisors = useMemo(
    () => Array.from(new Set(AGENTS.map((a) => a.supervisor))),
    [],
  );

  const filtered = useMemo(() => {
    let arr = rows;
    if (supervisor !== "all") arr = arr.filter((r) => r.supervisor === supervisor);
    if (query) arr = arr.filter((r) => r.name.includes(query) || r.ext.includes(query));
    arr = [...arr].sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (typeof va === "string" && typeof vb === "string") {
        return sortDir === "asc" ? va.localeCompare(vb, "ar") : vb.localeCompare(va, "ar");
      }
      return sortDir === "asc" ? Number(va) - Number(vb) : Number(vb) - Number(va);
    });
    return arr;
  }, [rows, supervisor, query, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  const totals = useMemo(() => ({
    answered: filtered.reduce((s, r) => s + r.answered, 0),
    missed: filtered.reduce((s, r) => s + r.missed, 0),
    avgRate: filtered.length === 0 ? 0 :
      Math.round(filtered.reduce((s, r) => s + r.rate, 0) / filtered.length),
  }), [filtered]);

  const exportCSV = () => {
    const headers = ["الموظف", "التحويلة", "المشرف", "مجابة", "فائتة", "متوسط المدة (ث)", "معدل الإجابة %"];
    const lines = [headers.join(",")];
    filtered.forEach((r) => {
      lines.push([r.name, r.ext, r.supervisor, r.answered, r.missed, r.avgDuration, r.rate].join(","));
    });
    const csv = "\uFEFF" + lines.join("\n"); // BOM لدعم العربية في Excel
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

  return (
    <AppLayout title="جدول الأداء" subtitle="تقارير شاملة قابلة للتصدير">
      {/* Filters */}
      <section className="glass-card p-4 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold">أدوات التصفية</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
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
          <p className="text-2xl font-extrabold text-success mt-1">{totals.answered}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-muted-foreground">إجمالي الفائتة</p>
          <p className="text-2xl font-extrabold text-destructive mt-1">{totals.missed}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-muted-foreground">متوسط معدل الإجابة</p>
          <p className="text-2xl font-extrabold text-primary mt-1">{totals.avgRate}%</p>
        </div>
      </section>

      {/* Table */}
      <section className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-muted/50 text-xs font-bold text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-3">
                  <button onClick={() => toggleSort("name")} className="flex items-center gap-1.5">
                    الموظف <SortIcon k="name" />
                  </button>
                </th>
                <th className="px-4 py-3">التحويلة</th>
                <th className="px-4 py-3">المشرف</th>
                <th className="px-4 py-3">
                  <button onClick={() => toggleSort("answered")} className="flex items-center gap-1.5">
                    مجابة <SortIcon k="answered" />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button onClick={() => toggleSort("missed")} className="flex items-center gap-1.5">
                    فائتة <SortIcon k="missed" />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button onClick={() => toggleSort("avgDuration")} className="flex items-center gap-1.5">
                    متوسط المدة <SortIcon k="avgDuration" />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button onClick={() => toggleSort("rate")} className="flex items-center gap-1.5">
                    معدل الإجابة <SortIcon k="rate" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedAgent(r.id)}
                      className="flex items-center gap-3 group text-right"
                    >
                      <div className="w-9 h-9 rounded-lg gradient-primary grid place-items-center text-xs font-bold text-primary-foreground transition-transform group-hover:scale-110">
                        {r.name.split(" ").map(p => p[0]).join("").slice(0, 2)}
                      </div>
                      <p className="text-sm font-semibold group-hover:text-primary transition-colors underline-offset-4 group-hover:underline">
                        {r.name}
                      </p>
                    </button>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-sm font-semibold" dir="ltr">{r.ext}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{r.supervisor}</td>
                  <td className="px-4 py-3 text-sm font-bold text-success tabular-nums">{r.answered}</td>
                  <td className="px-4 py-3 text-sm font-bold text-destructive tabular-nums">{r.missed}</td>
                  <td className="px-4 py-3 text-sm tabular-nums">{formatDuration(r.avgDuration)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 min-w-[140px]">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            "h-full",
                            r.rate >= 90 ? "bg-success" : r.rate >= 70 ? "bg-warning" : "bg-destructive",
                          )}
                          style={{ width: `${r.rate}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold tabular-nums">{r.rate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">لا توجد نتائج للفلتر الحالي.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <AgentDetailModal
        agentId={selectedAgent}
        open={selectedAgent !== null}
        onClose={() => setSelectedAgent(null)}
      />
    </AppLayout>
  );
};

export default Performance;
