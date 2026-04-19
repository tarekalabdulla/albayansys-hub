// لوحات حية تعرض المكالمات النشطة وحالات التحويلات من Yeastar webhook
import { useYeastarLive, type LiveCall, type ExtStatus } from "@/hooks/useYeastarLive";
import { cn } from "@/lib/utils";
import { PhoneCall, PhoneIncoming, PhoneOutgoing, User, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

function useTick(ms = 1000) {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function fmtElapsed(ts?: string) {
  if (!ts) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function statusBadge(status?: string | null) {
  const s = (status || "").toLowerCase();
  if (s.includes("ring"))   return { label: "يرن",     cls: "bg-warning/15 text-warning" };
  if (s.includes("answer") || s.includes("talk") || s.includes("up"))
                            return { label: "جارية",   cls: "bg-success/15 text-success" };
  if (s.includes("hold"))   return { label: "انتظار",  cls: "bg-info/15 text-info" };
  return { label: status || "—", cls: "bg-muted text-muted-foreground" };
}

function extBadge(status?: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("idle") || s.includes("available") || s === "online")
    return { label: "متاح",      cls: "bg-success/15 text-success",        dot: "bg-success" };
  if (s.includes("busy") || s.includes("call") || s.includes("ring"))
    return { label: "في مكالمة", cls: "bg-primary/15 text-primary",        dot: "bg-primary" };
  if (s.includes("dnd"))
    return { label: "عدم إزعاج", cls: "bg-warning/15 text-warning",        dot: "bg-warning" };
  if (s.includes("offline") || s.includes("unavailable"))
    return { label: "غير متصل", cls: "bg-muted text-muted-foreground",     dot: "bg-muted-foreground" };
  return   { label: status || "—", cls: "bg-muted text-muted-foreground",  dot: "bg-muted-foreground" };
}

export function LiveCallsPanel() {
  const { activeCalls } = useYeastarLive();
  useTick(1000);

  return (
    <div className="glass-card p-5 anim-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold">المكالمات الحية</h3>
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
          </span>
        </div>
        <span className="text-xs font-bold text-primary tabular-nums">
          {activeCalls.length}
        </span>
      </div>

      {activeCalls.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          لا توجد مكالمات نشطة حالياً
        </div>
      ) : (
        <ul className="space-y-2.5 max-h-[360px] overflow-auto pr-1">
          {activeCalls.map((c: LiveCall) => {
            const sb = statusBadge(c.status);
            const Dir =
              c.direction === "outbound" || c.direction === "out"
                ? PhoneOutgoing
                : c.direction === "inbound" || c.direction === "in"
                ? PhoneIncoming
                : PhoneCall;
            return (
              <li
                key={c.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/60 transition-colors"
              >
                <div className="w-9 h-9 rounded-lg grid place-items-center bg-primary/10 text-primary">
                  <Dir className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {c.agent_name || c.extension || "—"}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate" dir="ltr">
                    {c.caller_number || "?"} → {c.callee_number || "?"}
                    {c.queue_name ? ` · ${c.queue_name}` : ""}
                  </p>
                </div>
                <div className="text-left flex flex-col items-end gap-1">
                  <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-bold", sb.cls)}>
                    {sb.label}
                  </span>
                  <span className="text-xs font-bold tabular-nums text-muted-foreground">
                    {fmtElapsed(c.ts)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function LiveExtensionsPanel() {
  const { extensions } = useYeastarLive();

  // رتّب: في مكالمة → متاح → عدم إزعاج → غير متصل
  const order = (s: string) => {
    const x = (s || "").toLowerCase();
    if (x.includes("busy") || x.includes("call") || x.includes("ring")) return 0;
    if (x.includes("idle") || x.includes("available")) return 1;
    if (x.includes("dnd")) return 2;
    return 3;
  };
  const sorted = [...extensions].sort((a, b) => order(a.status) - order(b.status));

  const total = extensions.length;
  const online = extensions.filter((e) => {
    const s = (e.status || "").toLowerCase();
    return !(s.includes("offline") || s.includes("unavailable"));
  }).length;

  return (
    <div className="glass-card p-5 anim-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold">حالات التحويلات</h3>
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          {online > 0 ? (
            <Wifi className="w-3.5 h-3.5 text-success" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <span className="tabular-nums text-muted-foreground">
            {online}/{total}
          </span>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          لا توجد بيانات تحويلات بعد
        </div>
      ) : (
        <ul className="space-y-2 max-h-[360px] overflow-auto pr-1">
          {sorted.map((e: ExtStatus) => {
            const eb = extBadge(e.status);
            return (
              <li
                key={e.extension}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/60 transition-colors"
              >
                <div className="relative">
                  <div className="w-9 h-9 rounded-full bg-muted grid place-items-center">
                    <User className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-background",
                      eb.dot,
                    )}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {e.agent_name || `تحويلة ${e.extension}`}
                  </p>
                  <p className="text-[11px] text-muted-foreground" dir="ltr">
                    Ext {e.extension}
                  </p>
                </div>
                <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-bold", eb.cls)}>
                  {eb.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
