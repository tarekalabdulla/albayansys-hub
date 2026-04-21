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
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  RefreshCw, Save, Loader2, CheckCircle2, XCircle, MinusCircle, Clock,
  Server, KeyRound, Webhook as WebhookIcon, Shield, History, ShieldCheck,
} from "lucide-react";

// ---------------- Types ----------------
type ServiceStatus = "connected" | "failed" | "disabled" | "idle";

interface ConfigEnvelope {
  config: {
    pbxIp?: string;
    baseUrl?: string;
    clientId?: string;
    clientIdIsSet?: boolean;
    clientSecretIsSet?: boolean;
    webhookSecretIsSet?: boolean;
    allowedIps?: string[];
    enabled?: boolean;
    lastSyncAt?: string;
    lastSyncOk?: boolean;
  };
  env: {
    baseUrl: string | null;
    clientIdSet: boolean;
    clientSecretSet: boolean;
    webhookTokenSet: boolean;
    webhookSecretSet: boolean;
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
export default function Yeastar() {
  const { toast } = useToast();
  const [data, setData]       = useState<ConfigEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [history, setHistory] = useState<SyncReport[]>([]);

  // form state (يعكس DB)
  const [form, setForm] = useState({
    enabled: true,
    pbxIp: "",
    baseUrl: "",
    clientId: "",
    clientSecret: "",
    webhookSecret: "",
    allowedIpsText: "",
  });

  async function load() {
    try {
      const [{ data: cfg }, { data: hist }] = await Promise.all([
        api.get<ConfigEnvelope>("/yeastar/config"),
        api.get<{ items: SyncReport[] }>("/yeastar/sync/history"),
      ]);
      setData(cfg);
      setHistory(hist.items || []);
      const c = cfg.config || {};
      setForm((p) => ({
        ...p,
        enabled: c.enabled !== false,
        pbxIp: c.pbxIp || "",
        baseUrl: c.baseUrl || cfg.env.baseUrl || "",
        clientId: c.clientId || "",
        clientSecret: "",
        webhookSecret: "",
        allowedIpsText: (c.allowedIps?.length ? c.allowedIps : cfg.env.allowedIps).join(", "),
      }));
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

  async function onSave() {
    setSaving(true);
    try {
      const allowedIps = form.allowedIpsText
        .split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
      await api.put("/yeastar/config", {
        enabled: form.enabled,
        pbxIp: form.pbxIp.trim(),
        baseUrl: form.baseUrl.trim(),
        clientId: form.clientId.trim(),
        ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
        ...(form.webhookSecret ? { webhookSecret: form.webhookSecret } : {}),
        allowedIps,
      });
      toast({ title: "تم الحفظ", description: "تم تحديث إعدادات Yeastar." });
      setForm((p) => ({ ...p, clientSecret: "", webhookSecret: "" }));
      load();
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

  const status = data ? deriveStatus(data) : null;
  const c = data?.config || {};

  return (
    <AppLayout title="إعدادات Yeastar PBX" subtitle="تكامل LAN آمن مع زر تحديث موحّد">
      {loading && !data ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">

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

          {/* ====== نموذج الإعدادات ====== */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-primary" />
                إعدادات الاتصال
              </h2>
              <div className="flex items-center gap-2">
                <Label htmlFor="enabled" className="text-sm">مُفعَّل</Label>
                <Switch id="enabled" checked={form.enabled}
                        onCheckedChange={(v) => setForm((p) => ({ ...p, enabled: v }))} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="pbxIp" className="text-xs">PBX IP الداخلي (LAN)</Label>
                <Input id="pbxIp" placeholder="192.168.1.10" dir="ltr"
                       value={form.pbxIp}
                       onChange={(e) => setForm((p) => ({ ...p, pbxIp: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground mt-1">يستخدم للعرض والتوثيق فقط</p>
              </div>
              <div>
                <Label htmlFor="baseUrl" className="text-xs">Base URL لـ Open API</Label>
                <Input id="baseUrl" placeholder="https://192.168.1.10:8088" dir="ltr"
                       value={form.baseUrl}
                       onChange={(e) => setForm((p) => ({ ...p, baseUrl: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {data?.env.baseUrl ? `الافتراضي من .env: ${data.env.baseUrl}` : "يُستخدم لطلب التوكن واستدعاء CDR"}
                </p>
              </div>

              <div>
                <Label htmlFor="clientId" className="text-xs">Client ID</Label>
                <Input id="clientId" dir="ltr" placeholder="من Yeastar Open API"
                       value={form.clientId}
                       onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value }))} />
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
                <Input id="clientSecret" dir="ltr" type="password" placeholder="••••••••  (اتركه فارغاً للإبقاء)"
                       value={form.clientSecret}
                       onChange={(e) => setForm((p) => ({ ...p, clientSecret: e.target.value }))} />
              </div>

              <div>
                <Label htmlFor="webhookSecret" className="text-xs flex items-center gap-2">
                  Webhook HMAC Secret
                  {(c.webhookSecretIsSet || data?.env.webhookSecretSet) && (
                    <Badge variant="outline" className="bg-success/15 text-success border-success/30 text-[10px]">
                      مضبوط
                    </Badge>
                  )}
                </Label>
                <Input id="webhookSecret" dir="ltr" type="password" placeholder="••••••••  (اتركه فارغاً للإبقاء)"
                       value={form.webhookSecret}
                       onChange={(e) => setForm((p) => ({ ...p, webhookSecret: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground mt-1">يُستخدم للتحقق من توقيع X-Yeastar-Signature</p>
              </div>
              <div>
                <Label htmlFor="allowedIps" className="text-xs flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5" /> IP Restriction (مسموح بها)
                </Label>
                <Input id="allowedIps" dir="ltr"
                       placeholder="192.168.1.10, 10.0.0.5"
                       value={form.allowedIpsText}
                       onChange={(e) => setForm((p) => ({ ...p, allowedIpsText: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground mt-1">
                  افصلها بفواصل. اتركها فارغة للسماح بالكل (غير موصى به).
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="w-4 h-4 text-success" />
                <span>الأسرار تُخزَّن في DB فقط ولا تُرسَل للواجهة. تُجدَّد التوكنات تلقائياً قبل انتهائها.</span>
              </div>
              <Button onClick={onSave} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
              </Button>
            </div>
          </Card>

          {/* ====== Webhook reference ====== */}
          <Card className="p-5">
            <h3 className="font-semibold text-foreground flex items-center gap-2 mb-3">
              <WebhookIcon className="w-5 h-5 text-primary" />
              مسار Webhook الداخلي
            </h3>
            <div className="rounded-lg bg-muted/40 border border-border/50 p-3 font-mono text-xs break-all" dir="ltr">
              POST /api/yeastar/webhook/call-event/{"{TOKEN}"}
            </div>
            <ul className="text-xs text-muted-foreground mt-3 space-y-1 list-disc pr-5">
              <li>التوكن يُحقَّق من URL، والتوقيع HMAC من رأس <code>X-Yeastar-Signature</code>.</li>
              <li>الأحداث المدعومة: 30008/30009/30011/30012/30013/30014/30025/30026/30029/30033.</li>
              <li>السجلّ يُكتب في <code>pbx_events</code> مع <code>unique_key</code> لمنع التكرار.</li>
            </ul>
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
