// صفحة Live Monitor: تعرض المكالمات الجارية الآن من PBX
// تستمع لأحداث socket.io: call:live, call:ended (من backend الجديد)
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { pbxApi, type LiveCall, type PbxStatus } from "@/lib/pbxApi";
import { socketProvider } from "@/lib/socketProvider";
import {
  PhoneIncoming,
  PhoneOutgoing,
  PhoneCall,
  PhoneForwarded,
  ArrowRightLeft,
  Phone,
  RefreshCw,
  User,
  FileText,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

const DIRECTION_META: Record<LiveCall["direction"], { label: string; Icon: typeof Phone; class: string }> = {
  incoming:    { label: "وارد",       Icon: PhoneIncoming,  class: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  outgoing:    { label: "صادر",       Icon: PhoneOutgoing,  class: "bg-sky-500/10 text-sky-600 border-sky-500/30" },
  internal:    { label: "داخلي",      Icon: PhoneCall,      class: "bg-violet-500/10 text-violet-600 border-violet-500/30" },
  transferred: { label: "محوّلة",     Icon: ArrowRightLeft, class: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  forwarded:   { label: "معاد توجيه", Icon: PhoneForwarded, class: "bg-orange-500/10 text-orange-600 border-orange-500/30" },
  unknown:     { label: "غير محدّد",  Icon: Phone,          class: "bg-muted text-muted-foreground border-border" },
};

const STATUS_LABEL: Record<LiveCall["status"], string> = {
  ringing: "يرنّ", answered: "متّصل", busy: "مشغول",
  no_answer: "لا يجيب", failed: "فاشلة", cancelled: "ملغاة", completed: "منتهية",
};

function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export default function LiveMonitor() {
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<PbxStatus | null>(null);
  const [tick, setTick] = useState(0);

  // تحديث "الوقت المنقضي" كل ثانية محلياً
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // أوّل تحميل + جلب status
  useEffect(() => {
    let mounted = true;
    Promise.all([pbxApi.live(), pbxApi.status().catch(() => null)])
      .then(([liveData, statusData]) => {
        if (!mounted) return;
        setCalls(liveData);
        setStatus(statusData);
      })
      .catch((e) => console.warn("[live-monitor] fetch:", e?.message))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  // socket.io: استمع لأحداث call:live و call:ended
  useEffect(() => {
    socketProvider.start();
    const offLive = socketProvider.on("call:live" as any, (payload: any) => {
      setCalls((prev) => {
        const idx = prev.findIndex((c) => c.callKey === payload.callKey);
        const next: LiveCall = {
          id: payload.id,
          callKey: payload.callKey,
          ext: payload.ext,
          agentName: payload.agentName ?? null,
          remote: payload.remote,
          direction: payload.direction,
          status: payload.status,
          answered: payload.answered,
          startedAt: payload.startedAt,
          answeredAt: payload.answeredAt ?? null,
          lastSeenAt: new Date().toISOString(),
          elapsedSec: 0,
          transferTo: payload.transferTo ?? null,
          forwardedTo: payload.forwardedTo ?? null,
          customerId: payload.customerId ?? null,
          customerName: payload.customer ?? null,
          claimNumber: payload.claimNumber ?? null,
          trunk: payload.trunk ?? null,
          queue: payload.queue ?? null,
        };
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], ...next };
          return copy;
        }
        return [next, ...prev];
      });
    });
    const offEnded = socketProvider.on("call:ended" as any, (payload: any) => {
      setCalls((prev) => prev.filter((c) => c.callKey !== payload.callKey));
    });
    return () => { offLive(); offEnded(); };
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const [liveData, statusData] = await Promise.all([pbxApi.live(), pbxApi.status().catch(() => null)]);
      setCalls(liveData);
      setStatus(statusData);
    } finally {
      setRefreshing(false);
    }
  };

  const wsConnected = status?.yeastarOpenApiWs?.wsState === 1;
  const amiOk = status?.ami?.loggedIn;
  const integrationOnline = wsConnected || amiOk || (status?.yeastarApi?.configured ?? false);

  return (
    <AppLayout title="مراقبة المكالمات الحيّة" subtitle="المكالمات الجارية الآن مع تحديث لحظي عبر PBX">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-end gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "gap-1.5",
                integrationOnline
                  ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                  : "bg-rose-500/10 text-rose-600 border-rose-500/30"
              )}
            >
              {integrationOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {integrationOnline ? "متّصل بـ PBX" : "غير متّصل"}
            </Badge>
            <Button onClick={refresh} disabled={refreshing} variant="outline" size="sm" className="gap-2">
              <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
              تحديث
            </Button>
          </div>
        </div>

        {/* Status panel */}
        {status && (
          <Card className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <StatusItem
                label="Open API WS"
                ok={wsConnected}
                detail={status.yeastarOpenApiWs.configured ? `topics: ${status.yeastarOpenApiWs.topics.join(", ")}` : "غير مُفعّل"}
              />
              <StatusItem
                label="REST Token"
                ok={status.yeastarApi.hasToken}
                detail={status.yeastarApi.hasToken ? `صالح ${status.yeastarApi.expiresInSec}s` : "لا يوجد token"}
              />
              <StatusItem
                label="AMI"
                ok={!!status.ami.loggedIn}
                detail={status.ami.configured ? `${status.ami.host}:${status.ami.port}` : "معطّل"}
              />
              <StatusItem
                label="مكالمات جارية"
                ok={calls.length > 0}
                detail={`${calls.length} نشطة`}
              />
            </div>
          </Card>
        )}

        {/* Live calls grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : calls.length === 0 ? (
          <Card className="p-12 text-center">
            <Phone className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <h3 className="font-semibold text-lg mb-1">لا توجد مكالمات جارية</h3>
            <p className="text-sm text-muted-foreground">
              ستظهر المكالمات هنا تلقائياً فور بدئها على PBX
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {calls.map((call) => (
              <CallCard key={call.callKey} call={call} tick={tick} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function StatusItem({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className={cn("w-2 h-2 rounded-full mt-1.5", ok ? "bg-emerald-500" : "bg-muted-foreground/30")} />
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function CallCard({ call, tick }: { call: LiveCall; tick: number }) {
  const dir = DIRECTION_META[call.direction] || DIRECTION_META.unknown;
  const Icon = dir.Icon;
  // حساب الوقت المنقضي محلياً
  const startMs = new Date(call.startedAt).getTime();
  const elapsed = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  void tick; // إجبار re-render كل ثانية

  return (
    <Card className="p-5 hover:shadow-elegant transition-shadow">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn("w-11 h-11 rounded-xl border grid place-items-center shrink-0", dir.class)}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold truncate">{call.remote || "رقم غير معروف"}</div>
            <div className="text-xs text-muted-foreground">
              {dir.label} · {STATUS_LABEL[call.status] || call.status}
            </div>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "font-mono tabular-nums",
            call.answered
              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
              : "bg-amber-500/10 text-amber-600 border-amber-500/30 animate-pulse"
          )}
        >
          {formatElapsed(elapsed)}
        </Badge>
      </div>

      <div className="space-y-1.5 text-sm">
        {call.ext && (
          <Row label="التحويلة" value={`${call.ext}${call.agentName ? ` · ${call.agentName}` : ""}`} />
        )}
        {call.customerName && (
          <Row icon={<User className="w-3.5 h-3.5" />} label="العميل" value={call.customerName} />
        )}
        {call.claimNumber && (
          <Row icon={<FileText className="w-3.5 h-3.5" />} label="مطالبة" value={call.claimNumber} />
        )}
        {call.transferTo && <Row label="تحويل إلى" value={call.transferTo} />}
        {call.forwardedTo && <Row label="إعادة توجيه" value={call.forwardedTo} />}
        {(call.trunk || call.queue) && (
          <Row label="مصدر" value={[call.trunk, call.queue].filter(Boolean).join(" / ")} />
        )}
      </div>
    </Card>
  );
}

function Row({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {icon}{label}
      </span>
      <span className="font-medium truncate">{value}</span>
    </div>
  );
}
