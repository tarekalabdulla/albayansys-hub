// ============================================================================
// SidePanels — لوحات جانبية لصفحة الـ Dashboard.
// كل البيانات تأتي من /api (المشرفون / المكالمات / التنبيهات).
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { supervisorsApi, type ApiSupervisor } from "@/lib/dataApi";
import { useLiveAgents, useLiveAlerts } from "@/hooks/useLiveAgents";
import { formatDuration } from "@/lib/mockData";
import {
  PhoneIncoming, PhoneMissed, PhoneForwarded, Loader2, Inbox,
  AlertTriangle, Activity as ActivityIcon, Info,
} from "lucide-react";

// ---- Types -----------------------------------------------------------------
interface ApiCallRow {
  id: string;
  number: string;
  duration: number;
  status: "answered" | "missed" | "transferred";
  direction: string;
  startedAt: string;
  agent: string | null;
  ext: string | null;
}

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
// RecentCallsList — أحدث المكالمات من /api/calls
// ============================================================================
export function RecentCallsList() {
  const [calls, setCalls] = useState<ApiCallRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchCalls() {
      try {
        const { data } = await api.get<{ calls: ApiCallRow[] }>("/calls", {
          params: { limit: 6 },
        });
        if (!cancelled) setCalls(Array.isArray(data?.calls) ? data.calls : []);
      } catch {
        if (!cancelled) setCalls([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchCalls();
    const t = setInterval(fetchCalls, 20_000);
    return () => { cancelled = true; clearInterval(t); };
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
                  <p className="text-sm font-semibold truncate">{c.agent || "—"}</p>
                  <p className="text-[11px] text-muted-foreground" dir="ltr">{c.number}</p>
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold tabular-nums">{formatDuration(c.duration)}</p>
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
// ActivityList — التنبيهات من /api/alerts + التحديثات الحية من socket
// ============================================================================
export function ActivityList() {
  const [items, setItems] = useState<ApiAlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const liveAlerts = useLiveAlerts(10);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<{ alerts: ApiAlertRow[] }>("/alerts");
        if (!cancelled) setItems(Array.isArray(data?.alerts) ? data.alerts : []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ادمج التنبيهات الحية القادمة من socket مع المخزَّنة (إزالة التكرار حسب id)
  const merged = useMemo(() => {
    const map = new Map<string, ApiAlertRow>();
    [...liveAlerts, ...items].forEach((a) => map.set(a.id, a as ApiAlertRow));
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
