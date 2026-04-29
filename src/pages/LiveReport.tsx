import { useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { AppLayout } from "@/components/layout/AppLayout";
import { useLiveAgents } from "@/hooks/useLiveAgents";
import { StatusDoughnut } from "@/components/dashboard/StatusDoughnut";
import {
  STATUS_LABEL,
  statusBadgeClass,
  formatDuration,
} from "@/lib/mockData";
import { useLiveTimer } from "@/hooks/useLiveTimer";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/mockData";
import { api } from "@/lib/api";
import { socketProvider } from "@/lib/socketProvider";
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Inbox, Loader2, Download, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

function cssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `hsl(${v})`;
}
function cssVarA(name: string, alpha: number): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `hsl(${v} / ${alpha})`;
}

// نطاق ساعات العمل (8 ص → 5 م) — يوافق التسميات المعروضة
const WORK_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const HOUR_LABELS = ["8", "9", "10", "11", "12", "1", "2", "3", "4", "5"];

function HourlyDistribution() {
  const [buckets, setBuckets] = useState<number[]>(() => Array(WORK_HOURS.length).fill(0));
  const [loading, setLoading] = useState(true);

  // نقطة البدء: تحميل مكالمات اليوم من /api/calls ثم تجميعها لكل ساعة
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        const { data } = await api.get<{ calls: Array<{ startedAt: string }> }>("/calls", {
          params: { limit: "500", since: since.toISOString() },
        });
        if (cancelled) return;
        const next = Array(WORK_HOURS.length).fill(0);
        (data?.calls || []).forEach((c) => {
          const h = new Date(c.startedAt).getHours();
          const idx = WORK_HOURS.indexOf(h);
          if (idx >= 0) next[idx] += 1;
        });
        setBuckets(next);
      } catch {
        if (!cancelled) setBuckets(Array(WORK_HOURS.length).fill(0));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // تحديث حي: كلما انتهت مكالمة جديدة (call:ended) نزيد عدّاد الساعة الموافقة
  useEffect(() => {
    const off = socketProvider.on("call:ended", (payload: any) => {
      const iso = payload?.startedAt || payload?.endedAt || new Date().toISOString();
      const h = new Date(iso).getHours();
      const idx = WORK_HOURS.indexOf(h);
      if (idx < 0) return;
      setBuckets((prev) => {
        const copy = [...prev];
        copy[idx] = (copy[idx] || 0) + 1;
        return copy;
      });
    });
    return off;
  }, []);

  return (
    <div className="glass-card p-5 anim-fade-in">
      <h3 className="text-base font-bold mb-1">توزيع المكالمات بالساعة</h3>
      <p className="text-xs text-muted-foreground mb-4">
        اليوم — حسب ساعة الاستلام {loading ? "(جاري التحميل…)" : "(تحديث حي)"}
      </p>
      <div className="h-[240px]">
        <Bar
          data={{
            labels: HOUR_LABELS,
            datasets: [{
              label: "مكالمات",
              data: buckets,
              backgroundColor: cssVarA("--primary", 0.7),
              hoverBackgroundColor: cssVar("--primary"),
              borderRadius: 8,
              borderSkipped: false,
            }],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { rtl: true, bodyFont: { family: "Cairo" }, titleFont: { family: "Cairo" } },
            },
            scales: {
              x: {
                ticks: { color: cssVar("--muted-foreground"), font: { family: "Cairo" } },
                grid: { display: false },
              },
              y: {
                ticks: { color: cssVar("--muted-foreground"), font: { family: "Cairo" } },
                grid: { color: cssVarA("--border", 0.6) },
              },
            },
          }}
        />
      </div>
    </div>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const timer = useLiveTimer(agent.statusSince);
  const total = agent.answered + agent.missed;
  const rate = total === 0 ? 0 : Math.round((agent.answered / total) * 100);

  return (
    <tr className="border-b border-border/50 hover:bg-muted/40 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg gradient-primary grid place-items-center text-xs font-bold text-primary-foreground">
            {agent.avatar}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{agent.name}</p>
            <p className="text-[11px] text-muted-foreground">{agent.supervisor}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 tabular-nums text-sm font-semibold" dir="ltr">{agent.ext}</td>
      <td className="px-4 py-3">
        <span className={cn(
          "text-[10px] font-bold px-2 py-1 rounded-full border whitespace-nowrap",
          statusBadgeClass(agent.status),
        )}>
          {STATUS_LABEL[agent.status]}
        </span>
      </td>
      <td className="px-4 py-3 text-sm font-bold text-success tabular-nums">{agent.answered}</td>
      <td className="px-4 py-3 text-sm font-bold text-destructive tabular-nums">{agent.missed}</td>
      <td className="px-4 py-3 text-sm tabular-nums">{formatDuration(agent.avgDuration)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 min-w-[120px]">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                rate >= 90 ? "bg-success" : rate >= 70 ? "bg-warning" : "bg-destructive",
              )}
              style={{ width: `${rate}%` }}
            />
          </div>
          <span className="text-xs font-bold tabular-nums">{rate}%</span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm tabular-nums text-primary font-bold">{timer}</td>
    </tr>
  );
}

