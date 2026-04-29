import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { StatusDoughnut } from "@/components/dashboard/StatusDoughnut";
import { CallsTrendChart } from "@/components/dashboard/CallsTrendChart";
import {
  ActivityList,
  RecentCallsList,
  SupervisorList,
} from "@/components/dashboard/SidePanels";
import {
  Users, PhoneCall, PhoneIncoming, PhoneMissed, Timer, Gauge,
  History, Loader2, PhoneForwarded, Download, FileJson,
  type LucideIcon,
} from "lucide-react";
import { rowsToCsv, downloadFile } from "@/lib/csvImport";
import { useLiveAgents } from "@/hooks/useLiveAgents";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Agent } from "@/lib/mockData";
import { pbxApi, type CallLog } from "@/lib/pbxApi";

type MetricKey = "total" | "in_call" | "answered" | "missed" | "avg" | "sla";

const CALL_STATUS_LABEL: Record<string, string> = {
  ringing: "يرن",
  answered: "مُجابة",
  busy: "مشغول",
  no_answer: "بدون رد",
  failed: "فشلت",
  cancelled: "ملغاة",
  completed: "مكتملة",
};

const CALL_STATUS_BADGE: Record<string, string> = {
  answered: "bg-success/15 text-success border-success/30",
  completed: "bg-success/15 text-success border-success/30",
  ringing: "bg-info/15 text-info border-info/30",
  busy: "bg-warning/15 text-warning border-warning/30",
  no_answer: "bg-destructive/15 text-destructive border-destructive/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const DIRECTION_LABEL: Record<string, string> = {
  incoming: "واردة",
  outgoing: "صادرة",
  internal: "داخلية",
  transferred: "محوّلة",
  forwarded: "مُعاد توجيهها",
  unknown: "غير معروف",
};

const STATUS_LABEL: Record<string, string> = {
  online: "متاح",
  in_call: "في مكالمة",
  idle: "خامل",
  break: "استراحة",
  offline: "غير متصل",
};

const STATUS_BADGE: Record<string, string> = {
  online: "bg-success/15 text-success border-success/30",
  in_call: "bg-primary/15 text-primary border-primary/30",
  idle: "bg-warning/15 text-warning border-warning/30",
  break: "bg-info/15 text-info border-info/30",
  offline: "bg-muted text-muted-foreground border-border",
};

