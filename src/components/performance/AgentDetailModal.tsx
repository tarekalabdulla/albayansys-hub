import { useEffect, useMemo, useRef, useState } from "react";
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
  Inbox,
  RefreshCw,
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
import { formatDuration, type Agent } from "@/lib/mockData";
import { useLiveAgents } from "@/hooks/useLiveAgents";
import { cn } from "@/lib/utils";
import { pbxApi, type CallLog } from "@/lib/pbxApi";

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
  startedAt: string;
  direction: CallLog["direction"];
}

type CallStatusFilter = "all" | "answered" | "missed" | "transferred";
type TimeFilter = "all" | "morning" | "afternoon" | "evening";

const DIRECTION_LABEL: Record<string, string> = {
  incoming: "واردة",
  outgoing: "صادرة",
  internal: "داخلية",
  transferred: "محوّلة",
  forwarded: "معاد توجيهها",
  unknown: "غير معروف",
};

function cssToken(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `hsl(${v})`;
}

function cssTokenAlpha(name: string, alpha: number): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `hsl(${v} / ${alpha})`;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getLast7Days() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    return {
      key: dateKey(d),
      label: d.toLocaleDateString("ar-SA", { weekday: "short" }),
    };
  });
}

function isAnsweredCall(c: CallLog): boolean {
  return Boolean(c.answered) || c.status === "answered" || c.status === "completed";
}

function isMissedCall(c: CallLog): boolean {
  return c.status === "no_answer" || c.status === "failed" || c.status === "cancelled";
}

function isTransferredCall(c: CallLog): boolean {
  return c.direction === "transferred" || c.direction === "forwarded";
}

function callDuration(c: CallLog): number {
  if (Number(c.duration || 0) > 0) return Number(c.duration || 0);
  if (Number(c.talkSeconds || 0) > 0) return Number(c.talkSeconds || 0);

  if (c.startedAt && c.endedAt) {
    const diff = Math.round((new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime()) / 1000);
    return Math.max(0, diff);
  }

  if (c.startedAt && !c.endedAt) {
    const diff = Math.round((Date.now() - new Date(c.startedAt).getTime()) / 1000);
    return Math.max(0, diff);
  }

  return 0;
}

function normalizeStatus(c: CallLog): CallEntry["status"] {
  if (isMissedCall(c)) return "missed";
  if (isTransferredCall(c)) return "transferred";
  return "answered";
}

function toCallEntry(c: CallLog): CallEntry {
  const started = c.startedAt ? new Date(c.startedAt) : new Date();

  return {
    id: String(c.id || c.callKey || `${c.ext}-${c.startedAt}`),
    number: c.remote || "—",
    duration: callDuration(c),
    status: normalizeStatus(c),
    time: started.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }),
    date: started.toLocaleDateString("ar-SA"),
    startedAt: c.startedAt,
    direction: c.direction || "unknown",
  };
}

function buildWeeklyData(calls: CallLog[]) {
  const days = getLast7Days();

  const map = new Map(days.map((d) => [
    d.key,
    { day: d.label, answered: 0, missed: 0 },
  ]));

  for (const c of calls) {
    if (!c.startedAt) continue;
    const key = dateKey(new Date(c.startedAt));
    const row = map.get(key);
    if (!row) continue;

    if (isMissedCall(c)) row.missed += 1;
    else if (isAnsweredCall(c) || isTransferredCall(c)) row.answered += 1;
  }

  return days.map((d) => map.get(d.key)!);
}

function statusLabel(status: CallEntry["status"]) {
  if (status === "answered") return "مجابة";
  if (status === "missed") return "فائتة";
  return "محولة";
}

function statusClass(status: CallEntry["status"]) {
  if (status === "answered") return "bg-success/15 text-success border-success/30";
  if (status === "missed") return "bg-destructive/15 text-destructive border-destructive/30";
  return "bg-info/15 text-info border-info/30";
}

