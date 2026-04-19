import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UserPlus,
  Pencil,
  Trash2,
  Server,
  Webhook,
  Database,
  Download,
  Upload,
  Save,
  Shield,
  Sparkles,
  PhoneCall,
  Wifi,
  KeyRound,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import Swal from "sweetalert2";
import { z } from "zod";
import { USE_REAL_API, API_URL } from "@/lib/config";
import { getPbxSettings, updatePbxSettings, testPbxConnection, type PbxSettings } from "@/lib/pbxApi";
import { YeastarWebhookCard } from "@/components/settings/YeastarWebhookCard";
import { adminApi, type ResetScope } from "@/lib/adminApi";
import { getRole } from "@/lib/auth";
import { Trash } from "lucide-react";

type Role = "admin" | "supervisor" | "agent" | "viewer";

// ===== مخطط التحقق لاستيراد JSON (zod) =====
// يمنع استبدال بيانات التطبيق ببيانات مشوّهة أو خبيثة من ملف غير موثوق.
const ROLE_VALUES = ["admin", "supervisor", "agent", "viewer"] as const;

const userSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  role: z.enum(ROLE_VALUES),
  active: z.boolean(),
});

// مضيف: IP أو hostname بسيط — يمنع روابط/مخططات غير متوقعة (SSRF).
const hostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-zA-Z0-9.\-_]+$/, "host غير صالح");

const portSchema = z
  .string()
  .trim()
  .regex(/^\d{1,5}$/, "port غير صالح");

// رابط webhook: https فقط
const httpsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((u) => u.startsWith("https://"), "يجب أن يبدأ الرابط بـ https://");

const importSchema = z.object({
  users: z.array(userSchema).max(1000).optional(),
  pbx: z
    .object({
      pSeries: z
        .object({ host: hostSchema.optional(), port: portSchema.optional() })
        .optional(),
      sSeries: z
        .object({ host: hostSchema.optional() }).optional(),
    })
    .optional(),
  webhook: z.object({ url: httpsUrlSchema.optional() }).optional(),
});

interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
}

const ROLE_LABEL: Record<Role, string> = {
  admin: "مدير النظام",
  supervisor: "مشرف",
  agent: "موظف",
  viewer: "مشاهد",
};

const ROLE_BADGE: Record<Role, string> = {
  admin: "bg-destructive/15 text-destructive border-destructive/30",
  supervisor: "bg-primary/15 text-primary border-primary/30",
  agent: "bg-info/15 text-info border-info/30",
  viewer: "bg-muted text-muted-foreground border-border",
};

const INITIAL_USERS: User[] = [
  { id: "u1", name: "سلمان العامر", email: "salman@hb.sa", role: "admin", active: true },
  { id: "u2", name: "منى الشهري",   email: "mona@hb.sa",   role: "supervisor", active: true },
  { id: "u3", name: "بدر القحطاني", email: "badr@hb.sa",   role: "supervisor", active: true },
  { id: "u4", name: "ريم الحربي",   email: "reem@hb.sa",   role: "agent",      active: true },
  { id: "u5", name: "فهد التركي",   email: "fahad@hb.sa",  role: "viewer",     active: false },
];