// ============================================================================
// CallLogsSection — سجل المكالمات الواردة/الصادرة/الفائتة (بيانات حقيقية فقط)
// ----------------------------------------------------------------------------
// • يقرأ من /api/calls (جدول calls المرتبط بـ agents عبر agent_id)
// • ثلاث تبويبات: واردة، صادرة، فائتة
// • لا توجد بيانات وهمية إطلاقاً — حالة فارغة واضحة عند غياب السجلات
// ============================================================================
type CallRow = {
  id: string;
  number: string;
  duration: number;
  status: "answered" | "missed" | "transferred";
  direction: "inbound" | "outbound" | "internal";
  startedAt: string;
  agent: string | null;
  ext: string | null;
};

type TabKey = "inbound" | "outbound" | "missed";

const TAB_META: Record<TabKey, { label: string; icon: typeof PhoneIncoming; color: string }> = {
  inbound:  { label: "واردة", icon: PhoneIncoming,  color: "text-info" },
  outbound: { label: "صادرة", icon: PhoneOutgoing,  color: "text-success" },
  missed:   { label: "فائتة", icon: PhoneMissed,    color: "text-destructive" },
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("ar", {
      hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
    }).format(d);
  } catch { return "—"; }
}
// ---- مساعدات تصدير سجل المكالمات (CSV / Excel) ------------------------------
const STATUS_AR: Record<CallRow["status"], string> = {
  answered: "مجابة",
  missed: "فائتة",
  transferred: "محوّلة",
};

