// شبكة بطاقات حية لكل تحويلة من Yeastar مع مدة المكالمة لحظياً
import { useEffect, useMemo, useState } from "react";
import { useYeastarLive, type ExtStatus, type LiveCall } from "@/hooks/useYeastarLive";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Phone, PhoneOff, User, Search, Wifi } from "lucide-react";

type Bucket = "in_call" | "available" | "dnd" | "offline";

const BUCKET_META: Record<Bucket, { label: string; cls: string; dot: string; ring: string }> = {
  in_call:   { label: "في مكالمة", cls: "bg-primary/15 text-primary",         dot: "bg-primary",          ring: "border-primary/60 bg-primary/5"   },
  available: { label: "متاح",      cls: "bg-success/15 text-success",         dot: "bg-success",          ring: "border-success/60 bg-success/5"   },
  dnd:       { label: "عدم إزعاج", cls: "bg-warning/15 text-warning",         dot: "bg-warning",          ring: "border-warning/60 bg-warning/5"   },
  offline:   { label: "غير متصل",  cls: "bg-muted text-muted-foreground",     dot: "bg-muted-foreground", ring: "border-border bg-muted/30 opacity-80" },
};

function bucketOf(status?: string): Bucket {
  const s = (status || "").toLowerCase();
  if (s.includes("busy") || s.includes("call") || s.includes("ring") || s.includes("talk") || s.includes("up")) return "in_call";
  if (s.includes("dnd")) return "dnd";
  if (s.includes("offline") || s.includes("unavailable")) return "offline";
  return "available";
}

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
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function ExtCard({ ext, call }: { ext: ExtStatus; call?: LiveCall }) {
  const b = bucketOf(ext.status);
  const meta = BUCKET_META[b];
  const inCall = b === "in_call";

  return (
    <div
      className={cn(
        "glass-card p-4 border-2 transition-all hover:-translate-y-0.5",
        meta.ring,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <div className="w-12 h-12 rounded-xl gradient-primary grid place-items-center text-sm font-bold text-primary-foreground shadow-soft">
            {(ext.agent_name || ext.extension || "?").slice(0, 2)}
          </div>
          <span
            className={cn(
              "absolute -bottom-0.5 -left-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-card",
              meta.dot,
              inCall && "animate-pulse",
            )}
          />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate">
            {ext.agent_name || `تحويلة ${ext.extension}`}
          </p>
          <p className="text-[11px] text-muted-foreground">
            تحويلة <span dir="ltr" className="font-semibold">{ext.extension}</span>
          </p>
          <span className={cn("inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full", meta.cls)}>
            {meta.label}
          </span>
        </div>

        <div className="text-left">
          <p className="text-[10px] text-muted-foreground">
            {inCall ? "مدة المكالمة" : "منذ"}
          </p>
          <p className={cn("font-bold tabular-nums text-sm", inCall ? "text-primary" : "text-muted-foreground")}>
            {fmtElapsed(inCall ? call?.ts : ext.ts)}
          </p>
        </div>
      </div>

      {inCall && call && (
        <div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-2 text-[11px] text-muted-foreground" dir="ltr">
          <Phone className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="truncate">
            {call.caller_number || "?"} → {call.callee_number || "?"}
            {call.queue_name ? ` · ${call.queue_name}` : ""}
          </span>
        </div>
      )}

      {b === "offline" && (
        <div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-2 text-[11px] text-muted-foreground">
          <PhoneOff className="w-3.5 h-3.5 shrink-0" />
          <span>التحويلة غير متصلة بالسنترال</span>
        </div>
      )}
    </div>
  );
}

const FILTERS: Array<{ id: "all" | Bucket; label: string }> = [
  { id: "all",       label: "الكل" },
  { id: "in_call",   label: "في مكالمة" },
  { id: "available", label: "متاح" },
  { id: "dnd",       label: "عدم إزعاج" },
  { id: "offline",   label: "غير متصل" },
];

export function LiveExtensionsGrid() {
  const { extensions, activeCalls } = useYeastarLive();
  useTick(1000);
  const [filter, setFilter] = useState<"all" | Bucket>("all");
  const [q, setQ] = useState("");

  // ربط كل تحويلة بمكالمتها الحالية إن وجدت
  const callByExt = useMemo(() => {
    const m = new Map<string, LiveCall>();
    for (const c of activeCalls) if (c.extension) m.set(String(c.extension), c);
    return m;
  }, [activeCalls]);

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { in_call: 0, available: 0, dnd: 0, offline: 0 };
    for (const e of extensions) c[bucketOf(e.status)]++;
    return c;
  }, [extensions]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return extensions
      .filter((e) => filter === "all" || bucketOf(e.status) === filter)
      .filter(
        (e) =>
          !term ||
          (e.agent_name || "").toLowerCase().includes(term) ||
          String(e.extension).includes(term),
      )
      .sort((a, b) => {
        const order: Record<Bucket, number> = { in_call: 0, available: 1, dnd: 2, offline: 3 };
        return order[bucketOf(a.status)] - order[bucketOf(b.status)];
      });
  }, [extensions, filter, q]);

  return (
    <section className="mb-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">المراقبة الحية للتحويلات</h2>
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
          </span>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Wifi className="w-3 h-3" /> بث مباشر من Yeastar
          </span>
        </div>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث بالاسم أو رقم التحويلة..."
            className="pr-9 w-full sm:w-72"
          />
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {(["in_call", "available", "dnd", "offline"] as Bucket[]).map((b) => {
          const meta = BUCKET_META[b];
          return (
            <button
              key={b}
              onClick={() => setFilter(filter === b ? "all" : b)}
              className={cn(
                "glass-card p-3 text-right border-2 transition-all",
                filter === b ? meta.ring : "border-transparent hover:border-border",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("w-2.5 h-2.5 rounded-full", meta.dot)} />
                <span className="text-xs text-muted-foreground">{meta.label}</span>
              </div>
              <p className="text-2xl font-extrabold tabular-nums mt-1">{counts[b]}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
              filter === f.id
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:bg-muted",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {extensions.length === 0 ? (
        <div className="glass-card p-10 text-center text-sm text-muted-foreground">
          لا توجد بيانات تحويلات بعد. تأكد من إعداد Webhook في Yeastar وأن الأحداث تصل إلى السيرفر.
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-10 text-center text-sm text-muted-foreground">
          لا توجد نتائج مطابقة للبحث/الفلتر الحالي.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
          {filtered.map((e) => (
            <ExtCard
              key={e.extension}
              ext={e}
              call={callByExt.get(String(e.extension))}
            />
          ))}
        </div>
      )}
    </section>
  );
}
