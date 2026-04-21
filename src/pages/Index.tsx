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
} from "lucide-react";
import { useLiveAgents } from "@/hooks/useLiveAgents";
import { USE_REAL_API } from "@/lib/config";

const Index = () => {
  const agents = useLiveAgents();

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
        <StatCard label="إجمالي الموظفين" value={total} icon={Users} accent="info" />
        <StatCard label="في مكالمة الآن" value={inCall} icon={PhoneCall} accent="primary" />
        <StatCard label="مكالمات مجابة" value={answered} icon={PhoneIncoming} accent="success" />
        <StatCard label="مكالمات فائتة" value={missed} icon={PhoneMissed} accent="destructive" />
        <StatCard label="متوسط المدة" value={avgLabel} icon={Timer} accent="warning" />
        <StatCard label="نسبة SLA" value={slaLabel} icon={Gauge} accent="success" />
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
    </AppLayout>
  );
};

export default Index;
