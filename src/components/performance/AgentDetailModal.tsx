import { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneForwarded,
  Clock,
  TrendingUp,
  Award,
  User,
  FileDown,
  Loader2,
} from "lucide-react";
import Swal from "sweetalert2";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { AGENTS, formatDuration, type Agent } from "@/lib/mockData";
import { useLiveAgents } from "@/hooks/useLiveAgents";
import { cn } from "@/lib/utils";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
);

interface AgentDetailModalProps {
  agentId: string | null;
  open: boolean;
  onClose: () => void;
}

interface CallEntry {
  id: string;
  number: string;
  duration: number;
  status: "answered" | "missed" | "transferred";
  time: string;
  date: string;
}

// توليد آخر ١٠ مكالمات مستقرة لكل موظف
function generateRecentCalls(agent: Agent): CallEntry[] {
  const seed = parseInt(agent.id.replace(/\D/g, ""), 10) || 1;
  const rng = (n: number) => {
    const x = Math.sin(seed * (n + 1)) * 10000;
    return x - Math.floor(x);
  };
  return Array.from({ length: 10 }).map((_, i) => {
    const r = rng(i);
    const status: CallEntry["status"] =
      r < 0.7 ? "answered" : r < 0.88 ? "transferred" : "missed";
    const hh = String(8 + Math.floor(rng(i + 11) * 10)).padStart(2, "0");
    const mm = String(Math.floor(rng(i + 21) * 59)).padStart(2, "0");
    const day = 18 - Math.floor(i / 3);
    return {
      id: `C-${seed}-${i}`,
      number: `+9665${Math.floor(10000000 + rng(i + 31) * 89999999)}`,
      duration: status === "missed" ? 0 : 45 + Math.floor(rng(i + 41) * 380),
      status,
      time: `${hh}:${mm}`,
      date: `2025-04-${String(day).padStart(2, "0")}`,
    };
  });
}

// توليد بيانات أسبوعية مستقرة
function generateWeeklyData(agent: Agent) {
  const seed = parseInt(agent.id.replace(/\D/g, ""), 10) || 1;
  const rng = (n: number) => {
    const x = Math.sin(seed * (n + 7)) * 10000;
    return x - Math.floor(x);
  };
  const days = ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
  return days.map((d, i) => ({
    day: d,
    answered: 8 + Math.floor(rng(i) * 22),
    missed: Math.floor(rng(i + 100) * 5),
  }));
}

type CallStatusFilter = "all" | "answered" | "missed" | "transferred";
type TimeFilter = "all" | "morning" | "afternoon" | "evening";

