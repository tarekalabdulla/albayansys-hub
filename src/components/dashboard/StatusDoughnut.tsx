import { Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";
import { STATUS_LABEL, type AgentStatus } from "@/lib/mockData";

ChartJS.register(ArcElement, Tooltip, Legend);

function cssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `hsl(${v})`;
}

interface Props {
  counts?: Record<AgentStatus, number>;
  total?: number;
}

const EMPTY: Record<AgentStatus, number> = {
  online: 0, in_call: 0, idle: 0, break: 0, offline: 0,
};

export function StatusDoughnut({ counts = EMPTY, total = 0 }: Props) {
  const labels = Object.keys(counts).map((k) => STATUS_LABEL[k as AgentStatus]);
  const data = Object.values(counts);
  const sum = data.reduce((a, b) => a + b, 0);

  const colors = [
    cssVar("--success"),
    cssVar("--primary"),
    cssVar("--warning"),
    cssVar("--info"),
    cssVar("--muted-foreground"),
  ];

  return (
    <div className="glass-card p-6 anim-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold">حالات الموظفين</h3>
          <p className="text-xs text-muted-foreground">توزيع حي للحالات</p>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-semibold">
          {total} موظف
        </span>
      </div>
      <div className="h-[260px] grid place-items-center">
        {sum === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد بيانات بعد</p>
        ) : (
          <Doughnut
            data={{
              labels,
              datasets: [{
                data,
                backgroundColor: colors,
                borderWidth: 0,
                hoverOffset: 8,
              }],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              cutout: "65%",
              plugins: {
                legend: {
                  position: "bottom",
                  rtl: true,
                  labels: {
                    color: cssVar("--foreground"),
                    font: { family: "Cairo", size: 12 },
                    padding: 14,
                    usePointStyle: true,
                    pointStyle: "circle",
                  },
                },
                tooltip: {
                  bodyFont: { family: "Cairo" },
                  titleFont: { family: "Cairo" },
                  rtl: true,
                },
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
