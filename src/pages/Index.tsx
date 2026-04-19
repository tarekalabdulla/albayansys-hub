import { AppLayout } from "@/components/layout/AppLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { StatusDoughnut } from "@/components/dashboard/StatusDoughnut";
import { CallsTrendChart } from "@/components/dashboard/CallsTrendChart";
import {
  ActivityList,
  RecentCallsList,
  SupervisorList,
} from "@/components/dashboard/SidePanels";
import { LiveCallsPanel, LiveExtensionsPanel } from "@/components/dashboard/LivePanels";
import {
  Users, PhoneCall, PhoneIncoming, PhoneMissed, Timer, Gauge,
} from "lucide-react";
import { useStats } from "@/hooks/useStats";

const Index = () => {
  const stats = useStats();
  const { totals } = stats;
  const avgM = Math.floor(totals.avgDuration / 60);
  const avgS = totals.avgDuration % 60;

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
        <StatCard label="إجمالي الموظفين" value={totals.agents} icon={Users} accent="info" />
        <StatCard label="في مكالمة الآن" value={totals.inCall} icon={PhoneCall} accent="primary" />
        <StatCard label="مكالمات مجابة" value={totals.answered} icon={PhoneIncoming} accent="success" />
        <StatCard label="مكالمات فائتة" value={totals.missed} icon={PhoneMissed} accent="destructive" />
        <StatCard label="متوسط المدة" value={`${avgM}:${String(avgS).padStart(2, "0")}`} icon={Timer} accent="warning" />
        <StatCard label="نسبة SLA" value={`${totals.sla}%`} icon={Gauge} accent="success" />
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 mb-6">
        <div className="lg:col-span-1"><StatusDoughnut counts={stats.statusCounts} total={totals.agents} /></div>
        <div className="lg:col-span-2"><CallsTrendChart trend={stats.trend} /></div>
      </section>

      {/* Live Yeastar panels */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 mb-6">
        <LiveCallsPanel />
        <LiveExtensionsPanel />
      </section>

      {/* Side panels */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        <SupervisorList supervisors={stats.supervisors} />
        <RecentCallsList />
        <ActivityList />
      </section>
    </AppLayout>
  );
};

export default Index;
