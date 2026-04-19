import { ACTIVITIES, RECENT_CALLS, SUPERVISOR_PERFORMANCE, formatDuration } from "@/lib/mockData";
import { cn } from "@/lib/utils";
import { PhoneIncoming, PhoneMissed, PhoneForwarded } from "lucide-react";

export function SupervisorList() {
  return (
    <div className="glass-card p-5 anim-fade-in">
      <h3 className="text-base font-bold mb-4">أداء المشرفين</h3>
      <ul className="space-y-3">
        {SUPERVISOR_PERFORMANCE.map((s) => (
          <li key={s.name} className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full gradient-primary grid place-items-center text-xs font-bold text-primary-foreground">
              {s.name.split(" ").pop()?.slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{s.name}</p>
              <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full gradient-primary"
                  style={{ width: `${s.sla}%` }}
                />
              </div>
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-primary">{s.sla}%</p>
              <p className="text-[10px] text-muted-foreground">{s.answered} مكالمة</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RecentCallsList() {
  return (
    <div className="glass-card p-5 anim-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold">أحدث المكالمات</h3>
        <button className="text-xs text-primary font-semibold hover:underline">عرض الكل</button>
      </div>
      <ul className="space-y-2.5">
        {RECENT_CALLS.slice(0, 6).map((c) => {
          const Icon =
            c.status === "answered" ? PhoneIncoming :
            c.status === "missed"   ? PhoneMissed   : PhoneForwarded;
          const color =
            c.status === "answered" ? "text-success bg-success/10" :
            c.status === "missed"   ? "text-destructive bg-destructive/10" :
            "text-info bg-info/10";
          return (
            <li key={c.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/60 transition-colors">
              <div className={cn("w-9 h-9 rounded-lg grid place-items-center", color)}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{c.agent}</p>
                <p className="text-[11px] text-muted-foreground" dir="ltr">{c.number}</p>
              </div>
              <div className="text-left">
                <p className="text-xs font-bold tabular-nums">{formatDuration(c.duration)}</p>
                <p className="text-[10px] text-muted-foreground">{c.time}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ActivityList() {
  const dot = (t: string) =>
    t === "success" ? "bg-success" :
    t === "warning" ? "bg-warning" :
    t === "danger"  ? "bg-destructive" : "bg-info";

  return (
    <div className="glass-card p-5 anim-fade-in">
      <h3 className="text-base font-bold mb-4">سجل النشاطات</h3>
      <ul className="space-y-3 relative">
        {ACTIVITIES.map((a, i) => (
          <li key={a.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cn("w-2.5 h-2.5 rounded-full mt-1.5", dot(a.type))} />
              {i < ACTIVITIES.length - 1 && <span className="flex-1 w-px bg-border mt-1" />}
            </div>
            <div className="flex-1 pb-1">
              <p className="text-sm leading-snug">{a.action}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                <span className="font-semibold">{a.user}</span> · {a.time}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
