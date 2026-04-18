import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend,
);

function cssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `hsl(${v})`;
}
function cssVarA(name: string, alpha: number): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `hsl(${v} / ${alpha})`;
}

const DAYS = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

export function CallsTrendChart() {
  const answered = [142, 168, 195, 210, 188, 230, 175];
  const missed   = [12, 18, 9, 22, 14, 11, 8];

  return (
    <div className="glass-card p-6 anim-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold">اتجاه المكالمات الأسبوعي</h3>
          <p className="text-xs text-muted-foreground">المجابة مقابل الفائتة</p>
        </div>
        <div className="flex gap-3 text-xs">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-primary" /> مجابة</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-destructive" /> فائتة</span>
        </div>
      </div>
      <div className="h-[260px]">
        <Line
          data={{
            labels: DAYS,
            datasets: [
              {
                label: "مجابة",
                data: answered,
                borderColor: cssVar("--primary"),
                backgroundColor: cssVarA("--primary", 0.18),
                fill: true,
                tension: 0.4,
                borderWidth: 2.5,
                pointBackgroundColor: cssVar("--primary"),
                pointRadius: 4,
              },
              {
                label: "فائتة",
                data: missed,
                borderColor: cssVar("--destructive"),
                backgroundColor: cssVarA("--destructive", 0.12),
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointBackgroundColor: cssVar("--destructive"),
                pointRadius: 3,
              },
            ],
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
