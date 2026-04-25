import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: { value: number; positive: boolean };
  accent?: "primary" | "success" | "warning" | "info" | "destructive";
  onClick?: () => void;
}

const ACCENT_CLASSES = {
  primary:     { bg: "bg-primary/10",    text: "text-primary" },
  success:     { bg: "bg-success/10",    text: "text-success" },
  warning:     { bg: "bg-warning/10",    text: "text-warning" },
  info:        { bg: "bg-info/10",       text: "text-info" },
  destructive: { bg: "bg-destructive/10", text: "text-destructive" },
};

export function StatCard({ label, value, icon: Icon, trend, accent = "primary", onClick }: StatCardProps) {
  const c = ACCENT_CLASSES[accent];
  const clickable = typeof onClick === "function";
  const Comp: any = clickable ? "button" : "div";
  return (
    <Comp
      type={clickable ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "stat-card anim-slide-up text-right w-full",
        clickable && "cursor-pointer transition-transform hover:-translate-y-0.5 hover:shadow-elegant focus:outline-none focus:ring-2 focus:ring-primary/40"
      )}
    >
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground font-medium">{label}</p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight">{value}</p>
          {trend && (
            <p className={cn("mt-1.5 text-xs font-semibold flex items-center gap-1",
              trend.positive ? "text-success" : "text-destructive"
            )}>
              <i className={cn("fa-solid", trend.positive ? "fa-arrow-trend-up" : "fa-arrow-trend-down")} />
              <span>{trend.positive ? "+" : "-"}{Math.abs(trend.value)}%</span>
              <span className="text-muted-foreground font-normal">عن الأسبوع الماضي</span>
            </p>
          )}
        </div>
        <div className={cn("w-12 h-12 rounded-xl grid place-items-center", c.bg, c.text)}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </Comp>
  );
}
