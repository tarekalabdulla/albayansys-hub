import { Award, TrendingUp } from "lucide-react";
import type { QualityMetric } from "@/lib/recordingsData";
import { qualityBgClass, qualityColorClass } from "@/lib/recordingsData";
import { cn } from "@/lib/utils";

interface QualityScoreProps {
  score: number;
  metrics: QualityMetric[];
}

export function QualityScore({ score, metrics }: QualityScoreProps) {
  const grade =
    score >= 90 ? "ممتاز"
    : score >= 80 ? "جيد جداً"
    : score >= 70 ? "جيد"
    : score >= 60 ? "مقبول"
    : "يحتاج تحسين";

  // محيط الدائرة
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (score / 100) * circ;

  return (
    <div className="space-y-4">
      {/* الدرجة الكلية */}
      <div className="flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-br from-primary/5 to-accent/5 border border-primary/15">
        <div className="relative w-32 h-32 shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
            <circle
              cx="60" cy="60" r={radius}
              className="stroke-muted"
              strokeWidth="9"
              fill="none"
            />
            <circle
              cx="60" cy="60" r={radius}
              className={cn(qualityColorClass(score))}
              stroke="currentColor"
              strokeWidth="9"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className={cn("text-3xl font-extrabold tabular-nums", qualityColorClass(score))}>
                {score}
              </div>
              <div className="text-[10px] text-muted-foreground font-medium">من ١٠٠</div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Award className={cn("w-5 h-5", qualityColorClass(score))} />
            <span className="text-sm font-bold text-foreground">التقييم العام</span>
          </div>
          <div className={cn("text-2xl font-extrabold mb-1", qualityColorClass(score))}>
            {grade}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            بناءً على ٥ معايير لقياس جودة المكالمة
          </p>
        </div>
      </div>

      {/* المعايير التفصيلية */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-bold text-foreground">معايير الجودة</h4>
        </div>
        {metrics.map((m) => (
          <div key={m.label}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-foreground">{m.label}</span>
              <span className={cn("text-xs font-bold tabular-nums", qualityColorClass(m.score))}>
                {m.score}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-700", qualityBgClass(m.score))}
                style={{ width: `${m.score}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
