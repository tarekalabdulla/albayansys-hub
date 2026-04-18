import { Bar, Line, Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  Sparkles, TrendingUp, AlertCircle, Smile, Lightbulb, Brain, Target,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

const RECOMMENDATIONS = [
  {
    icon: Lightbulb,
    color: "warning",
    title: "إعادة توزيع الأحمال",
    body: "كشف النموذج أن المشرفة منى تتلقى 38% من المكالمات. ينصح بإعادة توزيع 12 موظفاً.",
    impact: "+8% SLA",
  },
  {
    icon: Target,
    color: "primary",
    title: "تدريب مستهدف",
    body: "3 موظفين يعانون من ارتفاع متوسط مدة المكالمة. يُقترح جلسة تدريبية مدتها ساعة.",
    impact: "-22% AHT",
  },
  {
    icon: Brain,
    color: "info",
    title: "ذروة متوقعة",
    body: "النموذج يتنبأ بزيادة 35% في المكالمات يوم الخميس بين 10ص-1م. حضّر فريقاً إضافياً.",
    impact: "تجنب 14 مكالمة فائتة",
  },
  {
    icon: AlertCircle,
    color: "destructive",
    title: "نمط غير اعتيادي",
    body: "زيادة 18% في المشاعر السلبية لمكالمات الفواتير. راجع نص السكربت الحالي.",
    impact: "تنبيه فوري",
  },
];

const SentimentChart = () => (
  <div className="glass-card p-5 anim-fade-in">
    <h3 className="text-base font-bold mb-1 flex items-center gap-2">
      <Smile className="w-4 h-4 text-primary" /> تحليل المشاعر
    </h3>
    <p className="text-xs text-muted-foreground mb-4">المكالمات بحسب نبرة العميل</p>
    <div className="h-[260px]">
      <Doughnut
        data={{
          labels: ["إيجابي", "محايد", "سلبي"],
          datasets: [{
            data: [62, 24, 14],
            backgroundColor: [cssVar("--success"), cssVar("--info"), cssVar("--destructive")],
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
              position: "bottom", rtl: true,
              labels: { color: cssVar("--foreground"), font: { family: "Cairo", size: 12 }, padding: 14, usePointStyle: true },
            },
            tooltip: { rtl: true, bodyFont: { family: "Cairo" }, titleFont: { family: "Cairo" } },
          },
        }}
      />
    </div>
  </div>
);

const SentimentTrend = () => {
  const DAYS = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
  return (
    <div className="glass-card p-5 anim-fade-in">
      <h3 className="text-base font-bold mb-1 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-primary" /> اتجاه المشاعر
      </h3>
      <p className="text-xs text-muted-foreground mb-4">آخر 7 أيام</p>
      <div className="h-[260px]">
        <Line
          data={{
            labels: DAYS,
            datasets: [
              { label: "إيجابي", data: [55, 60, 58, 65, 70, 68, 62], borderColor: cssVar("--success"), backgroundColor: cssVarA("--success", 0.15), fill: true, tension: 0.4, borderWidth: 2 },
              { label: "سلبي",   data: [20, 15, 18, 12, 10, 14, 18], borderColor: cssVar("--destructive"), backgroundColor: cssVarA("--destructive", 0.15), fill: true, tension: 0.4, borderWidth: 2 },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
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
  );
};

const PressurePrediction = () => {
  const HOURS = ["8ص","9ص","10ص","11ص","12م","1م","2م","3م","4م","5م"];
  return (
    <div className="glass-card p-5 anim-fade-in">
      <h3 className="text-base font-bold mb-1 flex items-center gap-2">
        <Brain className="w-4 h-4 text-primary" /> التنبؤ بضغط العمل (غداً)
      </h3>
      <p className="text-xs text-muted-foreground mb-4">نموذج ML بدقة 91%</p>
      <div className="h-[260px]">
        <Bar
          data={{
            labels: HOURS,
            datasets: [
              { label: "متوقع",  data: [18,32,55,72,40,28,58,80,52,25], backgroundColor: cssVarA("--primary", 0.7), borderRadius: 6 },
              { label: "السعة",  data: [60,60,60,60,60,60,60,60,60,60], backgroundColor: cssVarA("--warning", 0.4), borderRadius: 6 },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
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
  );
};

const AIAnalytics = () => {
  return (
    <AppLayout title="تحليل الذكاء الاصطناعي" subtitle="رؤى وتوصيات مدعومة بنماذج التعلم الآلي">
      {/* AI banner */}
      <section className="relative overflow-hidden rounded-2xl gradient-hero p-6 mb-6 shadow-elegant anim-fade-in">
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/20 grid place-items-center backdrop-blur">
            <Sparkles className="w-7 h-7 text-primary-foreground" />
          </div>
          <div className="text-primary-foreground">
            <h2 className="text-xl font-extrabold">المساعد الذكي يعمل الآن</h2>
            <p className="text-sm opacity-90 mt-0.5">تحليل 1,247 مكالمة في آخر 24 ساعة — تم رصد 4 توصيات قابلة للتنفيذ.</p>
          </div>
        </div>
      </section>

      {/* Recommendations */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {RECOMMENDATIONS.map((r, i) => (
          <div key={i} className="glass-card p-5 anim-slide-up hover:-translate-y-0.5 transition-transform">
            <div className="flex items-start gap-3">
              <div className={cn(
                "w-11 h-11 rounded-xl grid place-items-center shrink-0",
                r.color === "primary"     && "bg-primary/15 text-primary",
                r.color === "warning"     && "bg-warning/15 text-warning",
                r.color === "info"        && "bg-info/15 text-info",
                r.color === "destructive" && "bg-destructive/15 text-destructive",
              )}>
                <r.icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-sm font-bold">{r.title}</h3>
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full",
                    r.color === "primary"     && "bg-primary/15 text-primary",
                    r.color === "warning"     && "bg-warning/15 text-warning",
                    r.color === "info"        && "bg-info/15 text-info",
                    r.color === "destructive" && "bg-destructive/15 text-destructive",
                  )}>
                    {r.impact}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{r.body}</p>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <SentimentChart />
        <SentimentTrend />
      </section>
      <section className="grid grid-cols-1 gap-5">
        <PressurePrediction />
      </section>
    </AppLayout>
  );
};

export default AIAnalytics;