export function AgentDetailModal({ agentId, open, onClose }: AgentDetailModalProps) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const [callsError, setCallsError] = useState<string | null>(null);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [callStatusFilter, setCallStatusFilter] = useState<CallStatusFilter>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");

  const liveAgents = useLiveAgents();
  const agent = useMemo(
    () => (agentId ? liveAgents.find((a) => a.id === agentId) || null : null),
    [agentId, liveAgents],
  );

  useEffect(() => {
    if (!open || !agent?.ext) {
      setCalls([]);
      setCallsError(null);
      return;
    }

    let cancelled = false;

    async function fetchAgentCalls() {
      setLoadingCalls(true);
      setCallsError(null);

      try {
        const data = await pbxApi.calls({ ext: agent.ext, limit: 500 });
        if (!cancelled) setCalls(Array.isArray(data) ? data : []);
      } catch (e: any) {
        if (!cancelled) {
          setCalls([]);
          setCallsError(e?.response?.data?.message || e?.response?.data?.error || e?.message || "تعذّر جلب مكالمات الموظف");
        }
      } finally {
        if (!cancelled) setLoadingCalls(false);
      }
    }

    fetchAgentCalls();
    const t = window.setInterval(fetchAgentCalls, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [open, agent?.ext]);

  const recentCalls = useMemo(
    () => calls.slice(0, 25).map(toCallEntry),
    [calls],
  );

  const filteredCalls = useMemo(() => {
    return recentCalls.filter((c) => {
      if (callStatusFilter !== "all" && c.status !== callStatusFilter) return false;

      if (timeFilter !== "all") {
        const hour = new Date(c.startedAt).getHours();

        if (timeFilter === "morning" && !(hour >= 6 && hour < 12)) return false;
        if (timeFilter === "afternoon" && !(hour >= 12 && hour < 17)) return false;
        if (timeFilter === "evening" && !(hour >= 17 || hour < 6)) return false;
      }

      return true;
    });
  }, [recentCalls, callStatusFilter, timeFilter]);

  const weekly = useMemo(
    () => buildWeeklyData(calls),
    [calls],
  );

  const computedStats = useMemo(() => {
    const answered = calls.filter((c) => !isMissedCall(c) && (isAnsweredCall(c) || isTransferredCall(c))).length;
    const missed = calls.filter(isMissedCall).length;
    const transferred = calls.filter(isTransferredCall).length;
    const durations = calls
      .filter((c) => !isMissedCall(c))
      .map(callDuration)
      .filter((n) => Number.isFinite(n) && n > 0);

    const avgDuration = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    const total = answered + missed;
    const answerRate = total === 0 ? 0 : Math.round((answered / total) * 100);

    return {
      answered,
      missed,
      transferred,
      avgDuration,
      answerRate,
      total,
    };
  }, [calls]);

  const refreshCalls = async () => {
    if (!agent?.ext) return;

    try {
      setLoadingCalls(true);
      setCallsError(null);
      const data = await pbxApi.calls({ ext: agent.ext, limit: 500 });
      setCalls(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setCallsError(e?.response?.data?.message || e?.response?.data?.error || e?.message || "تعذّر جلب مكالمات الموظف");
    } finally {
      setLoadingCalls(false);
    }
  };

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

  const successC = cssToken("--success");
  const destC = cssToken("--destructive");
  const infoC = cssToken("--info");
  const primaryC = cssToken("--primary");
  const mutedC = cssToken("--muted-foreground");

  const callStats = {
    answered: computedStats.answered,
    missed: computedStats.missed,
    transferred: computedStats.transferred,
  };

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

  const lineData = {
    labels: weekly.map((w) => w.day),
    datasets: [
      {
        label: "معدل الإجابة",
        data: weekly.map((w) => {
          const t = w.answered + w.missed;
          return t === 0 ? 0 : Math.round((w.answered / t) * 100);
        }),
        borderColor: infoC,
        backgroundColor: cssTokenAlpha("--info", 0.18),
        fill: true,
        tension: 0.45,
        borderWidth: 3,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: "#fff",
        pointBorderColor: infoC,
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
      y: { ticks: { color: mutedC, font: { size: 10 }, precision: 0 }, grid: { color: cssTokenAlpha("--border", 0.55) } },
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
        <DialogHeader className="p-6 pb-4 border-b border-border">
          <DialogTitle className="sr-only">تفاصيل الموظف {agent.name}</DialogTitle>

          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl gradient-primary grid place-items-center text-base font-bold text-primary-foreground shadow-glow shrink-0">
              {agent.avatar}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <h2 className="text-xl font-extrabold text-foreground">{agent.name}</h2>
                <Badge variant="outline" className={statusLabels[agent.status]?.cls || statusLabels.offline.cls}>
                  {statusLabels[agent.status]?.label || agent.status}
                </Badge>
              </div>

              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {agent.id}</span>
                <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> تحويلة {agent.ext}</span>
                <span>المشرف: {agent.supervisor}</span>
                <span className="text-primary font-semibold">
                  {loadingCalls ? "جاري تحميل المكالمات…" : `${calls.length} سجل حقيقي`}
                </span>
              </div>
            </div>

            <div className="flex gap-2 shrink-0">
              <Button
                onClick={refreshCalls}
                disabled={loadingCalls}
                variant="outline"
                size="sm"
              >
                {loadingCalls ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <RefreshCw className="w-4 h-4 ml-2" />}
                تحديث
              </Button>

              <Button
                onClick={downloadPdf}
                disabled={exporting}
                className="gradient-primary text-primary-foreground"
                size="sm"
              >
                {exporting ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <FileDown className="w-4 h-4 ml-2" />}
                {exporting ? "جاري التحميل..." : "تحميل PDF"}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div ref={reportRef} className="p-6 space-y-5 bg-background">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div>
              <p className="text-xs text-muted-foreground">تقرير أداء الموظف — بيانات حقيقية من السنترال</p>
              <h3 className="text-lg font-bold">
                {agent.name} <span className="text-muted-foreground text-xs font-normal">— {agent.id}</span>
              </h3>
            </div>

            <div className="text-left">
              <p className="text-[10px] text-muted-foreground">تاريخ التقرير</p>
              <p className="text-xs font-bold tabular-nums">{new Date().toLocaleDateString("ar-SA")}</p>
            </div>
          </div>

          {callsError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 text-destructive p-3 text-sm">
              {callsError}
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatBox icon={PhoneIncoming} label="مكالمات مجابة" value={computedStats.answered} cls="text-success" bg="bg-success/10" />
            <StatBox icon={PhoneMissed} label="مكالمات فائتة" value={computedStats.missed} cls="text-destructive" bg="bg-destructive/10" />
            <StatBox icon={Clock} label="متوسط المدة" value={formatDuration(computedStats.avgDuration)} cls="text-info" bg="bg-info/10" />
            <StatBox icon={Award} label="معدل الإجابة" value={`${computedStats.answerRate}%`} cls="text-primary" bg="bg-primary/10" />
          </div>

          {loadingCalls && calls.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-10 text-center">
              <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">جاري تحميل بيانات الموظف من السنترال…</p>
            </div>
          ) : calls.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-10 text-center">
              <Inbox className="w-10 h-10 mx-auto mb-3 text-muted-foreground/60" />
              <p className="text-sm font-semibold">لا توجد مكالمات حقيقية لهذه التحويلة</p>
              <p className="text-xs text-muted-foreground mt-1">
                ستظهر البيانات هنا بعد تسجيل مكالمات على التحويلة {agent.ext}.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <ChartCard title="توزيع الحالات" subtitle={`آخر ${calls.length} مكالمة`}>
                  <div className="h-56">
                    <Doughnut data={doughnutData} options={{ ...chartOpts, scales: undefined }} />
                  </div>
                </ChartCard>

                <ChartCard title="الأداء الأسبوعي" subtitle="مجابة مقابل فائتة" className="lg:col-span-2">
                  <div className="h-56">
                    <Bar data={barData} options={chartOpts} />
                  </div>
                </ChartCard>

                <ChartCard title="منحنى معدل الإجابة" subtitle="نسبة الإجابة اليومية" className="lg:col-span-3">
                  <div className="h-56">
                    <Line data={lineData} options={chartOpts} />
                  </div>
                </ChartCard>
              </div>

              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between gap-3 p-4 border-b border-border flex-wrap">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-bold">آخر المكالمات الحقيقية</h3>
                    <Badge variant="secondary" className="text-[10px]">
                      {filteredCalls.length} / {recentCalls.length}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
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

                {filteredCalls.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    لا توجد مكالمات مطابقة للفلاتر الحالية.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-right">
                      <thead className="bg-muted/50 text-xs font-bold text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3">التاريخ</th>
                          <th className="px-4 py-3">الوقت</th>
                          <th className="px-4 py-3">الرقم</th>
                          <th className="px-4 py-3">الاتجاه</th>
                          <th className="px-4 py-3">الحالة</th>
                          <th className="px-4 py-3">المدة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCalls.slice(0, 25).map((c) => (
                          <tr key={c.id} className="border-b border-border/50 hover:bg-muted/40">
                            <td className="px-4 py-3 text-xs text-muted-foreground">{c.date}</td>
                            <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{c.time}</td>
                            <td className="px-4 py-3 text-sm font-semibold tabular-nums" dir="ltr">{c.number}</td>
                            <td className="px-4 py-3 text-xs">{DIRECTION_LABEL[c.direction] || c.direction}</td>
                            <td className="px-4 py-3">
                              <span className={cn("text-[10px] font-bold px-2 py-1 rounded-full border", statusClass(c.status))}>
                                {statusLabel(c.status)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm tabular-nums" dir="ltr">
                              {formatDuration(c.duration)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatBox({
  icon: Icon,
  label,
  value,
  cls,
  bg,
}: {
  icon: typeof PhoneIncoming;
  label: string;
  value: string | number;
  cls: string;
  bg: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-border p-4 flex items-center gap-3", bg)}>
      <div className={cn("w-9 h-9 rounded-xl grid place-items-center bg-background/70", cls)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className={cn("text-lg font-extrabold tabular-nums", cls)}>{value}</p>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4", className)}>
      <div className="mb-3">
        <h3 className="text-sm font-bold">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
