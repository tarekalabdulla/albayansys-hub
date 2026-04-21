import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  RefreshCw, CheckCircle2, XCircle, MinusCircle, Clock, Play, Loader2,
  Webhook as WebhookIcon, Wifi, PhoneCall, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type ServiceStatus = "connected" | "failed" | "disabled" | "idle";

interface WebhookInfo {
  status: ServiceStatus;
  secretConfigured: boolean;
  tokenConfigured: boolean;
  allowedIps: string[];
  lastEventAt: number | null;
  lastEventFrom: string | null;
  lastErrorAt: number | null;
  lastError: string | null;
  totalEvents: number;
  totalRejected: number;
}
interface OpenApiInfo {
  status: ServiceStatus;
  configured: boolean;
  authMode: string;
  hasToken: boolean;
  expiresIn: number;
  wsState: number;
  topics: number[];
  lastConnectedAt: number | null;
  lastEventAt: number | null;
  lastError: string | null;
  disabled: boolean;
}
interface AmiInfo {
  status: ServiceStatus;
  configured: boolean;
  connected: boolean;
  loggedIn: boolean;
  host: string | null;
  port: number;
  lastConnectedAt: number | null;
  lastEventAt: number | null;
  lastError: string | null;
}
interface StatusResponse {
  serverTime: number;
  webhook: WebhookInfo;
  openapi: OpenApiInfo;
  ami: AmiInfo;
}

const STATUS_LABEL: Record<ServiceStatus, string> = {
  connected: "متصل",
  failed:    "فشل الاتصال",
  disabled:  "معطّل",
  idle:      "بانتظار حدث",
};

function StatusBadge({ status }: { status: ServiceStatus }) {
  const Icon =
    status === "connected" ? CheckCircle2 :
    status === "failed"    ? XCircle :
    status === "disabled"  ? MinusCircle : Clock;
  return (
    <Badge
      className={cn(
        "gap-1.5 px-3 py-1 text-xs font-semibold",
        status === "connected" && "bg-success/15 text-success hover:bg-success/20 border-success/30",
        status === "failed"    && "bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30",
        status === "disabled"  && "bg-muted text-muted-foreground border-border",
        status === "idle"      && "bg-warning/15 text-warning hover:bg-warning/20 border-warning/30",
      )}
      variant="outline"
    >
      <Icon className="w-3.5 h-3.5" />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function fmtRelative(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000)        return `منذ ${Math.round(diff / 1000)} ثانية`;
  if (diff < 3_600_000)     return `منذ ${Math.round(diff / 60_000)} دقيقة`;
  if (diff < 86_400_000)    return `منذ ${Math.round(diff / 3_600_000)} ساعة`;
  return new Date(ts).toLocaleString("ar");
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-medium text-foreground", mono && "font-mono text-xs")}>{value}</span>
    </div>
  );
}

function TestResult({ result }: { result?: { ok: boolean; message: string; durationMs: number; at: number } }) {
  if (!result) return null;
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs flex items-start gap-2",
        result.ok
          ? "bg-success/10 border-success/30 text-success"
          : "bg-destructive/10 border-destructive/30 text-destructive",
      )}
    >
      {result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
      <div className="flex-1">
        <p className="font-semibold">{result.ok ? "نجح" : "فشل"} ({result.durationMs}ms)</p>
        <p className="opacity-90 break-all">{result.message}</p>
      </div>
    </div>
  );
}

function TestButton({
  busy, onClick,
}: { busy: boolean; onClick: () => void }) {
  return (
    <Button onClick={onClick} disabled={busy} size="sm" variant="outline" className="gap-2 w-full">
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
      {busy ? "جاري الاختبار..." : "اختبار الاتصال الآن"}
    </Button>
  );
}

