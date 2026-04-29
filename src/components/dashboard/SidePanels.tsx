// ============================================================================
// SidePanels — لوحات جانبية لصفحة الـ Dashboard.
// البيانات الحقيقية تأتي من PBX: /api/pbx/calls + socket.io.
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { supervisorsApi, type ApiSupervisor } from "@/lib/dataApi";
import { useLiveAgents, useLiveAlerts } from "@/hooks/useLiveAgents";
import { formatDuration } from "@/lib/mockData";
import { pbxApi, type CallLog } from "@/lib/pbxApi";
import { socketProvider } from "@/lib/socketProvider";
import {
  PhoneIncoming,
  PhoneMissed,
  PhoneForwarded,
  PhoneOutgoing,
  PhoneCall,
  Loader2,
  Inbox,
  AlertTriangle,
  Activity as ActivityIcon,
  Info,
} from "lucide-react";

// ---- Types -----------------------------------------------------------------
interface ApiAlertRow {
  id: string;
  level: "info" | "warning" | "danger";
  title: string;
  message: string;
  agentId?: string | null;
  isRead?: boolean;
  time: number;
}

// ---- Helpers ---------------------------------------------------------------
function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "الآن";
  if (m < 60) return `منذ ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} س`;
  return `منذ ${Math.floor(h / 24)} ي`;
}

function formatTimeShort(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function EmptyState({ text, icon: Icon = Inbox }: { text: string; icon?: typeof Inbox }) {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
      <Icon className="w-8 h-8 opacity-40" />
      {text}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحميل…
    </div>
  );
}

function callDuration(c: CallLog): number {
  if (Number.isFinite(c.duration) && c.duration > 0) return c.duration;
  if (Number.isFinite(c.talkSeconds) && c.talkSeconds > 0) return c.talkSeconds;
  if (c.startedAt && c.endedAt) {
    const diff = Math.round((new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime()) / 1000);
    return Math.max(0, diff);
  }
  return 0;
}

function isMissedCall(c: CallLog): boolean {
  return c.status === "no_answer" || c.status === "failed" || c.status === "cancelled";
}

function isAnsweredCall(c: CallLog): boolean {
  return Boolean(c.answered) || c.status === "answered" || c.status === "completed";
}

function directionLabel(direction?: string | null): string {
  const map: Record<string, string> = {
    incoming: "واردة",
    outgoing: "صادرة",
    internal: "داخلية",
    transferred: "محوّلة",
    forwarded: "معاد توجيهها",
    unknown: "غير معروف",
  };
  return map[String(direction || "unknown")] || String(direction || "غير معروف");
}

function statusLabel(c: CallLog): string {
  if (isMissedCall(c)) return "فائتة";
  if (isAnsweredCall(c)) return "مجابة";
  if (c.status === "ringing") return "يرن";
  if (c.status === "busy") return "مشغول";
  return c.status || "غير معروف";
}

function callIcon(c: CallLog) {
  if (isMissedCall(c)) return PhoneMissed;
  if (c.direction === "outgoing") return PhoneOutgoing;
  if (c.direction === "internal") return PhoneCall;
  if (c.direction === "transferred" || c.direction === "forwarded") return PhoneForwarded;
  return PhoneIncoming;
}

function callColor(c: CallLog): string {
  if (isMissedCall(c)) return "text-destructive bg-destructive/10";
  if (c.direction === "outgoing") return "text-info bg-info/10";
  if (c.direction === "internal") return "text-primary bg-primary/10";
  return "text-success bg-success/10";
}

