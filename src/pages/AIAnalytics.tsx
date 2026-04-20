import { useEffect, useState } from "react";
import { Bar, Line, Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Filler, Tooltip, Legend,
} from "chart.js";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  Sparkles, TrendingUp, AlertCircle, Smile, Lightbulb, Brain, Target, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  aiAnalyticsApi,
  type ApiAiRecommendation,
  type SentimentSummary,
  type SentimentTrendDay,
  type AiOverview,
} from "@/lib/dataApi";

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, BarElement,
  ArcElement, Filler, Tooltip, Legend,
);

function cssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `hsl(${v})`;
}
function cssVarA(name: string, alpha: number): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `hsl(${v} / ${alpha})`;
}

const ICONS: Record<string, any> = {
  lightbulb: Lightbulb, target: Target, brain: Brain, alert: AlertCircle,
};

const AIAnalytics = () => {
  const [recs, setRecs] = useState<ApiAiRecommendation[]>([]);
  const [sentiment, setSentiment] = useState<SentimentSummary | null>(null);
  const [trend, setTrend] = useState<SentimentTrendDay[]>([]);
  const [overview, setOverview] = useState<AiOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      aiAnalyticsApi.recommendations().catch(() => []),
      aiAnalyticsApi.sentiment().catch(() => null),
      aiAnalyticsApi.trend().catch(() => []),
      aiAnalyticsApi.overview().catch(() => null),
    ]).then(([r, s, t, o]) => {
      setRecs(r); setSentiment(s); setTrend(t); setOverview(o);
    }).finally(() => setLoading(false));
  }, []);

  const hasAnyData = (sentiment?.total || 0) > 0 || recs.length > 0 || trend.length > 0;

  if (loading) {
    return (
      <AppLayout title="تحليل الذكاء الاصطناعي" subtitle="رؤى وتوصيات مدعومة بنماذج التعلم الآلي">
        <div className="grid place-items-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="تحليل الذكاء الاصطناعي" subtitle="رؤى وتوصيات مدعومة بنماذج التعلم الآلي">
      <section className="relative overflow-hidden rounded-2xl gradient-hero p-6 mb-6 shadow-elegant anim-fade-in">
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/20 grid place-items-center backdrop-blur">
            <Sparkles className="w-7 h-7 text-primary-foreground" />
          </div>
          <div className="text-primary-foreground">
            <h2 className="text-xl font-extrabold">المساعد الذكي</h2>
            <p className="text-sm opacity-90 mt-0.5">
              {overview
                ? `تحليل ${overview.calls24h} مكالمة و ${overview.recordings24h} تسجيل في آخر 24 ساعة — ${overview.activeRecs} توصية فعّالة.`
                : "لم يبدأ التحليل بعد."}
            </p>
          </div>
        </div>
      </section>

      {!hasAnyData && (
        <div className="rounded-2xl border border-border bg-card p-10 text-center mb-6">
          <Brain className="w-14 h-14 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-base font-bold mb-1">لا توجد بيانات تحليل بعد</p>
          <p className="text-sm text-muted-foreground">
            ستظهر التوصيات والرسوم البيانية تلقائياً عند توفر بيانات مكالمات وتسجيلات كافية.
          </p>
        </div>
      )}

      {recs.length > 0 && (
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {recs.map((r) => {
            const Icon = ICONS[r.icon] || Lightbulb;
            return (
              <div key={r.id} className="glass-card p-5 anim-slide-up hover:-translate-y-0.5 transition-transform">
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "w-11 h-11 rounded-xl grid place-items-center shrink-0",
                    r.color === "primary"     && "bg-primary/15 text-primary",
                    r.color === "warning"     && "bg-warning/15 text-warning",
                    r.color === "info"        && "bg-info/15 text-info",
                    r.color === "destructive" && "bg-destructive/15 text-destructive",
                  )}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="text-sm font-bold">{r.title}</h3>
                      {r.impact && (
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-full",
                          r.color === "primary"     && "bg-primary/15 text-primary",
                          r.color === "warning"     && "bg-warning/15 text-warning",
                          r.color === "info"        && "bg-info/15 text-info",
                          r.color === "destructive" && "bg-destructive/15 text-destructive",
                        )}>{r.impact}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{r.body}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {sentiment && sentiment.total > 0 && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
          <div className="glass-card p-5 anim-fade-in">
            <h3 className="text-base font-bold mb-1 flex items-center gap-2">
              <Smile className="w-4 h-4 text-primary" /> تحليل المشاعر
            </h3>
            <p className="text-xs text-muted-foreground mb-4">إجمالي {sentiment.total} مكالمة</p>
            <div className="h-[260px]">
              <Doughnut
                data={{
                  labels: ["إيجابي", "محايد", "سلبي"],
                  datasets: [{
                    data: [sentiment.positive, sentiment.neutral, sentiment.negative],
                    backgroundColor: [cssVar("--success"), cssVar("--info"), cssVar("--destructive")],
                    borderWidth: 0, hoverOffset: 8,
                  }],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false, cutout: "65%",
                  plugins: {
                    legend: { position: "bottom", rtl: true, labels: { color: cssVar("--foreground"), font: { family: "Cairo", size: 12 }, padding: 14, usePointStyle: true } },
                    tooltip: { rtl: true, bodyFont: { family: "Cairo" }, titleFont: { family: "Cairo" } },
                  },
                }}
              />
            </div>
          </div>

          {trend.length > 0 && (
            <div className="glass-card p-5 anim-fade-in">
              <h3 className="text-base font-bold mb-1 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" /> اتجاه المشاعر
              </h3>
              <p className="text-xs text-muted-foreground mb-4">آخر 7 أيام</p>
              <div className="h-[260px]">
                <Line
                  data={{
                    labels: trend.map(d => d.day),
                    datasets: [
                      { label: "إيجابي", data: trend.map(d => d.positive), borderColor: cssVar("--success"), backgroundColor: cssVarA("--success", 0.15), fill: true, tension: 0.4, borderWidth: 2 },
                      { label: "سلبي",   data: trend.map(d => d.negative), borderColor: cssVar("--destructive"), backgroundColor: cssVarA("--destructive", 0.15), fill: true, tension: 0.4, borderWidth: 2 },
                    ],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                      legend: { position: "bottom", rtl: true, labels: { color: cssVar("--foreground"), font: { family: "Cairo" }, usePointStyle: true } },
                      tooltip: { rtl: true, bodyFont: { family: "Cairo" }, titleFont: { family: "Cairo" } },
                    },
                    scales: {
                      x: { ticks: { color: cssVar("--muted-foreground"), font: { family: "Cairo" } }, grid: { display: false } },
                      y: { ticks: { color: cssVar("--muted-foreground"), font: { family: "Cairo" } }, grid: { color: cssVarA("--border", 0.6) } },
                    },
                  }}
                />
              </div>
            </div>
          )}
        </section>
      )}
    </AppLayout>
  );
};

export default AIAnalytics;
