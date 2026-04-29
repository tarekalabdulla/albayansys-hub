import { useEffect, useMemo, useState } from "react";
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
import { pbxApi, type CallLog } from "@/lib/pbxApi";
import { socketProvider } from "@/lib/socketProvider";

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
  return Boolean(c.answered) || c.status === "answered";
}

function isMissedCall(c: CallLog): boolean {
  return c.status === "no_answer" || c.status === "failed" || c.status === "cancelled";
}

export function CallsTrendChart() {
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchCalls() {
    try {
      const data = await pbxApi.calls({ limit: 500 });
      setCalls(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn("[CallsTrendChart] fetch:", e);
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const data = await pbxApi.calls({ limit: 500 });
        if (mounted) setCalls(Array.isArray(data) ? data : []);
      } catch (e) {
        console.warn("[CallsTrendChart] initial fetch:", e);
        if (mounted) setCalls([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    socketProvider.start();
    const offEnded = socketProvider.on("call:ended" as any, () => {
      fetchCalls();
    });

    const interval = window.setInterval(fetchCalls, 30_000);

    return () => {
      mounted = false;
      offEnded?.();
      window.clearInterval(interval);
    };
  }, []);

  const { labels, answered, missed, total } = useMemo(() => {
    const days = getLast7Days();
    const answeredMap = new Map(days.map((d) => [d.key, 0]));
    const missedMap = new Map(days.map((d) => [d.key, 0]));

    for (const c of calls) {
      if (!c.startedAt) continue;
      const key = dateKey(new Date(c.startedAt));
      if (!answeredMap.has(key)) continue;

      if (isAnsweredCall(c)) {
        answeredMap.set(key, (answeredMap.get(key) || 0) + 1);
      } else if (isMissedCall(c)) {
        missedMap.set(key, (missedMap.get(key) || 0) + 1);
      }
    }

    const answeredArr = days.map((d) => answeredMap.get(d.key) || 0);
    const missedArr = days.map((d) => missedMap.get(d.key) || 0);

    return {
      labels: days.map((d) => d.label),
      answered: answeredArr,
      missed: missedArr,
      total: answeredArr.reduce((a, b) => a + b, 0) + missedArr.reduce((a, b) => a + b, 0),
    };
  }, [calls]);

  return (
    <div className="glass-card p-6 anim-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold">اتجاه المكالمات الأسبوعي</h3>
          <p className="text-xs text-muted-foreground">
            المجابة مقابل الفائتة — بيانات حقيقية من PBX {loading ? "(جارٍ التحميل…)" : ""}
          </p>
        </div>
        <div className="flex gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-primary" /> مجابة
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-destructive" /> فائتة
          </span>
        </div>
      </div>

      <div className="h-[260px]">
        {loading ? (
          <div className="h-full grid place-items-center">
            <p className="text-sm text-muted-foreground">جارٍ تحميل بيانات المكالمات…</p>
          </div>
        ) : total === 0 ? (
          <div className="h-full grid place-items-center">
            <p className="text-sm text-muted-foreground">لا توجد بيانات مكالمات خلال آخر 7 أيام</p>
          </div>
        ) : (
          <Line
            data={{
              labels,
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
                  borderWidth: 2.5,
                  pointBackgroundColor: cssVar("--destructive"),
                  pointRadius: 4,
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  rtl: true,
                  bodyFont: { family: "Cairo" },
                  titleFont: { family: "Cairo" },
                },
              },
              scales: {
                x: {
                  grid: { display: false },
                  ticks: { color: cssVar("--muted-foreground"), font: { family: "Cairo" } },
                },
                y: {
                  beginAtZero: true,
                  ticks: { color: cssVar("--muted-foreground"), precision: 0, font: { family: "Cairo" } },
                  grid: { color: cssVarA("--border", 0.55) },
                },
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