function callActivity(c: CallLog): ApiAlertRow {
  const missed = isMissedCall(c);
  const outgoing = c.direction === "outgoing";
  const internal = c.direction === "internal";

  return {
    id: `call-${c.id}`,
    level: missed ? "warning" : "info",
    title: missed
      ? "مكالمة فائتة"
      : outgoing
        ? "مكالمة صادرة"
        : internal
          ? "مكالمة داخلية"
          : "مكالمة واردة",
    message: `${c.agentName || c.ext || "موظف غير محدد"} · ${c.remote || "رقم غير معروف"} · ${statusLabel(c)}`,
    time: c.startedAt ? new Date(c.startedAt).getTime() : Date.now(),
  };
}

// ============================================================================
// SupervisorList — أداء المشرفين (يحسب SLA من بيانات الموظفين الحية)
// ============================================================================
export function SupervisorList() {
  const [supervisors, setSupervisors] = useState<ApiSupervisor[]>([]);
  const [loading, setLoading] = useState(true);
  const liveAgents = useLiveAgents();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await supervisorsApi.list();
        if (!cancelled) setSupervisors(list);
      } catch {
        if (!cancelled) setSupervisors([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    const agentsById = new Map(liveAgents.map((a) => [a.id, a]));
    return supervisors.map((s) => {
      const team = s.agentIds.map((id) => agentsById.get(id)).filter(Boolean);
      const answered = team.reduce((sum, a) => sum + (a?.answered ?? 0), 0);
      const missed = team.reduce((sum, a) => sum + (a?.missed ?? 0), 0);
      const total = answered + missed;
      const sla = total ? Math.round((answered / total) * 100) : 0;
      return { id: s.id, name: s.name, sla, answered, teamSize: team.length };
    });
  }, [supervisors, liveAgents]);

  return (
    <div className="glass-card p-5 anim-fade-in">
      <h3 className="text-base font-bold mb-4">أداء المشرفين</h3>
      {loading ? <LoadingState /> : rows.length === 0 ? (
        <EmptyState text="لا يوجد مشرفون مسجَّلون بعد" />
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => (
            <li key={s.id} className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full gradient-primary grid place-items-center text-xs font-bold text-primary-foreground">
                {s.name.split(" ").pop()?.slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <Link to={`/supervisors/${s.id}`} className="text-sm font-semibold truncate hover:text-primary hover:underline block">
                  {s.name}
                </Link>
                <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full gradient-primary" style={{ width: `${s.sla}%` }} />
                </div>
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-primary">{s.sla}%</p>
                <p className="text-[10px] text-muted-foreground">{s.answered} مكالمة</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================================
// RecentCallsList — أحدث المكالمات من /api/pbx/calls
// ============================================================================
export function RecentCallsList() {
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchCalls() {
    try {
      const data = await pbxApi.calls({ limit: 6 });
      setCalls(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn("[RecentCallsList] fetch:", e);
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const data = await pbxApi.calls({ limit: 6 });
        if (mounted) setCalls(Array.isArray(data) ? data : []);
      } catch (e) {
        console.warn("[RecentCallsList] initial fetch:", e);
        if (mounted) setCalls([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    socketProvider.start();
    const offEnded = socketProvider.on("call:ended" as any, () => {
      fetchCalls();
    });

    const t = window.setInterval(fetchCalls, 20_000);

    return () => {
      mounted = false;
      offEnded?.();
      window.clearInterval(t);
    };
  }, []);

  return (
    <div className="glass-card p-5 anim-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold">أحدث المكالمات</h3>
        <Link to="/live-report" className="text-xs text-primary font-semibold hover:underline">عرض الكل</Link>
      </div>
      {loading ? <LoadingState /> : calls.length === 0 ? (
        <EmptyState text="لا توجد مكالمات بعد" />
      ) : (
        <ul className="space-y-2.5">
          {calls.map((c) => {
            const Icon = callIcon(c);
            const color = callColor(c);

            return (
              <li key={c.id || c.callKey} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/60 transition-colors">
                <div className={cn("w-9 h-9 rounded-lg grid place-items-center", color)}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{c.agentName || c.ext || "—"}</p>
                  <p className="text-[11px] text-muted-foreground" dir="ltr">
                    {c.remote || "—"} · {directionLabel(c.direction)}
                  </p>
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold tabular-nums">{formatDuration(callDuration(c))}</p>
                  <p className="text-[10px] text-muted-foreground">{formatTimeShort(c.startedAt)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ============================================================================
// ActivityList — سجل النشاطات من آخر مكالمات PBX + socket
// ============================================================================
export function ActivityList() {
  const [items, setItems] = useState<ApiAlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const liveAlerts = useLiveAlerts(10);

  async function fetchActivities() {
    try {
      const calls = await pbxApi.calls({ limit: 10 });
      setItems((Array.isArray(calls) ? calls : []).map(callActivity));
    } catch (e) {
      console.warn("[ActivityList] fetch:", e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const calls = await pbxApi.calls({ limit: 10 });
        if (mounted) setItems((Array.isArray(calls) ? calls : []).map(callActivity));
      } catch (e) {
        console.warn("[ActivityList] initial fetch:", e);
        if (mounted) setItems([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    socketProvider.start();

    const offLive = socketProvider.on("call:live" as any, (p: any) => {
      const item: ApiAlertRow = {
        id: `live-${p.callKey || p.id || Date.now()}`,
        level: "info",
        title: "مكالمة نشطة",
        message: `${p.ext || "تحويلة غير محددة"} · ${p.remote || "رقم غير معروف"} · ${directionLabel(p.direction)}`,
        time: Date.now(),
      };
      setItems((prev) => [item, ...prev].slice(0, 10));
    });

    const offEnded = socketProvider.on("call:ended" as any, (p: any) => {
      const item: ApiAlertRow = {
        id: `ended-${p.callKey || p.id || Date.now()}`,
        level: p.answered === false ? "warning" : "info",
        title: p.answered === false ? "انتهت مكالمة غير مجابة" : "انتهت مكالمة",
        message: `${p.ext || "تحويلة غير محددة"} · ${p.remote || "رقم غير معروف"} · ${directionLabel(p.direction)}`,
        time: Date.now(),
      };
      setItems((prev) => [item, ...prev].slice(0, 10));
      fetchActivities();
    });

    const t = window.setInterval(fetchActivities, 30_000);

    return () => {
      mounted = false;
      offLive?.();
      offEnded?.();
      window.clearInterval(t);
    };
  }, []);

  const merged = useMemo(() => {
    const map = new Map<string, ApiAlertRow>();
    [...liveAlerts, ...items].forEach((a) => {
      if (!a?.id) return;
      map.set(a.id, a as ApiAlertRow);
    });
    return Array.from(map.values()).sort((a, b) => b.time - a.time).slice(0, 10);
  }, [items, liveAlerts]);

  const dot = (level: ApiAlertRow["level"]) =>
    level === "danger"  ? "bg-destructive" :
    level === "warning" ? "bg-warning"     : "bg-info";

  const icon = (level: ApiAlertRow["level"]) =>
    level === "danger" ? AlertTriangle : level === "warning" ? ActivityIcon : Info;

  return (
    <div className="glass-card p-5 anim-fade-in">
      <h3 className="text-base font-bold mb-4">سجل النشاطات</h3>
      {loading ? <LoadingState /> : merged.length === 0 ? (
        <EmptyState text="لا توجد نشاطات حالياً" icon={ActivityIcon} />
      ) : (
        <ul className="space-y-3 relative">
          {merged.map((a, i) => {
            const Icon = icon(a.level);
            return (
              <li key={a.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={cn("w-2.5 h-2.5 rounded-full mt-1.5", dot(a.level))} />
                  {i < merged.length - 1 && <span className="flex-1 w-px bg-border mt-1" />}
                </div>
                <div className="flex-1 pb-1">
                  <p className="text-sm leading-snug font-semibold flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5 opacity-70" />
                    {a.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{a.message}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">{timeAgo(a.time)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