export function AgentDetailModal({ agentId, open, onClose }: AgentDetailModalProps) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [callStatusFilter, setCallStatusFilter] = useState<CallStatusFilter>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");

  // ابحث في الموظفين الحيين أولاً (وضع الإنتاج) ثم في البيانات الوهمية (التطوير)
  const liveAgents = useLiveAgents();
  const agent = useMemo(
    () =>
      (agentId
        ? liveAgents.find((a) => a.id === agentId) ||
          AGENTS.find((a) => a.id === agentId)
        : null) || null,
    [agentId, liveAgents],
  );

  const recentCalls = useMemo(
    () => (agent ? generateRecentCalls(agent) : []),
    [agent],
  );

  const filteredCalls = useMemo(() => {
    return recentCalls.filter((c) => {
      if (callStatusFilter !== "all" && c.status !== callStatusFilter) return false;
      if (timeFilter !== "all") {
        const hour = parseInt(c.time.split(":")[0], 10);
        if (timeFilter === "morning" && !(hour >= 6 && hour < 12)) return false;
        if (timeFilter === "afternoon" && !(hour >= 12 && hour < 17)) return false;
        if (timeFilter === "evening" && !(hour >= 17 || hour < 6)) return false;
      }
      return true;
    });
  }, [recentCalls, callStatusFilter, timeFilter]);

  const weekly = useMemo(
    () => (agent ? generateWeeklyData(agent) : []),
    [agent],
  );

  const downloadPdf = async () => {
    if (!reportRef.current || !agent) return;
    try {
      setExporting(true);
      await new Promise((r) => setTimeout(r, 350));
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const bgVar = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        backgroundColor: bgVar ? `hsl(${bgVar})` : "#ffffff",
        useCORS: true,
        logging: false,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW - 16;
      const imgH = (canvas.height * imgW) / canvas.width;
      let heightLeft = imgH;
      let position = 8;
      pdf.addImage(imgData, "PNG", 8, position, imgW, imgH);
      heightLeft -= pageH - 16;
      while (heightLeft > 0) {
        pdf.addPage();
        position = 8 - (imgH - heightLeft);
        pdf.addImage(imgData, "PNG", 8, position, imgW, imgH);
        heightLeft -= pageH - 16;
      }
      const fileName = `report-${agent.name.replace(/\s+/g, "_")}-${new Date().toISOString().slice(0, 10)}.pdf`;
      pdf.save(fileName);
      Swal.fire({
        icon: "success",
        title: "تم تحميل التقرير",
        text: fileName,
        timer: 1800,
        showConfirmButton: false,
        confirmButtonColor: "hsl(174 72% 38%)",
      });
    } catch (e) {
      Swal.fire({ icon: "error", title: "تعذّر إنشاء PDF", text: String(e) });
    } finally {
      setExporting(false);
    }
  };

  if (!agent) return null;

  const total = agent.answered + agent.missed;
  const answerRate = total === 0 ? 0 : Math.round((agent.answered / total) * 100);

  // إحصائيات المكالمات
  const callStats = recentCalls.reduce(
    (acc, c) => {
      acc[c.status]++;
      return acc;
    },
    { answered: 0, missed: 0, transferred: 0 } as Record<CallEntry["status"], number>,
  );

  // ألوان من الـ design tokens
  const css = getComputedStyle(document.documentElement);
  const successC = `hsl(${css.getPropertyValue("--success").trim()})`;
  const destC = `hsl(${css.getPropertyValue("--destructive").trim()})`;
  const infoC = `hsl(${css.getPropertyValue("--info").trim()})`;
  const primaryC = `hsl(${css.getPropertyValue("--primary").trim()})`;
  const mutedC = `hsl(${css.getPropertyValue("--muted-foreground").trim()})`;

  const doughnutData = {
    labels: ["مجابة", "محولة", "فائتة"],
    datasets: [
      {
        data: [callStats.answered, callStats.transferred, callStats.missed],
        backgroundColor: [successC, infoC, destC],
        borderWidth: 0,
      },
    ],
  };

  const barData = {
    labels: weekly.map((w) => w.day),
    datasets: [
      {
        label: "مجابة",
        data: weekly.map((w) => w.answered),
        backgroundColor: successC,
        borderRadius: 6,
      },
      {
        label: "فائتة",
        data: weekly.map((w) => w.missed),
        backgroundColor: destC,
        borderRadius: 6,
      },
    ],
  };

  // لون احترافي للمنحنى — نستخدم لون "info" (أزرق سماوي) مع تدرّج خلفي ناعم
  const lineAccentRaw = css.getPropertyValue("--info").trim();
  const lineAccent = `hsl(${lineAccentRaw})`;
  const lineAccentAlpha = (a: number) => `hsla(${lineAccentRaw.replace(/\s+/g, ", ")}, ${a})`;
  const lineData = {
    labels: weekly.map((w) => w.day),
    datasets: [
      {
        label: "معدل الأداء",
        data: weekly.map((w) => {
          const t = w.answered + w.missed;
          return t === 0 ? 0 : Math.round((w.answered / t) * 100);
        }),
        borderColor: lineAccent,
        backgroundColor: (ctx: any) => {
          const chart = ctx.chart;
          const { ctx: c, chartArea } = chart;
          if (!chartArea) return lineAccentAlpha(0.2);
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, lineAccentAlpha(0.4));
          g.addColorStop(1, lineAccentAlpha(0.03));
          return g;
        },
        fill: true,
        tension: 0.45,
        borderWidth: 3,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: "#fff",
        pointBorderColor: lineAccent,
        pointBorderWidth: 2.5,
      },
    ],
  };

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: mutedC, font: { size: 11 } }, position: "bottom" as const },
    },
    scales: {
      x: { ticks: { color: mutedC, font: { size: 10 } }, grid: { display: false } },
      y: { ticks: { color: mutedC, font: { size: 10 } }, grid: { color: mutedC + "22" } },
    },
  };

  const statusLabels: Record<string, { label: string; cls: string }> = {
    online:  { label: "متصل", cls: "bg-success/15 text-success border-success/30" },
    in_call: { label: "في مكالمة", cls: "bg-primary/15 text-primary border-primary/30" },
    idle:    { label: "خامل", cls: "bg-warning/15 text-warning border-warning/30" },
    break:   { label: "استراحة", cls: "bg-info/15 text-info border-info/30" },
    offline: { label: "غير متصل", cls: "bg-muted text-muted-foreground border-border" },
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0">
        {/* رأس الملف */}
        <DialogHeader className="p-6 pb-4 border-b border-border">
          <DialogTitle className="sr-only">تفاصيل الموظف {agent.name}</DialogTitle>
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl gradient-primary grid place-items-center text-base font-bold text-primary-foreground shadow-glow shrink-0">
              {agent.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <h2 className="text-xl font-extrabold text-foreground">{agent.name}</h2>
                <Badge variant="outline" className={statusLabels[agent.status].cls}>
                  {statusLabels[agent.status].label}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {agent.id}</span>
                <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> تحويلة {agent.ext}</span>
                <span>المشرف: {agent.supervisor}</span>
              </div>
            </div>
            <Button
              onClick={downloadPdf}
              disabled={exporting}
              className="gradient-primary text-primary-foreground shrink-0"
              size="sm"
            >
              {exporting ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <FileDown className="w-4 h-4 ml-2" />}
              {exporting ? "جاري التحميل..." : "تحميل PDF"}
            </Button>
          </div>
        </DialogHeader>

        <div ref={reportRef} className="p-6 space-y-5 bg-background">
          {/* ترويسة التقرير (تظهر داخل الـ PDF) */}
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div>
              <p className="text-xs text-muted-foreground">تقرير أداء الموظف</p>
              <h3 className="text-lg font-bold">{agent.name} <span className="text-muted-foreground text-xs font-normal">— {agent.id}</span></h3>
            </div>
            <div className="text-left">
              <p className="text-[10px] text-muted-foreground">تاريخ التقرير</p>
              <p className="text-xs font-bold tabular-nums">{new Date().toLocaleDateString("ar-SA")}</p>
            </div>
          </div>

          {/* بطاقات إحصائية */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatBox icon={PhoneIncoming} label="مكالمات مجابة" value={agent.answered} cls="text-success" bg="bg-success/10" />
            <StatBox icon={PhoneMissed} label="مكالمات فائتة" value={agent.missed} cls="text-destructive" bg="bg-destructive/10" />
            <StatBox icon={Clock} label="متوسط المدة" value={formatDuration(agent.avgDuration)} cls="text-info" bg="bg-info/10" />
            <StatBox icon={Award} label="معدل الإجابة" value={`${answerRate}%`} cls="text-primary" bg="bg-primary/10" />
          </div>

          {/* الرسومات */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ChartCard title="توزيع الحالات" subtitle="آخر ١٠ مكالمات">
              <div className="h-56">
                <Doughnut data={doughnutData} options={{ ...chartOpts, scales: undefined }} />
              </div>
            </ChartCard>

            <ChartCard title="الأداء الأسبوعي" subtitle="مجابة مقابل فائتة" className="lg:col-span-2">
              <div className="h-56">
                <Bar data={barData} options={chartOpts} />
              </div>
            </ChartCard>

            <ChartCard title="منحنى معدل الإجابة" subtitle="نسبة الإنجاز اليومية" className="lg:col-span-3">
              <div className="h-56">
                <Line data={lineData} options={chartOpts} />
              </div>
            </ChartCard>
          </div>

          {/* آخر ١٠ مكالمات */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-4 border-b border-border flex-wrap">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold">آخر ١٠ مكالمات</h3>
                <Badge variant="secondary" className="text-[10px]">
                  {filteredCalls.length} / {recentCalls.length}
                </Badge>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* فلتر الحالة */}
                <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50 border border-border">
                  {([
                    { key: "all", label: "الكل" },
                    { key: "answered", label: "مجابة" },
                    { key: "missed", label: "فائتة" },
                    { key: "transferred", label: "محولة" },
                  ] as { key: CallStatusFilter; label: string }[]).map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setCallStatusFilter(f.key)}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors",
                        callStatusFilter === f.key
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                {/* فلتر الوقت */}
                <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50 border border-border">
                  {([
                    { key: "all", label: "كل الأوقات" },
                    { key: "morning", label: "صباحاً" },
                    { key: "afternoon", label: "ظهراً" },
                    { key: "evening", label: "مساءً" },
                  ] as { key: TimeFilter; label: string }[]).map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setTimeFilter(f.key)}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors",
                        timeFilter === f.key
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-[11px] font-bold text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-2.5">#</th>
                    <th className="px-4 py-2.5">رقم العميل</th>
                    <th className="px-4 py-2.5">الحالة</th>
                    <th className="px-4 py-2.5">المدة</th>
                    <th className="px-4 py-2.5">الوقت</th>
                    <th className="px-4 py-2.5">التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCalls.map((c, i) => {
                    const statusMeta = {
                      answered:    { icon: PhoneIncoming, label: "مجابة", cls: "text-success bg-success/10 border-success/30" },
                      missed:      { icon: PhoneMissed, label: "فائتة", cls: "text-destructive bg-destructive/10 border-destructive/30" },
                      transferred: { icon: PhoneForwarded, label: "محولة", cls: "text-info bg-info/10 border-info/30" },
                    }[c.status];
                    const Icon = statusMeta.icon;
                    return (
                      <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="px-4 py-2.5 font-mono text-xs" dir="ltr">{c.number}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border",
                            statusMeta.cls,
                          )}>
                            <Icon className="w-3 h-3" />
                            {statusMeta.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-xs">
                          {c.duration === 0 ? "—" : formatDuration(c.duration)}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-xs">{c.time}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.date}</td>
                      </tr>
                    );
                  })}
                  {filteredCalls.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-xs">
                        لا توجد مكالمات تطابق الفلتر الحالي.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatBox({
  icon: Icon, label, value, cls, bg,
}: {
  icon: any; label: string; value: string | number; cls: string; bg: string;
}) {
  return (
    <div className={cn("rounded-xl p-3 border border-border", bg)}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className={cn("w-3.5 h-3.5", cls)} />
        <span className="text-[10px] font-bold text-muted-foreground uppercase">{label}</span>
      </div>
      <div className={cn("text-xl font-extrabold tabular-nums", cls)}>{value}</div>
    </div>
  );
}

function ChartCard({
  title, subtitle, children, className,
}: {
  title: string; subtitle?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4 shadow-card", className)}>
      <div className="mb-3">
        <h4 className="text-sm font-bold text-foreground">{title}</h4>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