function buildExportRows(calls: CallRow[]) {
  return calls.map((c) => ({
    "الوقت": formatTime(c.startedAt),
    "الرقم": c.number ?? "",
    "الموظف": c.agent ?? "",
    "التحويلة": c.ext ?? "",
    "الحالة": STATUS_AR[c.status] ?? c.status,
    "المدة (ث)": c.duration ?? 0,
  }));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCallsCsv(calls: CallRow[], tabLabel: string) {
  const rows = buildExportRows(calls);
  const ws = XLSX.utils.json_to_sheet(rows);
  // \ufeff = BOM لضمان فتح Excel للملف بترميز UTF-8 وعرض العربية صحيحاً
  const csv = "\ufeff" + XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  downloadBlob(blob, `call-logs-${tabLabel}-${stamp}.csv`);
}

function exportCallsXlsx(calls: CallRow[], tabLabel: string) {
  const rows = buildExportRows(calls);
  const ws = XLSX.utils.json_to_sheet(rows);
  // عرض الأعمدة المناسب
  ws["!cols"] = [{ wch: 18 }, { wch: 16 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tabLabel);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  XLSX.writeFile(wb, `call-logs-${tabLabel}-${stamp}.xlsx`);
}

function CallLogsSection() {
  const [tab, setTab] = useState<TabKey>("inbound");
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchCalls() {
      setLoading(true);
      setError(null);
      try {
        // فلترة على مستوى السيرفر لتقليل الحمل
        const params: Record<string, string> = { limit: "50" };
        if (tab === "missed") params.status = "missed";
        else if (tab === "inbound")  params.direction = "inbound";
        else if (tab === "outbound") params.direction = "outbound";

        const { data } = await api.get<{ calls: CallRow[] }>("/calls", { params });
        if (!cancelled) setCalls(Array.isArray(data?.calls) ? data.calls : []);
      } catch (e) {
        if (!cancelled) {
          const msg = (e as { response?: { data?: { error?: string } }; message?: string })
            ?.response?.data?.error
            || (e as { message?: string })?.message
            || "تعذّر تحميل المكالمات";
          setError(msg);
          setCalls([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchCalls();
    const t = setInterval(fetchCalls, 15_000); // تحديث كل 15 ثانية
    return () => { cancelled = true; clearInterval(t); };
  }, [tab]);

  const counts = useMemo(() => ({
    // العدّاد يعكس الصفحة الحالية فقط (آخر 50) — كافٍ لمؤشّر بصري
    current: calls.length,
  }), [calls]);

  return (
    <section className="glass-card overflow-hidden anim-fade-in mt-5">
      <div className="flex items-center justify-between p-5 border-b border-border/60 flex-wrap gap-3">
        <div>
          <h3 className="text-base font-bold">سجل المكالمات</h3>
          <p className="text-xs text-muted-foreground">واردة / صادرة / فائتة — بيانات حقيقية من السنترال</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(Object.keys(TAB_META) as TabKey[]).map((k) => {
            const meta = TAB_META[k];
            const Icon = meta.icon;
            const active = tab === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 text-muted-foreground border-border hover:bg-muted",
                )}
              >
                <Icon className={cn("w-3.5 h-3.5", active ? "text-primary-foreground" : meta.color)} />
                {meta.label}
              </button>
            );
          })}

          {/* فاصل بصري بين التبويبات وأزرار التصدير */}
          <span className="w-px h-5 bg-border mx-1" aria-hidden />

          {/* أزرار التصدير — تصدّر السجلات الظاهرة في التبويب الحالي فقط */}
          <button
            type="button"
            onClick={() => exportCallsCsv(calls, TAB_META[tab].label)}
            disabled={calls.length === 0}
            title="تصدير CSV"
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors",
              "bg-muted/40 text-muted-foreground border-border hover:bg-muted",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            type="button"
            onClick={() => exportCallsXlsx(calls, TAB_META[tab].label)}
            disabled={calls.length === 0}
            title="تصدير Excel"
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors",
              "bg-success/15 text-success border-success/30 hover:bg-success/25",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Excel
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        {loading && calls.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">جاري التحميل...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-destructive font-semibold">{error}</p>
            <p className="text-xs text-muted-foreground mt-1">تأكد من اتصال الخادم وتشغيل الـ API.</p>
          </div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Inbox className="w-10 h-10 text-muted-foreground/60 mb-2" />
            <p className="text-sm font-semibold text-foreground">لا توجد مكالمات {TAB_META[tab].label}</p>
            <p className="text-xs text-muted-foreground mt-1">
              ستظهر السجلات تلقائياً عند ورود أحداث من السنترال.
            </p>
          </div>
        ) : (
          <table className="w-full text-right">
            <thead className="bg-muted/50 text-xs font-bold text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-3 text-right">الوقت</th>
                <th className="px-4 py-3 text-right">الرقم</th>
                <th className="px-4 py-3 text-right">الموظف</th>
                <th className="px-4 py-3 text-right">التحويلة</th>
                <th className="px-4 py-3 text-right">الحالة</th>
                <th className="px-4 py-3 text-right">المدة</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} className="border-b border-border/50 hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums" dir="ltr">
                    {formatTime(c.startedAt)}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold tabular-nums" dir="ltr">{c.number}</td>
                  <td className="px-4 py-3 text-sm">{c.agent || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-3 text-sm tabular-nums" dir="ltr">
                    {c.ext || <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "text-[10px] font-bold px-2 py-1 rounded-full border whitespace-nowrap",
                      c.status === "answered" && "bg-success/15 text-success border-success/30",
                      c.status === "missed" && "bg-destructive/15 text-destructive border-destructive/30",
                      c.status === "transferred" && "bg-info/15 text-info border-info/30",
                    )}>
                      {c.status === "answered" ? "مجابة" : c.status === "missed" ? "فائتة" : "محوّلة"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm tabular-nums" dir="ltr">{formatDuration(c.duration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {calls.length > 0 && (
        <div className="px-5 py-2 border-t border-border/60 text-[11px] text-muted-foreground">
          عرض {counts.current} سجل (آخر 50)
        </div>
      )}
    </section>
  );
}

