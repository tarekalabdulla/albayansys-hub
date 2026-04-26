// ============================================================================
// /yeastar — صفحة إعدادات Yeastar PBX (LAN) + زر Sync الموحّد
// ----------------------------------------------------------------------------
// تجمع في مكان واحد:
//   • نموذج الإعدادات (PBX IP، Client ID/Secret، Webhook Secret، IP Restriction)
//   • حالة الاتصال الحيّة (Webhook / OpenAPI / AMI) من /api/integrations/status
//   • زر "تحديث الاتصال (Sync Yeastar)" يقوم بكل شيء دفعة واحدة
//   • سجل آخر 20 مزامنة (وقت + حالة كل خطوة)
// أمن: الأسرار لا تظهر أبداً في الواجهة — فقط ستحصل على شارة "مضبوط/غير مضبوط".
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  RefreshCw, Save, Loader2, CheckCircle2, XCircle, MinusCircle, Clock,
  Server, KeyRound, History, ShieldCheck, TrendingUp, Plug, Zap, PhoneCall,
  Webhook, Network, Eye, EyeOff, Copy, Info, Send, PlayCircle, AlertTriangle,
} from "lucide-react";
import {
  Area, AreaChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// ---------------- Types ----------------
type ServiceStatus = "connected" | "failed" | "disabled" | "idle";

interface ConfigEnvelope {
  config: {
    pbxIp?: string;
    baseUrl?: string;
    authMode?: "client_credentials" | "basic_credentials";
    clientId?: string;
    clientIdIsSet?: boolean;
    clientSecretIsSet?: boolean;
    apiUsername?: string;
    apiPasswordIsSet?: boolean;
    webhookSecretIsSet?: boolean;
    webhookPath?: string;
    allowedIps?: string[];
    enabled?: boolean;
    lastSyncAt?: string;
    lastSyncOk?: boolean;
    // Phase 1 additions
    enableWebhook?: boolean;
    enableOpenAPI?: boolean;
    enableAMI?: boolean;
    amiHost?: string;
    amiPort?: number;
    amiUsername?: string;
    amiPasswordIsSet?: boolean;
  };
  env: {
    baseUrl: string | null;
    clientIdSet: boolean;
    clientSecretSet: boolean;
    webhookTokenSet: boolean;
    webhookSecretSet: boolean;
    webhookPath: string | null;
    allowedIps: string[];
  };
  status: {
    webhook: { lastEventAt: number | null; totalEvents: number; tokenConfigured: boolean; secretConfigured: boolean };
    openapi: { configured: boolean; wsState: number; hasToken: boolean; expiresIn: number; lastConnectedAt: number | null };
    ami:     { configured: boolean; connected: boolean; loggedIn: boolean; lastConnectedAt: number | null };
  };
  lastSync: SyncReport | null;
}

interface SyncReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  by: string;
  steps: {
    token:    { ok: boolean; message: string; expiresIn?: number };
    webhook:  { ok: boolean; message: string };
    cdr:      { ok: boolean; message: string; fetched: number; upserted: number };
    services: { ok: boolean; message: string };
  };
}

// ---------------- Helpers ----------------
function fmtRelative(ts: number | string | null | undefined): string {
  if (!ts) return "—";
  const t = typeof ts === "string" ? new Date(ts).getTime() : ts;
  const diff = Date.now() - t;
  if (diff < 60_000)     return `منذ ${Math.round(diff / 1000)} ثانية`;
  if (diff < 3_600_000)  return `منذ ${Math.round(diff / 60_000)} دقيقة`;
  if (diff < 86_400_000) return `منذ ${Math.round(diff / 3_600_000)} ساعة`;
  return new Date(t).toLocaleString("ar");
}

// ---------------- Realtime field validators ----------------
// نتأكد أن:
//   * baseUrl       = origin فقط (https://host[:port]) — يرفض webhook URL أو مسار
//   * webhookPath   = pathname فقط (يبدأ بـ /)         — يرفض origin كامل
// نفس منطق الباك إند (sanitizeBaseUrl / sanitizeWebhookPath) لتجربة فورية بدون round-trip.
type FieldValidation =
  | { kind: "ok"; cleaned?: string; hint?: string }
  | { kind: "warn"; message: string; cleaned?: string }
  | { kind: "error"; message: string };

