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
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Inbox, Loader2 } from "lucide-react";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

function cssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `hsl(${v})`;
}
function cssVarA(name: string, alpha: number): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `hsl(${v} / ${alpha})`;
}

function HourlyDistribution() {
  const HOURS = ["8", "9", "10", "11", "12", "1", "2", "3", "4", "5"];
  const data = [12, 28, 45, 62, 38, 25, 51, 70, 48, 22];

  return (
    <div className="glass-card p-5 anim-fade-in">
      <h3 className="text-base font-bold mb-1">توزيع المكالمات بالساعة</h3>
      <p className="text-xs text-muted-foreground mb-4">اليوم — حسب ساعة الاستلام</p>
      <div className="h-[240px]">
        <Bar
          data={{
            labels: HOURS,
            datasets: [{
              label: "مكالمات",
              data,
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

const LiveReport = () => {
  const agents = useLiveAgents();

  return (
    <AppLayout title="التقرير الحي" subtitle="بيانات لحظية لأداء فريق العمل">
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
    </AppLayout>
  );
};

export default LiveReport;