export default function Integrations() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting]   = useState<Record<string, boolean>>({});
  const [results, setResults]   = useState<Record<string, { ok: boolean; message: string; durationMs: number; at: number } | undefined>>({});
  const { toast } = useToast();

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<StatusResponse>("/integrations/status");
      setData(data);
      setError(null);
    } catch (e) {
      const msg = (e as { message?: string })?.message || "فشل تحميل الحالة";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function runTest(kind: "webhook" | "openapi" | "ami") {
    setTesting((s) => ({ ...s, [kind]: true }));
    try {
      const { data } = await api.post<{ ok: boolean; message: string; durationMs: number }>(
        `/integrations/test/${kind}`,
      );
      setResults((s) => ({ ...s, [kind]: { ...data, at: Date.now() } }));
      toast({
        title: data.ok ? "نجح الاختبار" : "فشل الاختبار",
        description: data.message,
        variant: data.ok ? "default" : "destructive",
      });
      load();
    } catch (e) {
      const msg = (e as { message?: string })?.message || "تعذّر تنفيذ الاختبار";
      setResults((s) => ({ ...s, [kind]: { ok: false, message: msg, durationMs: 0, at: Date.now() } }));
      toast({ title: "خطأ", description: msg, variant: "destructive" });
    } finally {
      setTesting((s) => ({ ...s, [kind]: false }));
    }
  }

  const w = data?.webhook;
  const o = data?.openapi;
  const a = data?.ami;

  return (
    <AppLayout title="حالة الاتصالات" subtitle="مراقبة Webhook وOpenAPI وAMI لحظياً">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            يُحدَّث تلقائياً كل 5 ثوانٍ. آخر تحديث:{" "}
            <span className="font-medium text-foreground">
              {data ? new Date(data.serverTime).toLocaleTimeString("ar") : "—"}
            </span>
          </p>
          <Button onClick={load} disabled={loading} variant="outline" size="sm" className="gap-2">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            تحديث الآن
          </Button>
        </div>

        {error && (
          <Card className="p-4 border-destructive/40 bg-destructive/5 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {/* Webhook */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 grid place-items-center">
                  <WebhookIcon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Webhook</h3>
                  <p className="text-xs text-muted-foreground">يرسل من السنترال (PUSH)</p>
                </div>
              </div>
              {w && <StatusBadge status={w.status} />}
            </div>
            <div className="pt-2">
              <Row label="Token مضبوط" value={w?.tokenConfigured ? "نعم" : "لا"} />
              <Row label="HMAC Secret مضبوط" value={w?.secretConfigured ? "نعم" : "لا"} />
              <Row label="آخر حدث" value={fmtRelative(w?.lastEventAt ?? null)} />
              <Row label="من IP" value={w?.lastEventFrom || "—"} mono />
              <Row label="إجمالي الأحداث" value={w?.totalEvents ?? 0} />
              <Row label="مرفوضة" value={w?.totalRejected ?? 0} />
              {w?.lastError && (
                <Row label="آخر خطأ" value={<span className="text-destructive">{w.lastError}</span>} mono />
              )}
            </div>
            <TestButton busy={!!testing.webhook} onClick={() => runTest("webhook")} />
            <TestResult result={results.webhook} />
          </Card>

          {/* OpenAPI */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 grid place-items-center">
                  <Wifi className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Yeastar OpenAPI</h3>
                  <p className="text-xs text-muted-foreground">WebSocket مع PBX</p>
                </div>
              </div>
              {o && <StatusBadge status={o.status} />}
            </div>
            <div className="pt-2">
              <Row label="مُهيَّأ" value={o?.configured ? "نعم" : "لا"} />
              <Row label="معطَّل يدوياً" value={o?.disabled ? "نعم" : "لا"} />
              <Row label="نمط المصادقة" value={o?.authMode || "—"} />
              <Row label="Token صالح" value={o?.hasToken ? `نعم (${o?.expiresIn}s)` : "لا"} />
              <Row label="حالة WebSocket"
                   value={["CONNECTING", "OPEN", "CLOSING", "CLOSED"][o?.wsState ?? -1] || "غير مُنشأ"} />
              <Row label="آخر اتصال ناجح" value={fmtRelative(o?.lastConnectedAt ?? null)} />
              <Row label="آخر حدث" value={fmtRelative(o?.lastEventAt ?? null)} />
              {o?.lastError && (
                <Row label="آخر خطأ" value={<span className="text-destructive">{o.lastError}</span>} mono />
              )}
            </div>
            <TestButton busy={!!testing.openapi} onClick={() => runTest("openapi")} />
            <TestResult result={results.openapi} />
          </Card>

          {/* AMI */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 grid place-items-center">
                  <PhoneCall className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Asterisk AMI</h3>
                  <p className="text-xs text-muted-foreground">TCP مباشر مع السنترال</p>
                </div>
              </div>
              {a && <StatusBadge status={a.status} />}
            </div>
            <div className="pt-2">
              <Row label="مُهيَّأ" value={a?.configured ? "نعم" : "لا"} />
              <Row label="Host" value={a?.host || "—"} mono />
              <Row label="Port" value={a?.port ?? "—"} />
              <Row label="مُسجَّل دخول" value={a?.loggedIn ? "نعم" : "لا"} />
              <Row label="آخر اتصال ناجح" value={fmtRelative(a?.lastConnectedAt ?? null)} />
              <Row label="آخر حدث" value={fmtRelative(a?.lastEventAt ?? null)} />
              {a?.lastError && (
                <Row label="آخر خطأ" value={<span className="text-destructive">{a.lastError}</span>} mono />
              )}
            </div>
            <TestButton busy={!!testing.ami} onClick={() => runTest("ami")} />
            <TestResult result={results.ami} />
          </Card>
        </div>

        <Card className="p-5">
          <h4 className="font-semibold text-foreground mb-2">دليل سريع</h4>
          <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pr-5">
            <li><b>متصل:</b> القناة تعمل وتستقبل بيانات حديثة.</li>
            <li><b>بانتظار حدث:</b> القناة جاهزة لكن لم يصل حدث منذ &gt; 30 دقيقة (طبيعي خارج ساعات الذروة).</li>
            <li><b>فشل الاتصال:</b> القناة مُهيَّأة لكن لا تستطيع الاتصال — راجع الـ logs.</li>
            <li><b>معطّل:</b> القناة غير مضبوطة في <code className="font-mono text-xs">.env</code> أو معطّلة يدوياً.</li>
          </ul>
        </Card>
      </div>
    </AppLayout>
  );
}