function validateBaseUrl(raw: string): FieldValidation {
  const s = (raw || "").trim();
  if (!s) return { kind: "ok" };

  // أضف https إن لم يحتو على بروتوكول (للسماح بتجربة الإلصاق دون حاجز فوري)
  const withProto = /^https?:\/\//i.test(s) ? s : "https://" + s;

  let u: URL;
  try { u = new URL(withProto); }
  catch { return { kind: "error", message: "URL غير صالح. مثال: https://pbx.example.com" }; }

  const path  = (u.pathname || "/").replace(/\/+$/, "");
  const lower = path.toLowerCase();

  // كاشف صريح لـ webhook URL مُلصَق بالخطأ
  if (
    lower.includes("/api/yeastar") ||
    lower.includes("/webhook")     ||
    lower.includes("/call-event")  ||
    s.includes("{TOKEN}")          ||
    s.includes("%7BTOKEN%7D")
  ) {
    return {
      kind: "error",
      message:
        "هذه القيمة تبدو وكأنها Webhook URL. Base URL يجب أن يكون origin فقط " +
        "(مثال: https://pbx.example.com) — بدون /api/yeastar وبدون /webhook وبدون {TOKEN}.",
    };
  }

  if (!/^https?:$/i.test(u.protocol)) {
    return { kind: "error", message: "البروتوكول يجب أن يكون http أو https." };
  }

  // أي pathname آخر (مثل /openapi/v1.0/get_token) يُجرَّد ويحوَّل إلى تحذير
  const origin  = `${u.protocol}//${u.host}`;
  const trimmed = s.replace(/\/+$/, "");
  if (path && path !== "" && path !== "/") {
    return {
      kind: "warn",
      cleaned: origin,
      message: `سيتم تجريد المسار "${path}" تلقائياً. القيمة المحفوظة: ${origin}`,
    };
  }
  if (origin !== trimmed) {
    return { kind: "ok", cleaned: origin, hint: `سيُحفظ كـ ${origin}` };
  }
  return { kind: "ok" };
}

function validateWebhookPath(raw: string): FieldValidation {
  const s = (raw || "").trim();
  if (!s) return { kind: "ok" };

  // إن أُلصق URL كامل، استخرج pathname وأظهر تحذيراً
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const stripped = (u.pathname || "/") + (u.search || "");
      return {
        kind: "warn",
        cleaned: stripped,
        message: `سيتم إزالة origin تلقائياً. القيمة المحفوظة: ${stripped}`,
      };
    } catch {
      return { kind: "error", message: "URL غير صالح في خانة Webhook Path." };
    }
  }

  let v = s.startsWith("/") ? s : "/" + s;
  v = v.replace(/\/{2,}/g, "/");

  // الأحرف المسموحة (متطابقة مع الباك إند)
  if (!/^\/[A-Za-z0-9/_\-{}.:%]*$/.test(v)) {
    return {
      kind: "error",
      message: "Webhook Path يحتوي أحرفاً غير مسموحة. المسموح: A-Z a-z 0-9 / _ - { } . :",
    };
  }
  if (v !== s) return { kind: "ok", cleaned: v, hint: `سيُحفظ كـ ${v}` };
  return { kind: "ok" };
}

function FieldFeedback({ v }: { v: FieldValidation }) {
  if (v.kind === "ok" && !v.hint) return null;
  if (v.kind === "ok") {
    return <p className="text-[11px] text-success mt-1 flex items-start gap-1">
      <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" /> {v.hint}
    </p>;
  }
  if (v.kind === "warn") {
    return <p className="text-[11px] text-warning mt-1 flex items-start gap-1">
      <Clock className="w-3 h-3 mt-0.5 shrink-0" /> {v.message}
    </p>;
  }
  return <p className="text-[11px] text-destructive mt-1 flex items-start gap-1">
    <XCircle className="w-3 h-3 mt-0.5 shrink-0" /> {v.message}
  </p>;
}

function StatusChip({ status }: { status: ServiceStatus }) {
  const Icon = status === "connected" ? CheckCircle2
             : status === "failed"    ? XCircle
             : status === "disabled"  ? MinusCircle : Clock;
  const label = status === "connected" ? "متصل"
              : status === "failed"    ? "فشل"
              : status === "disabled"  ? "معطّل" : "بانتظار";
  return (
    <Badge variant="outline" className={cn(
      "gap-1.5",
      status === "connected" && "bg-success/15 text-success border-success/30",
      status === "failed"    && "bg-destructive/15 text-destructive border-destructive/30",
      status === "disabled"  && "bg-muted text-muted-foreground border-border",
      status === "idle"      && "bg-warning/15 text-warning border-warning/30",
    )}>
      <Icon className="w-3.5 h-3.5" /> {label}
    </Badge>
  );
}

function deriveStatus(env: ConfigEnvelope): { webhook: ServiceStatus; openapi: ServiceStatus; ami: ServiceStatus } {
  const wh = env.status.webhook;
  const oa = env.status.openapi;
  const ami = env.status.ami;
  return {
    webhook: !wh.tokenConfigured && !wh.secretConfigured ? "disabled"
           : wh.lastEventAt && Date.now() - wh.lastEventAt < 30 * 60_000 ? "connected"
           : wh.lastEventAt ? "idle" : "idle",
    openapi: !oa.configured ? "disabled" : oa.wsState === 1 ? "connected" : "failed",
    ami:     !ami.configured ? "disabled" : ami.loggedIn ? "connected" : "failed",
  };
}