function formatSeconds(sec: number) {
  if (!sec || !Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const Index = () => {
  const agents = useLiveAgents();
  const [openMetric, setOpenMetric] = useState<MetricKey | null>(null);
  const [callsAgent, setCallsAgent] = useState<Agent | null>(null);
  const [callsList, setCallsList] = useState<CallLog[]>([]);
  const [callsLoading, setCallsLoading] = useState(false);
  const [callsError, setCallsError] = useState<string | null>(null);

  useEffect(() => {
    if (!callsAgent) return;
    let cancelled = false;
    setCallsLoading(true);
    setCallsError(null);
    setCallsList([]);
    (async () => {
      try {
        if (callsAgent.ext) {
          const data = await pbxApi.calls({ ext: callsAgent.ext, limit: 25 });
          if (!cancelled) setCallsList(data);
        }
      } catch (e: any) {
        if (!cancelled) setCallsError(e?.response?.data?.error || e?.message || "تعذّر جلب المكالمات");
      } finally {
        if (!cancelled) setCallsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [callsAgent]);

  const total = agents.length;
  const inCall = agents.filter((a) => a.status === "in_call").length;
  const answered = agents.reduce((s, a) => s + a.answered, 0);
  const missed = agents.reduce((s, a) => s + a.missed, 0);
  const avg = agents.length === 0
    ? 0
    : Math.round(agents.reduce((s, a) => s + a.avgDuration, 0) / agents.length);
  const avgM = Math.floor(avg / 60), avgS = avg % 60;
  const avgLabel = agents.length === 0 ? "—" : `${avgM}:${String(avgS).padStart(2, "0")}`;
  const slaLabel = "—";

  const detail = useMemo(() => {
    if (!openMetric) return null;
    const map: Record<MetricKey, { title: string; subtitle: string; rows: Agent[]; icon: LucideIcon }> = {
      total: {
        title: "إجمالي الموظفين",
        subtitle: `${total} موظف مسجل في النظام`,
        rows: agents,
        icon: Users,
      },
      in_call: {
        title: "في مكالمة الآن",
        subtitle: `${inCall} موظف لديه مكالمة نشطة حالياً`,
        rows: agents.filter((a) => a.status === "in_call"),
        icon: PhoneCall,
      },
      answered: {
        title: "المكالمات المُجابة",
        subtitle: `إجمالي ${answered} مكالمة مجابة موزعة على الموظفين`,
        rows: [...agents].sort((a, b) => b.answered - a.answered),
        icon: PhoneIncoming,
      },
      missed: {
        title: "المكالمات الفائتة",
        subtitle: `إجمالي ${missed} مكالمة فائتة`,
        rows: [...agents].filter((a) => a.missed > 0).sort((a, b) => b.missed - a.missed),
        icon: PhoneMissed,
      },
      avg: {
        title: "متوسط مدة المكالمات",
        subtitle: `المتوسط العام: ${avgLabel}`,
        rows: [...agents].sort((a, b) => b.avgDuration - a.avgDuration),
        icon: Timer,
      },
      sla: {
        title: "نسبة SLA",
        subtitle: `الالتزام بمستوى الخدمة: ${slaLabel}`,
        rows: [...agents].sort((a, b) => b.answered - a.answered),
        icon: Gauge,
      },
    };
    return map[openMetric];
  }, [openMetric, agents, total, inCall, answered, missed, avgLabel, slaLabel]);

  return (
    <AppLayout
      title="لوحة المعلومات"
      subtitle="نظرة عامة لحظية على أداء مركز الاتصال"
    >
      {/* Hero strip */}
      <section className="relative overflow-hidden rounded-2xl gradient-hero p-6 sm:p-8 mb-6 shadow-elegant anim-fade-in">
        <div className="absolute -top-12 -left-12 w-48 h-48 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-16 right-1/3 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="text-primary-foreground">
            <p className="text-sm opacity-90">أهلاً بك مجدداً 👋</p>
            <h1 className="text-2xl sm:text-3xl font-extrabold mt-1">
              نظام حلول البيان لإدارة مركز الاتصال
            </h1>
            <p className="text-sm opacity-90 mt-1.5">
              {new Date().toLocaleDateString("ar-SA", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
          <div className="flex items-center gap-2.5 glass rounded-xl px-4 py-2.5">
            <span className="relative flex w-2.5 h-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
            </span>
            <span className="text-sm font-semibold text-primary-foreground">النظام يعمل بكفاءة</span>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
        <StatCard label="إجمالي الموظفين" value={total} icon={Users} accent="info" onClick={() => setOpenMetric("total")} />
        <StatCard label="في مكالمة الآن" value={inCall} icon={PhoneCall} accent="primary" onClick={() => setOpenMetric("in_call")} />
        <StatCard label="مكالمات مجابة" value={answered} icon={PhoneIncoming} accent="success" onClick={() => setOpenMetric("answered")} />
        <StatCard label="مكالمات فائتة" value={missed} icon={PhoneMissed} accent="destructive" onClick={() => setOpenMetric("missed")} />
        <StatCard label="متوسط المدة" value={avgLabel} icon={Timer} accent="warning" onClick={() => setOpenMetric("avg")} />
        <StatCard label="نسبة SLA" value={slaLabel} icon={Gauge} accent="success" onClick={() => setOpenMetric("sla")} />
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 mb-6">
        <div className="lg:col-span-1"><StatusDoughnut /></div>
        <div className="lg:col-span-2"><CallsTrendChart /></div>
      </section>

      {/* Side panels */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        <SupervisorList />
        <RecentCallsList />
        <ActivityList />
      </section>

      <Dialog open={!!openMetric} onOpenChange={(v) => !v && setOpenMetric(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detail?.icon && <detail.icon className="w-5 h-5 text-primary" />}
              <span>{detail?.title}</span>
            </DialogTitle>
            <DialogDescription>{detail?.subtitle}</DialogDescription>
          </DialogHeader>

          {detail && detail.rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              لا توجد بيانات للعرض
            </div>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto -mx-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background/95 backdrop-blur z-10">
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-right font-semibold px-3 py-2">الموظف</th>
                    <th className="text-right font-semibold px-3 py-2">التحويلة</th>
                    <th className="text-right font-semibold px-3 py-2">الحالة</th>
                    <th className="text-right font-semibold px-3 py-2">مجابة</th>
                    <th className="text-right font-semibold px-3 py-2">فائتة</th>
                    <th className="text-right font-semibold px-3 py-2">متوسط المدة</th>
                    <th className="text-right font-semibold px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {detail?.rows.map((a) => (
                    <tr key={a.id} className="border-t border-border/50 hover:bg-muted/40">
                      <td className="px-3 py-2 font-medium">{a.name}</td>
                      <td className="px-3 py-2 tabular-nums" dir="ltr">{a.ext}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] border ${STATUS_BADGE[a.status] || ""}`}>
                          {STATUS_LABEL[a.status] || a.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{a.answered}</td>
                      <td className="px-3 py-2 tabular-nums">{a.missed}</td>
                      <td className="px-3 py-2 tabular-nums">{formatSeconds(a.avgDuration)}</td>
                      <td className="px-3 py-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={() => setCallsAgent(a)}
                        >
                          <History className="w-3.5 h-3.5" />
                          سجل المكالمات
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Calls history dialog */}
      <Dialog open={!!callsAgent} onOpenChange={(v) => !v && setCallsAgent(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              <span>سجل آخر المكالمات — {callsAgent?.name}</span>
            </DialogTitle>
            <DialogDescription>
              التحويلة <span dir="ltr" className="tabular-nums">{callsAgent?.ext}</span> · آخر 25 مكالمة
            </DialogDescription>
            {callsList.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => {
                    const rows = callsList.map((c) => ({
                      startedAt: c.startedAt || "",
                      remote: c.remote || "",
                      direction: c.direction || "",
                      status: c.status || "",
                      durationSec: c.duration || c.talkSeconds || 0,
                      ext: c.ext || "",
                      agentName: c.agentName || callsAgent?.name || "",
                    }));
                    const csv = rowsToCsv(rows, [
                      "startedAt","remote","direction","status","durationSec","ext","agentName",
                    ]);
                    const safeName = (callsAgent?.name || "agent").replace(/\s+/g, "_");
                    downloadFile(`calls_${safeName}_${callsAgent?.ext || ""}.csv`, csv);
                  }}
                >
                  <Download className="w-3.5 h-3.5" />
                  تصدير CSV
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => {
                    const payload = {
                      agent: { name: callsAgent?.name, ext: callsAgent?.ext },
                      exportedAt: new Date().toISOString(),
                      count: callsList.length,
                      calls: callsList,
                    };
                    const safeName = (callsAgent?.name || "agent").replace(/\s+/g, "_");
                    downloadFile(
                      `calls_${safeName}_${callsAgent?.ext || ""}.json`,
                      JSON.stringify(payload, null, 2),
                      "application/json;charset=utf-8;"
                    );
                  }}
                >
                  <FileJson className="w-3.5 h-3.5" />
                  تصدير JSON
                </Button>
              </div>
            )}
          </DialogHeader>

          {callsLoading ? (
            <div className="py-12 grid place-items-center text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mb-2" />
              جارٍ تحميل المكالمات…
            </div>
          ) : callsError ? (
            <div className="py-10 text-center text-sm text-destructive">{callsError}</div>
          ) : callsList.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              لا توجد مكالمات لهذا الموظف بعد
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto -mx-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background/95 backdrop-blur z-10">
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-right font-semibold px-3 py-2">الوقت</th>
                    <th className="text-right font-semibold px-3 py-2">الرقم</th>
                    <th className="text-right font-semibold px-3 py-2">الاتجاه</th>
                    <th className="text-right font-semibold px-3 py-2">الحالة</th>
                    <th className="text-right font-semibold px-3 py-2">المدة</th>
                  </tr>
                </thead>
                <tbody>
                  {callsList.map((c) => {
                    const Icon =
                      c.direction === "outgoing" ? PhoneForwarded :
                      c.status === "no_answer" || c.status === "failed" || c.status === "cancelled" ? PhoneMissed :
                      PhoneIncoming;
                    return (
                      <tr key={c.id || c.callKey} className="border-t border-border/50 hover:bg-muted/40">
                        <td className="px-3 py-2 text-xs tabular-nums" dir="ltr">
                          {c.startedAt ? new Date(c.startedAt).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" }) : "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums" dir="ltr">{c.remote || "—"}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                            {DIRECTION_LABEL[c.direction] || c.direction}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] border ${CALL_STATUS_BADGE[c.status] || "bg-muted text-muted-foreground border-border"}`}>
                            {CALL_STATUS_LABEL[c.status] || c.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 tabular-nums">{formatSeconds(c.duration || c.talkSeconds || 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Index;