const Settings = () => {
  const [users, setUsers] = useState<User[]>(INITIAL_USERS);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<Omit<User, "id">>({
    name: "", email: "", role: "agent", active: true,
  });

  // Yeastar P-Series (P560) — مرتبط بالخادم لو USE_REAL_API
  const [pHost, setPHost] = useState("192.168.1.50");
  const [pPort, setPPort] = useState("8088");
  const [pApiUser, setPApiUser] = useState("apiuser");
  const [pApiSecret, setPApiSecret] = useState("");
  const [pUseTLS, setPUseTLS] = useState(true);
  const [pEnabled, setPEnabled] = useState(true);
  const [pHasStoredSecret, setPHasStoredSecret] = useState(false);
  const [pHasWebhookSecret, setPHasWebhookSecret] = useState(false);
  const [pLastEventAt, setPLastEventAt] = useState<string | null>(null);
  const [pLastTest, setPLastTest] = useState<{ at: string | null; ok: boolean | null; msg: string | null }>({
    at: null, ok: null, msg: null,
  });
  const [pLoading, setPLoading] = useState(false);
  const [pSaving, setPSaving] = useState(false);
  const [pTesting, setPTesting] = useState(false);
  const pPublicWebhookUrl = `${API_URL}/api/pbx/webhook`;

  // Yeastar S-Series (S20)
  const [sHost, setSHost] = useState("192.168.1.60");
  const [sAmiPort, setSAmiPort] = useState("5038");
  const [sAmiUser, setSAmiUser] = useState("admin");
  const [sAmiSecret, setSAmiSecret] = useState("");
  const [sCdrUrl, setSCdrUrl] = useState("https://cdr.hb.sa/s20");
  const [sEnabled, setSEnabled] = useState(false);

  // Google AI
  const [googleAiKey, setGoogleAiKey] = useState("");
  const [googleAiModel, setGoogleAiModel] = useState("gemini-1.5-pro");
  const [googleAiEnabled, setGoogleAiEnabled] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState("https://hooks.hb.sa/calls");
  const [webhookSecret, setWebhookSecret] = useState("••••••••••");
  const fileRef = useRef<HTMLInputElement>(null);

  // ===== التصفير الشامل (admin فقط) =====
  const isAdmin = getRole() === "admin";
  const [resetScopes, setResetScopes] = useState<Record<ResetScope, boolean>>({
    calls: true,
    alerts: true,
    mail: true,
    supervisors: true,
    stats: true,
  });
  const [resetting, setResetting] = useState(false);

  const toggleScope = (s: ResetScope) =>
    setResetScopes((p) => ({ ...p, [s]: !p[s] }));

  const runResetAll = async () => {
    const selected = (Object.keys(resetScopes) as ResetScope[]).filter((k) => resetScopes[k]);
    if (selected.length === 0) {
      Swal.fire({ icon: "warning", title: "لم تختر شيئاً", text: "اختر نطاقاً واحداً على الأقل." });
      return;
    }
    const labels: Record<ResetScope, string> = {
      calls: "المكالمات و CDR",
      alerts: "التنبيهات",
      mail: "البريد الداخلي",
      supervisors: "المشرفون والربط بالفِرق",
      stats: "إحصائيات الموظفين (تصفير العدّادات)",
    };
    const r = await Swal.fire({
      icon: "warning",
      title: "تأكيد التصفير الشامل",
      html:
        `<div class="text-right text-sm leading-7">سيتم حذف نهائي للبيانات التالية:<br/>` +
        selected.map((s) => `• ${labels[s]}`).join("<br/>") +
        `<br/><br/><b class="text-destructive">لا يمكن التراجع عن هذا الإجراء.</b></div>`,
      input: "text",
      inputPlaceholder: 'اكتب RESET للتأكيد',
      showCancelButton: true,
      confirmButtonText: "نعم، صفّر الآن",
      cancelButtonText: "إلغاء",
      confirmButtonColor: "hsl(0 78% 56%)",
      preConfirm: (val) => {
        if (val !== "RESET") {
          Swal.showValidationMessage("اكتب كلمة RESET بالضبط");
          return false;
        }
        return true;
      },
    });
    if (!r.isConfirmed) return;

    if (!USE_REAL_API) {
      Swal.fire({ icon: "info", title: "وضع تجريبي", text: "التصفير يحتاج تفعيل API الحقيقي." });
      return;
    }

    setResetting(true);
    try {
      const out = await adminApi.resetAll(selected);
      const lines = Object.entries(out.summary)
        .map(([k, v]) => `• ${k}: ${v}`)
        .join("<br/>");
      await Swal.fire({
        icon: "success",
        title: "تم التصفير بنجاح",
        html: `<div class="text-right text-xs leading-6">${lines || "لم يُحذف شيء."}</div>`,
      });
    } catch (e: any) {
      Swal.fire({
        icon: "error",
        title: "فشل التصفير",
        text: e?.response?.data?.error || e?.message || "خطأ غير متوقع",
      });
    } finally {
      setResetting(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", email: "", role: "agent", active: true });
    setOpen(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    setForm({ name: u.name, email: u.email, role: u.role, active: u.active });
    setOpen(true);
  };

  const submit = () => {
    if (!form.name.trim() || !form.email.trim()) {
      Swal.fire({ icon: "warning", title: "الحقول مطلوبة", text: "يرجى تعبئة الاسم والبريد." });
      return;
    }
    if (editing) {
      setUsers((p) => p.map((u) => u.id === editing.id ? { ...editing, ...form } : u));
      Swal.fire({ icon: "success", title: "تم التعديل", timer: 1500, showConfirmButton: false });
    } else {
      const id = `u${Date.now()}`;
      setUsers((p) => [...p, { id, ...form }]);
      Swal.fire({ icon: "success", title: "تم إضافة المستخدم", timer: 1500, showConfirmButton: false });
    }
    setOpen(false);
  };

  const remove = (u: User) => {
    Swal.fire({
      title: `حذف ${u.name}؟`,
      text: "لا يمكن التراجع عن هذا الإجراء.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "نعم، احذف",
      cancelButtonText: "إلغاء",
      confirmButtonColor: "hsl(0 78% 56%)",
    }).then((r) => {
      if (r.isConfirmed) {
        setUsers((p) => p.filter((x) => x.id !== u.id));
        Swal.fire({ icon: "success", title: "تم الحذف", timer: 1200, showConfirmButton: false });
      }
    });
  };

  const toggleActive = (u: User) => {
    setUsers((p) => p.map((x) => x.id === u.id ? { ...x, active: !x.active } : x));
  };

  const exportJSON = () => {
    // ⚠️ لا نُصدِّر أي أسرار (API secrets، AMI secrets، webhook secrets، Google AI key).
    // كذلك نتفادى تصدير تفاصيل البنية التحتية الحسّاسة (المنافذ، أسماء المستخدمين، CDR URL).
    const data = {
      exportedAt: new Date().toISOString(),
      users: users.map((u) => ({
        id: u.id, name: u.name, email: u.email, role: u.role, active: u.active,
      })),
      pbx: {
        pSeries: { enabled: pEnabled, useTLS: pUseTLS },
        sSeries: { enabled: sEnabled },
      },
      googleAi: { enabled: googleAiEnabled, model: googleAiModel },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hulul-albayan-backup-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    Swal.fire({
      icon: "success",
      title: "تم تصدير النسخة الاحتياطية",
      text: "لم تُضمَّن الأسرار أو بيانات الاتصال بالسنترال لأسباب أمنية.",
      timer: 2200,
      showConfirmButton: false,
    });
  };

  const importJSON = async (file: File) => {
    // حد حجم الملف: 1MB لمنع DoS/abuse
    if (file.size > 1024 * 1024) {
      Swal.fire({ icon: "error", title: "الملف كبير جداً", text: "الحد الأقصى 1MB." });
      return;
    }
    let parsed: unknown;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch {
      Swal.fire({ icon: "error", title: "ملف غير صالح", text: "تعذّر قراءة JSON." });
      return;
    }
    const result = importSchema.safeParse(parsed);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      Swal.fire({
        icon: "error",
        title: "ملف الاستيراد غير صالح",
        text: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "البنية لا تطابق المخطط.",
      });
      return;
    }
    const data = result.data;
    if (data.users) setUsers(data.users as User[]);
    if (data.pbx?.pSeries?.host) setPHost(data.pbx.pSeries.host);
    if (data.pbx?.pSeries?.port) setPPort(data.pbx.pSeries.port);
    if (data.pbx?.sSeries?.host) setSHost(data.pbx.sSeries.host);
    if (data.webhook?.url) setWebhookUrl(data.webhook.url);
    Swal.fire({ icon: "success", title: "تم الاستيراد بنجاح", timer: 1800, showConfirmButton: false });
  };

  // ===== Yeastar P-Series — جلب من الخادم =====
  useEffect(() => {
    if (!USE_REAL_API) return;
    let alive = true;
    setPLoading(true);
    getPbxSettings()
      .then((s) => {
        if (!alive || !s) return;
        setPEnabled(!!s.enabled);
        if (s.host) setPHost(s.host);
        if (s.port) setPPort(String(s.port));
        setPUseTLS(!!s.use_tls);
        if (s.api_username) setPApiUser(s.api_username);
        setPHasStoredSecret(!!s.has_secret);
        setPHasWebhookSecret(!!s.has_webhook_secret);
        setPLastEventAt(s.last_event_at);
        setPLastTest({ at: s.last_test_at, ok: s.last_test_ok, msg: s.last_test_msg });
      })
      .catch(() => { /* ignore — اعرض الافتراضيات */ })
      .finally(() => { if (alive) setPLoading(false); });
    return () => { alive = false; };
  }, []);

  const savePbx = async (kind: "P560" | "S20") => {
    // S20 يبقى محلياً (لا يدعمه الخادم بعد)
    if (kind === "S20" || !USE_REAL_API) {
      Swal.fire({
        icon: "success",
        title: `تم حفظ إعدادات Yeastar ${kind}`,
        text: USE_REAL_API
          ? "ملاحظة: حفظ S-Series يتم محلياً فقط حالياً."
          : "ستُستخدم تلقائياً عند الاتصال بالسنترال.",
        timer: 1800,
        showConfirmButton: false,
      });
      return;
    }

    setPSaving(true);
    try {
      const port = parseInt(pPort, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error("منفذ غير صالح (1-65535)");
      }
      const payload: any = {
        enabled: pEnabled,
        host: pHost.trim(),
        port,
        use_tls: pUseTLS,
        api_username: pApiUser.trim(),
      };
      // أرسل السر فقط لو المستخدم كتبه (تجنّب مسح المحفوظ)
      if (pApiSecret.trim()) payload.api_secret = pApiSecret;

      const s = await updatePbxSettings(payload);
      setPHasStoredSecret(!!s.has_secret);
      setPApiSecret(""); // امسح الحقل للأمان
      Swal.fire({
        icon: "success",
        title: "تم حفظ إعدادات Yeastar P560",
        text: "تم تخزين الإعدادات بشكل مشفّر على الخادم.",
        timer: 1800,
        showConfirmButton: false,
      });
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "خطأ غير متوقع";
      Swal.fire({ icon: "error", title: "تعذّر الحفظ", text: msg });
    } finally {
      setPSaving(false);
    }
  };

  const clearStoredSecret = async () => {
    if (!USE_REAL_API) return;
    const r = await Swal.fire({
      icon: "warning",
      title: "مسح السر المحفوظ؟",
      text: "سيُحذف API Secret من الخادم نهائياً.",
      showCancelButton: true,
      confirmButtonText: "نعم، امسح",
      cancelButtonText: "إلغاء",
      confirmButtonColor: "hsl(0 78% 56%)",
    });
    if (!r.isConfirmed) return;
    try {
      const s = await updatePbxSettings({ clear_secret: true });
      setPHasStoredSecret(!!s.has_secret);
      Swal.fire({ icon: "success", title: "تم المسح", timer: 1200, showConfirmButton: false });
    } catch {
      Swal.fire({ icon: "error", title: "تعذّر المسح" });
    }
  };

  const testPbx = async (kind: "P560" | "S20") => {
    if (kind === "S20" || !USE_REAL_API) {
      Swal.fire({
        title: `اختبار اتصال Yeastar ${kind}`,
        html: '<div class="text-sm">جاري المحاولة...</div>',
        timer: 1200,
        showConfirmButton: false,
      }).then(() => {
        Swal.fire({
          icon: "success",
          title: "نجح الاتصال ✓",
          text: `تم التحقق من سنترال ${kind} بنجاح. (وضع تجريبي)`,
          timer: 1800,
          showConfirmButton: false,
        });
      });
      return;
    }

    setPTesting(true);
    Swal.fire({
      title: "اختبار اتصال Yeastar P560",
      html: '<div class="text-sm">جاري الاتصال بالسنترال...</div>',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });
    try {
      const port = parseInt(pPort, 10);
      const payload: any = {
        host: pHost.trim() || undefined,
        port: isNaN(port) ? undefined : port,
        use_tls: pUseTLS,
        api_username: pApiUser.trim() || undefined,
      };
      if (pApiSecret.trim()) payload.api_secret = pApiSecret;

      const r = await testPbxConnection(payload);
      // حدّث آخر اختبار في الواجهة
      setPLastTest({ at: new Date().toISOString(), ok: r.ok, msg: r.message });
      Swal.fire({
        icon: r.ok ? "success" : "error",
        title: r.ok ? "نجح الاتصال ✓" : "فشل الاتصال",
        text: `${r.message}${r.elapsed_ms ? ` (${r.elapsed_ms}ms)` : ""}`,
        timer: r.ok ? 2200 : undefined,
        showConfirmButton: !r.ok,
      });
    } finally {
      setPTesting(false);
    }
  };

  const saveGoogleAi = () => {
    if (googleAiEnabled && !googleAiKey.trim()) {
      Swal.fire({ icon: "warning", title: "المفتاح مطلوب", text: "يرجى إدخال Google AI API Key." });
      return;
    }
    Swal.fire({
      icon: "success",
      title: "تم حفظ إعدادات Google AI",
      text: googleAiEnabled ? `النموذج: ${googleAiModel}` : "تم تعطيل Google AI.",
      timer: 1800,
      showConfirmButton: false,
    });
  };

  return (
    <AppLayout title="الإعدادات والمستخدمين" subtitle="إدارة الصلاحيات وإعدادات النظام">
      {/* Users Table */}
      <section className="glass-card overflow-hidden mb-6">
        <div className="flex items-center justify-between p-5 border-b border-border/60 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <div>
              <h3 className="text-base font-bold">إدارة المستخدمين والصلاحيات</h3>
              <p className="text-xs text-muted-foreground">{users.length} مستخدم نشط</p>
            </div>
          </div>
          <Button onClick={openAdd} className="gradient-primary text-primary-foreground">
            <UserPlus className="w-4 h-4 ml-2" /> إضافة مستخدم
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-muted/50 text-xs font-bold text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-3">المستخدم</th>
                <th className="px-4 py-3">البريد</th>
                <th className="px-4 py-3">الدور</th>
                <th className="px-4 py-3">الحالة</th>
                <th className="px-4 py-3 text-left">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/50 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg gradient-primary grid place-items-center text-xs font-bold text-primary-foreground">
                        {u.name.split(" ").map(p => p[0]).join("").slice(0, 2)}
                      </div>
                      <p className="text-sm font-semibold">{u.name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground" dir="ltr">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-[10px] font-bold px-2 py-1 rounded-full border", ROLE_BADGE[u.role])}>
                      {ROLE_LABEL[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Switch checked={u.active} onCheckedChange={() => toggleActive(u)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(u)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => remove(u)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* PBX (Yeastar) Settings — Tabs */}
      <section className="glass-card p-5 mb-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-primary" />
            <div>
              <h3 className="text-base font-bold">إعدادات السنترال (Yeastar)</h3>
              <p className="text-xs text-muted-foreground">يدعم النظام نوعَي السنترال — اختر التبويب وأدخل بيانات الاتصال.</p>
            </div>
          </div>
        </div>

        <Tabs defaultValue="p560" dir="rtl" className="w-full">
          <TabsList className="grid grid-cols-2 w-full max-w-md mb-5">
            <TabsTrigger value="p560" className="gap-2">
              <Server className="w-3.5 h-3.5" /> Yeastar P560 (P-Series)
            </TabsTrigger>
            <TabsTrigger value="s20" className="gap-2">
              <Server className="w-3.5 h-3.5" /> Yeastar S20 (S-Series)
            </TabsTrigger>
          </TabsList>

          {/* P-Series */}
          <TabsContent value="p560" className="space-y-4 mt-0">
            <div className="flex flex-wrap items-center gap-2">
              {USE_REAL_API ? (
                <Badge variant="outline" className="bg-success/10 text-success border-success/30 text-[10px]">
                  مرتبط بالخادم
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-[10px]">
                  وضع تجريبي — فعّل API لحفظ الإعدادات
                </Badge>
              )}
              {pLoading && (
                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> جاري التحميل...
                </span>
              )}
              {pLastTest.at && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] gap-1",
                    pLastTest.ok
                      ? "bg-success/10 text-success border-success/30"
                      : "bg-destructive/10 text-destructive border-destructive/30",
                  )}
                  title={pLastTest.msg || ""}
                >
                  {pLastTest.ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  آخر اختبار: {pLastTest.ok ? "ناجح" : "فاشل"} — {new Date(pLastTest.at).toLocaleString("ar-SA")}
                </Badge>
              )}
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border">
              <div className="flex items-center gap-2">
                <CheckCircle2 className={cn("w-4 h-4", pEnabled ? "text-success" : "text-muted-foreground")} />
                <span className="text-sm font-medium">تفعيل سنترال P-Series</span>
              </div>
              <Switch checked={pEnabled} onCheckedChange={setPEnabled} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">عنوان IP / Host</label>
                <Input value={pHost} onChange={(e) => setPHost(e.target.value)} dir="ltr" className="bg-background/60" disabled={!pEnabled} placeholder="192.168.1.50" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">منفذ API</label>
                <Input value={pPort} onChange={(e) => setPPort(e.target.value)} dir="ltr" className="bg-background/60" disabled={!pEnabled} placeholder="8088" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">API Username</label>
                <Input value={pApiUser} onChange={(e) => setPApiUser(e.target.value)} dir="ltr" className="bg-background/60" disabled={!pEnabled} />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center justify-between">
                  <span>API Secret</span>
                  {pHasStoredSecret && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-success font-bold">
                      <KeyRound className="w-3 h-3" /> محفوظ ومشفّر
                    </span>
                  )}
                </label>
                <Input
                  value={pApiSecret}
                  onChange={(e) => setPApiSecret(e.target.value)}
                  type="password"
                  dir="ltr"
                  className="bg-background/60"
                  disabled={!pEnabled}
                  placeholder={pHasStoredSecret ? "اتركه فارغاً للإبقاء على المحفوظ" : "أدخل API Secret"}
                />
                {pHasStoredSecret && USE_REAL_API && (
                  <button
                    type="button"
                    onClick={clearStoredSecret}
                    className="mt-1 text-[10px] text-destructive hover:underline"
                  >
                    مسح السر المحفوظ
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-background/40 border border-border">
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-info" />
                <span className="text-xs font-medium">استخدام HTTPS / TLS</span>
              </div>
              <Switch checked={pUseTLS} onCheckedChange={setPUseTLS} disabled={!pEnabled} />
            </div>
            {USE_REAL_API && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-info/5 border border-info/20 text-[11px] text-muted-foreground">
                <AlertCircle className="w-3.5 h-3.5 text-info shrink-0 mt-0.5" />
                <span>
                  يتم إصدار التوكن عبر <code className="px-1 bg-muted rounded">POST /openapi/v1.0/get_token</code> من Yeastar P-Series.
                  تأكد من تفعيل Open API في لوحة Yeastar وإضافة IP الخادم للقائمة المسموحة.
                </span>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={() => savePbx("P560")} className="flex-1 gradient-primary text-primary-foreground" disabled={!pEnabled || pSaving}>
                {pSaving ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Save className="w-4 h-4 ml-2" />}
                {pSaving ? "جاري الحفظ..." : "حفظ إعدادات P560"}
              </Button>
              <Button variant="outline" onClick={() => testPbx("P560")} disabled={!pEnabled || pTesting}>
                {pTesting ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Wifi className="w-4 h-4 ml-2" />}
                {pTesting ? "جاري الاختبار..." : "اختبار الاتصال"}
              </Button>
            </div>

            {/* ============ Webhook للأحداث الحية ============ */}
            <YeastarWebhookCard
              hasSecret={pHasWebhookSecret}
              webhookUrl={pPublicWebhookUrl}
              lastEventAt={pLastEventAt}
              onChange={(s) => setPHasWebhookSecret(s)}
            />
          </TabsContent>
          <TabsContent value="s20" className="space-y-4 mt-0">
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border">
              <div className="flex items-center gap-2">
                <CheckCircle2 className={cn("w-4 h-4", sEnabled ? "text-success" : "text-muted-foreground")} />
                <span className="text-sm font-medium">تفعيل سنترال S-Series</span>
              </div>
              <Switch checked={sEnabled} onCheckedChange={setSEnabled} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">عنوان IP / Host</label>
                <Input value={sHost} onChange={(e) => setSHost(e.target.value)} dir="ltr" className="bg-background/60" disabled={!sEnabled} />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">منفذ AMI</label>
                <Input value={sAmiPort} onChange={(e) => setSAmiPort(e.target.value)} dir="ltr" className="bg-background/60" disabled={!sEnabled} />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">AMI Username</label>
                <Input value={sAmiUser} onChange={(e) => setSAmiUser(e.target.value)} dir="ltr" className="bg-background/60" disabled={!sEnabled} />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">AMI Secret</label>
                <Input value={sAmiSecret} onChange={(e) => setSAmiSecret(e.target.value)} type="password" dir="ltr" className="bg-background/60" disabled={!sEnabled} placeholder="••••••••" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block flex items-center gap-1.5">
                  <Webhook className="w-3 h-3" /> CDR Webhook URL
                </label>
                <Input value={sCdrUrl} onChange={(e) => setSCdrUrl(e.target.value)} dir="ltr" className="bg-background/60" disabled={!sEnabled} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => savePbx("S20")} className="flex-1 gradient-primary text-primary-foreground" disabled={!sEnabled}>
                <Save className="w-4 h-4 ml-2" /> حفظ إعدادات S20
              </Button>
              <Button variant="outline" onClick={() => testPbx("S20")} disabled={!sEnabled}>
                <Wifi className="w-4 h-4 ml-2" /> اختبار الاتصال
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Google AI Settings */}
        <section className="glass-card p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-base font-bold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> إعدادات Google AI
            </h3>
            <Switch checked={googleAiEnabled} onCheckedChange={setGoogleAiEnabled} />
          </div>
          <p className="text-xs text-muted-foreground mb-5">
            مفتاح Gemini لتفعيل التحليلات الذكية وملخصات المكالمات.
          </p>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block flex items-center gap-1.5">
                <KeyRound className="w-3 h-3" /> Google AI API Key
              </label>
              <Input
                value={googleAiKey}
                onChange={(e) => setGoogleAiKey(e.target.value)}
                type="password"
                dir="ltr"
                placeholder="AIza..."
                className="bg-background/60"
                disabled={!googleAiEnabled}
              />
              <p className="text-[11px] text-muted-foreground mt-1.5">
                احصل على المفتاح من{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-primary hover:underline" dir="ltr">
                  Google AI Studio
                </a>
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">النموذج</label>
              <Select value={googleAiModel} onValueChange={setGoogleAiModel} disabled={!googleAiEnabled}>
                <SelectTrigger className="bg-background/60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro</SelectItem>
                  <SelectItem value="gemini-1.5-flash">Gemini 1.5 Flash</SelectItem>
                  <SelectItem value="gemini-2.0-flash">Gemini 2.0 Flash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block flex items-center gap-1.5">
                <Webhook className="w-3 h-3" /> Webhook URL (اختياري)
              </label>
              <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} dir="ltr" className="bg-background/60" />
            </div>
            <Button onClick={saveGoogleAi} className="w-full gradient-primary text-primary-foreground">
              <Save className="w-4 h-4 ml-2" /> حفظ إعدادات Google AI
            </Button>
          </div>
        </section>

        {/* Backup */}
        <section className="glass-card p-5">
          <h3 className="text-base font-bold flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" /> النسخ الاحتياطي
          </h3>
          <p className="text-xs text-muted-foreground mb-5">تصدير واستيراد إعدادات النظام والمستخدمين بصيغة JSON.</p>
          <div className="space-y-3">
            <button
              onClick={exportJSON}
              className="w-full p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/60 transition group bg-background/40"
            >
              <Download className="w-6 h-6 mx-auto mb-2 text-primary group-hover:scale-110 transition" />
              <p className="text-sm font-bold">تصدير النسخة الاحتياطية</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">يُنزَّل ملف .json كامل</p>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/60 transition group bg-background/40"
            >
              <Upload className="w-6 h-6 mx-auto mb-2 text-primary group-hover:scale-110 transition" />
              <p className="text-sm font-bold">استيراد نسخة احتياطية</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">اختر ملف .json للاستعادة</p>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJSON(f);
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-2 p-3 rounded-lg bg-info/10 text-info text-xs">
              <Database className="w-4 h-4 shrink-0" />
              <span>آخر نسخة احتياطية: قبل ساعتين</span>
            </div>
          </div>
        </section>
      </div>

      {/* ============ التصفير الشامل (admin فقط) ============ */}
      {isAdmin && (
        <section className="glass-card p-5 mt-5 border-destructive/30">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
            <div className="flex items-center gap-2">
              <Trash className="w-4 h-4 text-destructive" />
              <div>
                <h3 className="text-base font-bold text-destructive">منطقة الخطر — تصفير شامل</h3>
                <p className="text-xs text-muted-foreground">
                  حذف نهائي للبيانات المختارة. لن تُحذف حسابات المستخدمين ولا إعدادات السنترال.
                </p>
              </div>
            </div>
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-[10px]">
              admin فقط
            </Badge>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 my-4">
            {([
              { key: "calls", label: "المكالمات و CDR" },
              { key: "alerts", label: "التنبيهات" },
              { key: "mail", label: "البريد الداخلي" },
              { key: "supervisors", label: "المشرفون والفِرق" },
              { key: "stats", label: "إحصائيات الموظفين" },
            ] as { key: ResetScope; label: string }[]).map((s) => (
              <label
                key={s.key}
                className={cn(
                  "flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition",
                  resetScopes[s.key]
                    ? "bg-destructive/5 border-destructive/40"
                    : "bg-background/40 border-border hover:border-destructive/30",
                )}
              >
                <Checkbox
                  checked={resetScopes[s.key]}
                  onCheckedChange={() => toggleScope(s.key)}
                />
                <span className="text-xs font-semibold">{s.label}</span>
              </label>
            ))}
          </div>

          <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/5 border border-destructive/20 text-[11px] text-muted-foreground mb-3">
            <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
            <span>
              سيُطلب منك كتابة <code className="px-1 bg-muted rounded">RESET</code> للتأكيد. الإجراء غير قابل للتراجع.
            </span>
          </div>

          <Button
            onClick={runResetAll}
            disabled={resetting}
            variant="destructive"
            className="w-full"
          >
            {resetting ? (
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
            ) : (
              <Trash className="w-4 h-4 ml-2" />
            )}
            {resetting ? "جاري التصفير..." : "تصفير شامل للنطاقات المحددة"}
          </Button>
        </section>
      )}

      {/* User Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل مستخدم" : "إضافة مستخدم جديد"}</DialogTitle>
            <DialogDescription>
              {editing ? "حدّث بيانات المستخدم وصلاحياته." : "أدخل بيانات المستخدم لمنحه صلاحيات الدخول."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-semibold mb-1.5 block">الاسم الكامل</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثال: أحمد العتيبي" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block">البريد الإلكتروني</label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" dir="ltr" placeholder="user@hb.sa" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block">الدور</label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">مدير النظام</SelectItem>
                  <SelectItem value="supervisor">مشرف</SelectItem>
                  <SelectItem value="agent">موظف</SelectItem>
                  <SelectItem value="viewer">مشاهد</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40">
              <span className="text-sm font-medium">حساب نشط</span>
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} className="gradient-primary text-primary-foreground">
              {editing ? "حفظ التعديلات" : "إضافة المستخدم"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Settings;