function LiveKpiStrip({ agents }: { agents: Agent[] }) {
  // KPIs محسوبة من القائمة الحيّة — تُعاد عند كل تحديث agent:update
  const stats = useMemo(() => {
    const total = agents.length;
    const inCall = agents.filter((a) => a.status === "in_call").length;
    const online = agents.filter((a) => a.status === "online").length;
    const offline = agents.filter((a) => a.status === "offline").length;
    const answered = agents.reduce((s, a) => s + (a.answered || 0), 0);
    const missed = agents.reduce((s, a) => s + (a.missed || 0), 0);
    const totalCalls = answered + missed;
    const rate = totalCalls === 0 ? 0 : Math.round((answered / totalCalls) * 100);
    return { total, inCall, online, offline, answered, missed, rate };
  }, [agents]);

  const items = [
    { label: "إجمالي الموظفين", value: stats.total, color: "text-foreground" },
    { label: "في مكالمة الآن", value: stats.inCall, color: "text-primary" },
    { label: "متصل", value: stats.online, color: "text-success" },
    { label: "غير متصل", value: stats.offline, color: "text-muted-foreground" },
    { label: "مكالمات مجابة", value: stats.answered, color: "text-success" },
    { label: "مكالمات فائتة", value: stats.missed, color: "text-destructive" },
    { label: "معدل الإجابة", value: `${stats.rate}%`, color: "text-info" },
  ];

  return (
    <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-5">
      {items.map((it) => (
        <div key={it.label} className="glass-card p-3 text-center anim-fade-in">
          <p className="text-[11px] text-muted-foreground mb-1">{it.label}</p>
          <p className={cn("text-xl font-bold tabular-nums", it.color)}>{it.value}</p>
        </div>
      ))}
    </section>
  );
}

const LiveReport = () => {
  const agents = useLiveAgents();

  return (
    <AppLayout title="التقرير الحي" subtitle="بيانات لحظية لأداء فريق العمل">
      {/* KPI Strip — يتحدث لحظياً مع كل حدث agent:update */}
      <LiveKpiStrip agents={agents} />

      {/* Charts Row */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <StatusDoughnut />
        <HourlyDistribution />
      </section>

      {/* Performance Table */}
      <section className="glass-card overflow-hidden anim-fade-in">
        <div className="flex items-center justify-between p-5 border-b border-border/60">
          <div>
            <h3 className="text-base font-bold">أداء الموظفين التفصيلي</h3>
            <p className="text-xs text-muted-foreground">يتحدث تلقائياً</p>
          </div>
          <span className="flex items-center gap-2 text-xs font-bold text-success">
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
            </span>
            LIVE
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-muted/50 text-xs font-bold text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-3 text-right">الموظف</th>
                <th className="px-4 py-3 text-right">التحويلة</th>
                <th className="px-4 py-3 text-right">الحالة</th>
                <th className="px-4 py-3 text-right">مجابة</th>
                <th className="px-4 py-3 text-right">فائتة</th>
                <th className="px-4 py-3 text-right">متوسط المدة</th>
                <th className="px-4 py-3 text-right">معدل الإجابة</th>
                <th className="px-4 py-3 text-right">منذ</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <AgentRow key={a.id} agent={a} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* قسم سجل المكالمات الحقيقية — تحت قسم التقرير الحي */}
      <CallLogsSection />
    </AppLayout>
  );
};

export default LiveReport;
