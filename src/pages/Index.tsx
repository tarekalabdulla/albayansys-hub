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
  History, Loader2, PhoneForwarded,
  type LucideIcon,
} from "lucide-react";
import { useLiveAgents } from "@/hooks/useLiveAgents";
import { USE_REAL_API } from "@/lib/config";
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

  const total = agents.length;
  const inCall = agents.filter((a) => a.status === "in_call").length;
  const answered = agents.reduce((s, a) => s + a.answered, 0);
  const missed = agents.reduce((s, a) => s + a.missed, 0);
  const avg = agents.length === 0
    ? 0
    : Math.round(agents.reduce((s, a) => s + a.avgDuration, 0) / agents.length);
  const avgM = Math.floor(avg / 60), avgS = avg % 60;
  const avgLabel = agents.length === 0 ? "—" : `${avgM}:${String(avgS).padStart(2, "0")}`;
  const slaLabel = USE_REAL_API ? "—" : "92%";

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
                    </tr>
                  ))}
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