// ---------------- Step result row ----------------
function StepRow({ label, ok, message }: { label: string; ok: boolean; message: string }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
      {ok
        ? <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
        : <XCircle    className="w-4 h-4 text-destructive mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className={cn("text-xs break-words", ok ? "text-muted-foreground" : "text-destructive")}>{message || "—"}</p>
      </div>
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================
interface TestResult {
  durationMs: number;
  baseUrl: string;
  token: { ok: boolean; message: string; expiresIn: number; tokenPreview: string };
  cdr: {
    ok: boolean;
    message: string;
    fetched: number;
    sample: Array<{
      time: string | null;
      caller: string;
      callee: string;
      duration: number;
      talk: number;
      status: string;
      direction: string;
    }>;
  };
}

export default function Yeastar() {
  const { toast } = useToast();
  const [data, setData]       = useState<ConfigEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [history, setHistory] = useState<SyncReport[]>([]);
  const [trend, setTrend]     = useState<{ day: string; total: number }[]>([]);

  // إظهار/إخفاء الأسرار
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [showAmiPassword, setShowAmiPassword] = useState(false);

  // أزرار التزامن مع PBX واختبار المستقبل
  const [syncingToPbx, setSyncingToPbx] = useState(false);
  const [testingReceiver, setTestingReceiver] = useState(false);
  const [pbxSyncResult, setPbxSyncResult] = useState<null | {
    ok: boolean;
    message: string;
    instructions?: {
      path: string;
      webhookUrl: string;
      method: string;
      events: string[];
      secretConfigured: boolean;
      signatureHeader: string;
      contentType: string;
    };
  }>(null);
  const [receiverTestResult, setReceiverTestResult] = useState<null | {
    ok: boolean;
    message: string;
    url?: string | null;
    httpStatus?: number | null;
  }>(null);

  // Webhook Full URL — يُحسب من window.location.origin + المسار من الإعدادات (بدون token حسّاس)
  const webhookFullUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const origin = window.location.origin.replace(/\/+$/, "");
    // نعرض المسار العام بدون {TOKEN} (Yeastar سيُلحقه بنفسه عند الاستدعاء)
    const path = "/api/yeastar/webhook/call-event";
    return `${origin}${path}`;
  }, []);

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "تم النسخ", description: `${label} نُسخ إلى الحافظة` });
    } catch {
      toast({ title: "فشل النسخ", description: "تعذّر النسخ — انسخ يدوياً", variant: "destructive" });
    }
  }

  // form state — يشمل الآن: API + Webhook + AMI
  const [form, setForm] = useState({
    baseUrl: "",
    // وضع المصادقة الصريح — يتحكّم بحقول get_token payload
    authMode: "client_credentials" as "client_credentials" | "basic_credentials",
    clientId: "",
    clientSecret: "",
    apiUsername: "",
    apiPassword: "",
    // Webhook
    webhookSecret: "",
    webhookPath: "/api/yeastar/webhook/call-event/{TOKEN}",
    allowedIpsText: "",
    enableWebhook: true,
    enableOpenAPI: true,
    // AMI
    enableAMI: false,
    amiHost: "",
    amiPort: 5038,
    amiUsername: "",
    amiPassword: "",
  });

  async function load() {
    try {
      const [{ data: cfg }, { data: hist }, { data: tr }] = await Promise.all([
        api.get<ConfigEnvelope>("/yeastar/config"),
        api.get<{ items: SyncReport[] }>("/yeastar/sync/history"),
        api.get<{ items: { day: string; total: number }[] }>("/yeastar/sync/trend"),
      ]);
      setData(cfg);
      setHistory(hist.items || []);
      setTrend(tr.items || []);
      const c = cfg.config || {};
      setForm({
        baseUrl: c.baseUrl || cfg.env.baseUrl || "",
        authMode: (c.authMode === "basic_credentials" ? "basic_credentials" : "client_credentials"),
        clientId: c.clientId || "",
        clientSecret: "",
        apiUsername: c.apiUsername || "",
        apiPassword: "",
        webhookSecret: "",
        webhookPath: c.webhookPath || cfg.env.webhookPath || "/api/yeastar/webhook/call-event/{TOKEN}",
        allowedIpsText: (c.allowedIps && c.allowedIps.length ? c.allowedIps : cfg.env.allowedIps).join("\n"),
        enableWebhook: c.enableWebhook !== false, // default true
        enableOpenAPI: c.enableOpenAPI !== false, // default true
        enableAMI:     Boolean(c.enableAMI),       // default false
        amiHost:       c.amiHost || "",
        amiPort:       Number(c.amiPort) || 5038,
        amiUsername:   c.amiUsername || "",
        amiPassword:   "",
      });
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (e as { message?: string })?.message
        || "تعذّر التحميل";
      toast({ title: "فشل التحميل", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000); // تحديث الحالة كل 10s
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSave(thenSync = false) {
    setSaving(true);
    try {
      const allowedIps = form.allowedIpsText
        .split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
      await api.put("/yeastar/config", {
        enabled: true,
        baseUrl: form.baseUrl.trim(),
        clientId: form.clientId.trim(),
        ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
        // Webhook
        ...(form.webhookSecret ? { webhookSecret: form.webhookSecret } : {}),
        webhookPath: form.webhookPath.trim() || "/api/yeastar/webhook/call-event/{TOKEN}",
        allowedIps,
        enableWebhook: form.enableWebhook,
        enableOpenAPI: form.enableOpenAPI,
        // AMI
        enableAMI: form.enableAMI,
        amiHost: form.amiHost.trim(),
        amiPort: Number(form.amiPort) || 5038,
        amiUsername: form.amiUsername.trim(),
        ...(form.amiPassword ? { amiPassword: form.amiPassword } : {}),
      });
      toast({ title: "تم الحفظ", description: "تم تحديث إعدادات Yeastar (API + Webhook + AMI)." });
      setForm((p) => ({ ...p, clientSecret: "", webhookSecret: "", amiPassword: "" }));
      await load();
      if (thenSync) await onSync();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (e as { message?: string })?.message
        || "فشل الحفظ";
      toast({ title: "فشل الحفظ", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function onSync() {
    setSyncing(true);
    try {
      const { data: r } = await api.post<{ report: SyncReport }>("/yeastar/sync");
      const rep = r.report;
      toast({
        title: rep.ok ? "تمت المزامنة بنجاح" : "اكتملت المزامنة بأخطاء",
        description: `Token: ${rep.steps.token.ok ? "✓" : "✗"} • Webhook: ${rep.steps.webhook.ok ? "✓" : "✗"} • CDR: ${rep.steps.cdr.upserted}/${rep.steps.cdr.fetched}`,
        variant: rep.ok ? "default" : "destructive",
      });
      load();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (e as { message?: string })?.message
        || "تعذّرت المزامنة";
      toast({ title: "فشل المزامنة", description: msg, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const payload: Record<string, string> = {};
      if (form.baseUrl.trim())      payload.baseUrl = form.baseUrl.trim();
      if (form.clientId.trim())     payload.clientId = form.clientId.trim();
      if (form.clientSecret.trim()) payload.clientSecret = form.clientSecret.trim();
      const { data: r } = await api.post<{ result: TestResult }>("/yeastar/sync/test", payload);
      setTestResult(r.result);
      toast({
        title: r.result.token.ok && r.result.cdr.ok ? "اختبار ناجح" : "اختبار اكتمل بأخطاء",
        description: `Token: ${r.result.token.ok ? "✓" : "✗"} • CDR: ${r.result.cdr.fetched} سجل`,
        variant: r.result.token.ok && r.result.cdr.ok ? "default" : "destructive",
      });
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string; message?: string } }; message?: string })?.response?.data?.message
        || (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (e as { message?: string })?.message
        || "تعذّر الاختبار";
      toast({ title: "فشل الاختبار", description: msg, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  async function onSyncToPbx() {
    setSyncingToPbx(true);
    setPbxSyncResult(null);
    try {
      const { data: r } = await api.post("/yeastar/sync-webhook-to-pbx");
      setPbxSyncResult({
        ok: Boolean(r?.ok),
        message: r?.message || "تم",
        instructions: r?.instructions,
      });
      toast({
        title: r?.ok ? "اتصال PBX ناجح" : "فشل التزامن",
        description: r?.message || "—",
        variant: r?.ok ? "default" : "destructive",
      });
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string; error?: string } }; message?: string })?.response?.data?.message
        || (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (e as { message?: string })?.message
        || "تعذّر التزامن";
      setPbxSyncResult({ ok: false, message: msg });
      toast({ title: "فشل التزامن", description: msg, variant: "destructive" });
    } finally {
      setSyncingToPbx(false);
    }
  }

  async function onTestReceiver() {
    setTestingReceiver(true);
    setReceiverTestResult(null);
    try {
      const { data: r } = await api.post("/yeastar/test-webhook-receiver");
      setReceiverTestResult({
        ok: Boolean(r?.ok),
        message: r?.message || "—",
        url: r?.url || null,
        httpStatus: r?.httpStatus || null,
      });
      toast({
        title: r?.ok ? "Receiver يعمل" : "Receiver لا يستجيب",
        description: r?.message || "—",
        variant: r?.ok ? "default" : "destructive",
      });
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string; error?: string } }; message?: string })?.response?.data?.message
        || (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (e as { message?: string })?.message
        || "تعذّر الاختبار";
      setReceiverTestResult({ ok: false, message: msg });
      toast({ title: "فشل الاختبار", description: msg, variant: "destructive" });
    } finally {
      setTestingReceiver(false);
    }
  }

  const status = data ? deriveStatus(data) : null;
  const c = data?.config || {};

  // Realtime validation (memoized)
  const baseUrlValidation     = useMemo(() => validateBaseUrl(form.baseUrl),         [form.baseUrl]);
  const webhookPathValidation = useMemo(() => validateWebhookPath(form.webhookPath), [form.webhookPath]);
  const hasFieldErrors        = baseUrlValidation.kind === "error" || webhookPathValidation.kind === "error";

  return (
    <AppLayout title="إعدادات Yeastar PBX" subtitle="تكامل LAN آمن مع زر تحديث موحّد">
      {loading && !data ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">

          {/* ====== تنبيه: هذه صفحة إعدادات فقط، ليست رابط Webhook ====== */}
          <Alert className="border-warning/40 bg-warning/10">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <AlertTitle className="text-foreground">صفحة إعدادات فقط — ليست رابط Webhook</AlertTitle>
            <AlertDescription className="text-muted-foreground text-sm leading-relaxed">
              هذا رابط صفحة الإعدادات (<code dir="ltr" className="text-foreground">/yeastar</code>).
              <b className="text-foreground"> رابط استقبال أحداث Yeastar الصحيح هو Webhook Full URL </b>
              المعروض في البطاقة أدناه — أدخله في واجهة Yeastar PBX من
              <code dir="ltr" className="mx-1">Integrations → API → Webhook</code>.
            </AlertDescription>
          </Alert>

          {/* ====== بطاقة Webhook Full URL — للنسخ السريع ====== */}
          <Card className="p-5 border-primary/30 bg-primary/5">
            <div className="flex items-start gap-3 mb-3">
              <Webhook className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-foreground">Webhook Full URL</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  هذا هو العنوان الذي يجب نسخه ولصقه في <b>Yeastar PBX → Integrations → API → Webhook</b>.
                  Method: <code dir="ltr">POST</code> • Events: <code dir="ltr">30016, 30012</code>.
                </p>
              </div>
            </div>
            <div className="flex items-stretch gap-2 flex-wrap">
              <div className="flex-1 min-w-[280px] rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground break-all" dir="ltr">
                {webhookFullUrl}
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => copyToClipboard(webhookFullUrl, "Webhook URL")}
                className="gap-2 shrink-0"
              >
                <Copy className="w-4 h-4" /> نسخ
              </Button>
            </div>
            <div className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                إذا كان <code dir="ltr">YEASTAR_WEBHOOK_TOKEN</code> مضبوطاً، Yeastar يجب أن يلحقه في نهاية الـ URL
                (<code dir="ltr">/{`{TOKEN}`}</code>). يحتفظ السيرفر بالـ token في <code>.env</code> فقط ولا يعرضه هنا.
              </span>
            </div>
          </Card>

          {/* ====== شريط الحالة العلوي + زر المزامنة ====== */}
          <Card className="p-5">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Server className="w-5 h-5 text-primary" />
                  حالة التكامل
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  آخر مزامنة:{" "}
                  <span className="font-medium text-foreground">{fmtRelative(c.lastSyncAt)}</span>
                  {c.lastSyncOk !== undefined && (
                    <span className={cn("ms-2 inline-flex items-center gap-1 text-xs",
                      c.lastSyncOk ? "text-success" : "text-destructive")}>
                      {c.lastSyncOk ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                      {c.lastSyncOk ? "نجحت" : "فشلت"}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {status && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Webhook</span>
                      <StatusChip status={status.webhook} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">OpenAPI</span>
                      <StatusChip status={status.openapi} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">AMI</span>
                      <StatusChip status={status.ami} />
                    </div>
                  </>
                )}
              </div>
            </div>

            <Separator className="my-4" />

            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-xs text-muted-foreground max-w-xl">
                يقوم زر <b>تحديث الاتصال</b> بـ: تجديد access_token، اختبار webhook، سحب آخر 100 مكالمة من Yeastar API،
                وتحديث حالة كل القنوات. يُنفَّذ كل شيء على السيرفر — لا تخرج أي أسرار للواجهة.
              </p>
              <Button onClick={onSync} disabled={syncing} size="lg" className="gap-2">
                {syncing
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <RefreshCw className="w-4 h-4" />}
                {syncing ? "جاري التحديث..." : "تحديث الاتصال (Sync Yeastar)"}
              </Button>
            </div>

            {/* نتيجة آخر مزامنة بصرياً */}
            {data?.lastSync && (
              <div className="mt-5 rounded-lg border border-border/60 bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground mb-2">
                  نتيجة آخر مزامنة ({fmtRelative(data.lastSync.finishedAt)} • {data.lastSync.durationMs}ms)
                </p>
                <StepRow label="تجديد access_token"     ok={data.lastSync.steps.token.ok}    message={data.lastSync.steps.token.message} />
                <StepRow label="اختبار Webhook"          ok={data.lastSync.steps.webhook.ok}  message={data.lastSync.steps.webhook.message} />
                <StepRow label="سحب آخر المكالمات (CDR)" ok={data.lastSync.steps.cdr.ok}      message={data.lastSync.steps.cdr.message} />
                <StepRow label="فحص الخدمات"             ok={data.lastSync.steps.services.ok} message={data.lastSync.steps.services.message} />
              </div>
            )}
          </Card>

          {/* ====== رسم بياني: اتجاه المكالمات المزامنة آخر 7 أيام ====== */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  اتجاه المكالمات المزامنة (آخر 7 أيام)
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  إجمالي السجلات الواردة من Yeastar (Webhook + Sync API) في pbx_call_logs
                </p>
              </div>
              <div className="text-end">
                <p className="text-2xl font-bold text-foreground tabular-nums">
                  {trend.reduce((s, d) => s + (d.total || 0), 0).toLocaleString("ar")}
                </p>
                <p className="text-[11px] text-muted-foreground">إجمالي 7 أيام</p>
              </div>
            </div>
            <div className="h-[180px] w-full">
              {trend.length === 0 ? (
                <div className="h-full grid place-items-center text-sm text-muted-foreground">
                  لا توجد بيانات بعد
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="syncTrendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(d: string) => {
                        const dt = new Date(d);
                        return dt.toLocaleDateString("ar", { weekday: "short" });
                      }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                      width={30}
                    />
                    <RTooltip
                      contentStyle={{
                        background: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelFormatter={(d: string) => new Date(d).toLocaleDateString("ar", {
                        weekday: "long", day: "numeric", month: "short",
                      })}
                      formatter={(v: number) => [v.toLocaleString("ar"), "المكالمات"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="total"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#syncTrendFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          {/* ====== نموذج إعدادات API (Yeastar P-Series) ====== */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-primary" />
                إعدادات API (Yeastar P560)
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              من واجهة Yeastar: <b>Integrations → API</b> — فعّل <code>API</code> ثم انسخ <code>Client ID</code> و <code>Client Secret</code> هنا.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label htmlFor="baseUrl" className="text-xs">Base URL</Label>
                <Input
                  id="baseUrl"
                  placeholder="https://hululalbayan.ras.yeastar.com"
                  dir="ltr"
                  value={form.baseUrl}
                  onChange={(e) => setForm((p) => ({ ...p, baseUrl: e.target.value }))}
                  aria-invalid={baseUrlValidation.kind === "error"}
                  className={cn(
                    baseUrlValidation.kind === "error" &&
                      "border-destructive focus-visible:ring-destructive",
                    baseUrlValidation.kind === "warn" &&
                      "border-warning focus-visible:ring-warning",
                  )}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  عنوان السنترال (origin فقط: <code dir="ltr">https://host[:port]</code>). بدون <code>/openapi</code> وبدون <code>/api/yeastar</code> وبدون <code>{"{TOKEN}"}</code>.
                </p>
                <FieldFeedback v={baseUrlValidation} />
              </div>

              <div>
                <Label htmlFor="clientId" className="text-xs">Client ID</Label>
                <Input
                  id="clientId"
                  dir="ltr"
                  placeholder="من Yeastar Open API"
                  value={form.clientId}
                  onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value }))}
                />
              </div>

              <div>
                <Label htmlFor="clientSecret" className="text-xs flex items-center gap-2">
                  Client Secret
                  {(c.clientSecretIsSet || data?.env.clientSecretSet) && (
                    <Badge variant="outline" className="bg-success/15 text-success border-success/30 text-[10px]">
                      مضبوط
                    </Badge>
                  )}
                </Label>
                <div className="relative">
                  <Input
                    id="clientSecret"
                    dir="ltr"
                    type={showClientSecret ? "text" : "password"}
                    placeholder="••••••••  (اتركه فارغاً للإبقاء)"
                    value={form.clientSecret}
                    onChange={(e) => setForm((p) => ({ ...p, clientSecret: e.target.value }))}
                    className="pe-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowClientSecret((v) => !v)}
                    className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showClientSecret ? "إخفاء" : "إظهار"}
                  >
                    {showClientSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="w-4 h-4 text-success" />
                <span>السر يُخزَّن في DB فقط ولا يُرسَل للواجهة. التوكن يُجدَّد تلقائياً.</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {hasFieldErrors && (
                  <p className="text-[11px] text-destructive flex items-center gap-1 me-2">
                    <XCircle className="w-3.5 h-3.5" />
                    صحّح الأخطاء أعلاه قبل المتابعة
                  </p>
                )}
                <Button
                  variant="secondary"
                  onClick={onTest}
                  disabled={testing || saving || syncing || hasFieldErrors}
                  className="gap-2"
                >
                  {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {testing ? "جاري الاختبار..." : "اختبار الاتصال (بدون حفظ)"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onSave(true)}
                  disabled={saving || syncing || hasFieldErrors}
                  className="gap-2"
                >
                  {(saving || syncing) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
                  حفظ + اختبار الاتصال
                </Button>
                <Button onClick={() => onSave(false)} disabled={saving || hasFieldErrors} className="gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
                </Button>
              </div>
            </div>

            {/* نتيجة آخر اختبار اتصال (بدون حفظ) */}
            {testResult && (
              <div className="mt-5 rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Zap className="w-4 h-4 text-primary" />
                    نتيجة اختبار الاتصال
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {testResult.baseUrl || "—"} • {testResult.durationMs}ms
                  </p>
                </div>

                {/* Token */}
                <div className={cn(
                  "rounded-md border p-3",
                  testResult.token.ok ? "border-success/30 bg-success/10" : "border-destructive/30 bg-destructive/10"
                )}>
                  <div className="flex items-center gap-2 mb-1">
                    {testResult.token.ok
                      ? <CheckCircle2 className="w-4 h-4 text-success" />
                      : <XCircle className="w-4 h-4 text-destructive" />}
                    <p className="text-sm font-medium text-foreground">access_token</p>
                    {testResult.token.ok && (
                      <Badge variant="outline" className="bg-success/15 text-success border-success/30 text-[10px]">
                        ينتهي خلال {testResult.token.expiresIn}s
                      </Badge>
                    )}
                  </div>
                  <p className={cn("text-xs break-words",
                    testResult.token.ok ? "text-muted-foreground" : "text-destructive")}>
                    {testResult.token.message}
                  </p>
                  {testResult.token.tokenPreview && (
                    <p className="text-[11px] text-muted-foreground mt-1 font-mono" dir="ltr">
                      {testResult.token.tokenPreview}
                    </p>
                  )}
                </div>

                {/* CDR */}
                <div className={cn(
                  "rounded-md border p-3",
                  testResult.cdr.ok ? "border-success/30 bg-success/10" : "border-destructive/30 bg-destructive/10"
                )}>
                  <div className="flex items-center gap-2 mb-2">
                    {testResult.cdr.ok
                      ? <CheckCircle2 className="w-4 h-4 text-success" />
                      : <XCircle className="w-4 h-4 text-destructive" />}
                    <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      <PhoneCall className="w-3.5 h-3.5" /> CDR (آخر المكالمات)
                    </p>
                    <Badge variant="outline" className="text-[10px]">
                      {testResult.cdr.fetched} سجل
                    </Badge>
                  </div>
                  <p className={cn("text-xs",
                    testResult.cdr.ok ? "text-muted-foreground" : "text-destructive")}>
                    {testResult.cdr.message}
                  </p>

                  {testResult.cdr.sample.length > 0 && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground border-b border-border/60">
                            <th className="text-start py-1.5 px-2">الوقت</th>
                            <th className="text-start py-1.5 px-2">من</th>
                            <th className="text-start py-1.5 px-2">إلى</th>
                            <th className="text-start py-1.5 px-2">الاتجاه</th>
                            <th className="text-start py-1.5 px-2">الحالة</th>
                            <th className="text-start py-1.5 px-2">المدة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {testResult.cdr.sample.map((row, i) => (
                            <tr key={i} className="border-b border-border/30 last:border-0">
                              <td className="py-1.5 px-2 text-foreground" dir="ltr">
                                {row.time ? new Date(row.time).toLocaleString("ar") : "—"}
                              </td>
                              <td className="py-1.5 px-2 font-mono text-foreground" dir="ltr">{row.caller || "—"}</td>
                              <td className="py-1.5 px-2 font-mono text-foreground" dir="ltr">{row.callee || "—"}</td>
                              <td className="py-1.5 px-2 text-muted-foreground">{row.direction || "—"}</td>
                              <td className="py-1.5 px-2 text-muted-foreground">{row.status || "—"}</td>
                              <td className="py-1.5 px-2 tabular-nums text-foreground">
                                {row.talk || row.duration}s
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* ====== إعدادات Webhook ====== */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Webhook className="w-5 h-5 text-primary" />
                إعدادات Webhook
              </h2>
              <div className="flex items-center gap-2">
                <Label htmlFor="enableWebhook" className="text-xs text-muted-foreground">تفعيل</Label>
                <Switch
                  id="enableWebhook"
                  checked={form.enableWebhook}
                  onCheckedChange={(v) => setForm((p) => ({ ...p, enableWebhook: v }))}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              من Yeastar: <b>Integrations → API → Webhook</b> — استخدم URL ينتهي بالـ token، وفعّل HMAC إن أمكن.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label htmlFor="webhookPath" className="text-xs">Webhook Path</Label>
                <Input
                  id="webhookPath"
                  dir="ltr"
                  placeholder="/api/yeastar/webhook/call-event/{TOKEN}"
                  value={form.webhookPath}
                  onChange={(e) => setForm((p) => ({ ...p, webhookPath: e.target.value }))}
                  aria-invalid={webhookPathValidation.kind === "error"}
                  className={cn(
                    webhookPathValidation.kind === "error" &&
                      "border-destructive focus-visible:ring-destructive",
                    webhookPathValidation.kind === "warn" &&
                      "border-warning focus-visible:ring-warning",
                  )}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  pathname فقط يبدأ بـ <code>/</code> (بدون <code dir="ltr">https://</code> وبدون اسم المضيف). <code>{"{TOKEN}"}</code> يُستبدَل بـ <code>YEASTAR_WEBHOOK_TOKEN</code>.
                </p>
                <FieldFeedback v={webhookPathValidation} />
              </div>

              <div>
                <Label htmlFor="webhookSecret" className="text-xs flex items-center gap-2">
                  Webhook Secret (HMAC)
                  {(c.webhookSecretIsSet || data?.env.webhookSecretSet) && (
                    <Badge variant="outline" className="bg-success/15 text-success border-success/30 text-[10px]">
                      مضبوط
                    </Badge>
                  )}
                </Label>
                <Input
                  id="webhookSecret"
                  dir="ltr"
                  type="password"
                  placeholder="••••••••  (اتركه فارغاً للإبقاء)"
                  value={form.webhookSecret}
                  onChange={(e) => setForm((p) => ({ ...p, webhookSecret: e.target.value }))}
                />
              </div>

              <div>
                <Label htmlFor="allowedIps" className="text-xs">IPs مسموح بها (سطر/IP)</Label>
                <Textarea
                  id="allowedIps"
                  dir="ltr"
                  rows={3}
                  placeholder={"مثال:\n203.0.113.10\n198.51.100.20"}
                  value={form.allowedIpsText}
                  onChange={(e) => setForm((p) => ({ ...p, allowedIpsText: e.target.value }))}
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  اتركها فارغة لتعطيل فحص IP. حد أقصى 20 IP.
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-border/60 bg-muted/20 p-3 text-xs space-y-1">
              <p className="text-muted-foreground">
                <b className="text-foreground">آخر حدث استُلم:</b>{" "}
                {data?.status.webhook.lastEventAt
                  ? fmtRelative(data.status.webhook.lastEventAt)
                  : <span className="text-warning">لم يصل أي حدث بعد</span>}
              </p>
              <p className="text-muted-foreground">
                <b className="text-foreground">إجمالي الأحداث المستلمة:</b>{" "}
                {(data?.status.webhook.totalEvents || 0).toLocaleString("ar")}
              </p>
              <p className="text-muted-foreground">
                <b className="text-foreground">Token:</b>{" "}
                {data?.status.webhook.tokenConfigured
                  ? <span className="text-success">مضبوط في .env</span>
                  : <span className="text-destructive">غير مضبوط (YEASTAR_WEBHOOK_TOKEN)</span>}
              </p>
            </div>
          </Card>

          {/* ====== إعدادات AMI (Asterisk Manager Interface) ====== */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Network className="w-5 h-5 text-primary" />
                إعدادات AMI (مراقبة لحظية)
              </h2>
              <div className="flex items-center gap-2">
                <Label htmlFor="enableAMI" className="text-xs text-muted-foreground">تفعيل</Label>
                <Switch
                  id="enableAMI"
                  checked={form.enableAMI}
                  onCheckedChange={(v) => setForm((p) => ({ ...p, enableAMI: v }))}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              ⚠️ يعمل فقط إذا كان السيرفر يصل شبكياً إلى PBX على البورت 5038. <b>لا يعمل مع Yeastar Cloud RAS.</b>
            </p>

            <div className={cn("grid gap-4 md:grid-cols-2", !form.enableAMI && "opacity-50 pointer-events-none")}>
              <div>
                <Label htmlFor="amiHost" className="text-xs">AMI Host (IP/Hostname)</Label>
                <Input
                  id="amiHost"
                  dir="ltr"
                  placeholder="192.168.100.254"
                  value={form.amiHost}
                  onChange={(e) => setForm((p) => ({ ...p, amiHost: e.target.value }))}
                />
              </div>

              <div>
                <Label htmlFor="amiPort" className="text-xs">AMI Port</Label>
                <Input
                  id="amiPort"
                  type="number"
                  dir="ltr"
                  placeholder="5038"
                  value={form.amiPort}
                  onChange={(e) => setForm((p) => ({ ...p, amiPort: parseInt(e.target.value, 10) || 5038 }))}
                />
              </div>

              <div>
                <Label htmlFor="amiUsername" className="text-xs">AMI Username</Label>
                <Input
                  id="amiUsername"
                  dir="ltr"
                  placeholder="من PBX → Settings → Security → AMI"
                  value={form.amiUsername}
                  onChange={(e) => setForm((p) => ({ ...p, amiUsername: e.target.value }))}
                />
              </div>

              <div>
                <Label htmlFor="amiPassword" className="text-xs flex items-center gap-2">
                  AMI Password
                  {c.amiPasswordIsSet && (
                    <Badge variant="outline" className="bg-success/15 text-success border-success/30 text-[10px]">
                      مضبوط
                    </Badge>
                  )}
                </Label>
                <Input
                  id="amiPassword"
                  dir="ltr"
                  type="password"
                  placeholder="••••••••  (اتركه فارغاً للإبقاء)"
                  value={form.amiPassword}
                  onChange={(e) => setForm((p) => ({ ...p, amiPassword: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-4 rounded-md border border-border/60 bg-muted/20 p-3 text-xs space-y-1">
              <p className="text-muted-foreground">
                <b className="text-foreground">حالة الاتصال:</b>{" "}
                {!data?.status.ami.configured ? <span className="text-muted-foreground">معطّل</span>
                : data.status.ami.loggedIn ? <span className="text-success">متصل ومسجَّل دخول</span>
                : <span className="text-destructive">غير متصل</span>}
              </p>
              <p className="text-muted-foreground">
                <b className="text-foreground">آخر اتصال ناجح:</b>{" "}
                {data?.status.ami.lastConnectedAt ? fmtRelative(data.status.ami.lastConnectedAt) : "—"}
              </p>
              <p className="text-warning text-[11px] mt-2">
                💡 إذا كان PBX خلف Yeastar Cloud RAS، اترك AMI معطّلاً واستخدم Webhook + OpenAPI فقط.
              </p>
            </div>
          </Card>

          {/* ====== سجل آخر المزامنات ====== */}
          <Card className="p-5">
            <h3 className="font-semibold text-foreground flex items-center gap-2 mb-3">
              <History className="w-5 h-5 text-primary" />
              سجل المزامنات (آخر 20)
            </h3>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">لا توجد مزامنات سابقة بعد.</p>
            ) : (
              <div className="space-y-2">
                {history.map((h, i) => (
                  <div key={i} className="rounded-lg border border-border/50 p-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      {h.ok
                        ? <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                        : <XCircle    className="w-5 h-5 text-destructive shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {new Date(h.finishedAt).toLocaleString("ar")}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          بواسطة {h.by} • {h.durationMs}ms • CDR {h.steps.cdr.upserted}/{h.steps.cdr.fetched}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className={cn("text-[10px]",
                        h.steps.token.ok    ? "bg-success/15 text-success border-success/30" : "bg-destructive/15 text-destructive border-destructive/30")}>
                        Token {h.steps.token.ok ? "✓" : "✗"}
                      </Badge>
                      <Badge variant="outline" className={cn("text-[10px]",
                        h.steps.webhook.ok  ? "bg-success/15 text-success border-success/30" : "bg-destructive/15 text-destructive border-destructive/30")}>
                        Webhook {h.steps.webhook.ok ? "✓" : "✗"}
                      </Badge>
                      <Badge variant="outline" className={cn("text-[10px]",
                        h.steps.cdr.ok      ? "bg-success/15 text-success border-success/30" : "bg-destructive/15 text-destructive border-destructive/30")}>
                        CDR {h.steps.cdr.ok ? "✓" : "✗"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </AppLayout>
  );
}
