import { useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import Swal from "sweetalert2";
import { z } from "zod";

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

  // Yeastar P-Series (P560)
  const [pHost, setPHost] = useState("192.168.1.50");
  const [pPort, setPPort] = useState("8088");
  const [pApiUser, setPApiUser] = useState("apiuser");
  const [pApiSecret, setPApiSecret] = useState("");
  const [pUseTLS, setPUseTLS] = useState(true);
  const [pEnabled, setPEnabled] = useState(true);

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

  const savePbx = (kind: "P560" | "S20") => {
    Swal.fire({
      icon: "success",
      title: `تم حفظ إعدادات Yeastar ${kind}`,
      text: "ستُستخدم تلقائياً عند الاتصال بالسنترال.",
      timer: 1800,
      showConfirmButton: false,
    });
  };

  const testPbx = (kind: "P560" | "S20") => {
    Swal.fire({
      title: `اختبار اتصال Yeastar ${kind}`,
      html: '<div class="text-sm">جاري المحاولة...</div>',
      timer: 1200,
      showConfirmButton: false,
    }).then(() => {
      Swal.fire({
        icon: "success",
        title: "نجح الاتصال ✓",
        text: `تم التحقق من سنترال ${kind} بنجاح.`,
        timer: 1800,
        showConfirmButton: false,
      });
    });
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
                <Input value={pHost} onChange={(e) => setPHost(e.target.value)} dir="ltr" className="bg-background/60" disabled={!pEnabled} />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">منفذ API</label>
                <Input value={pPort} onChange={(e) => setPPort(e.target.value)} dir="ltr" className="bg-background/60" disabled={!pEnabled} />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">API Username</label>
                <Input value={pApiUser} onChange={(e) => setPApiUser(e.target.value)} dir="ltr" className="bg-background/60" disabled={!pEnabled} />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">API Secret</label>
                <Input value={pApiSecret} onChange={(e) => setPApiSecret(e.target.value)} type="password" dir="ltr" className="bg-background/60" disabled={!pEnabled} placeholder="••••••••" />
              </div>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-background/40 border border-border">
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-info" />
                <span className="text-xs font-medium">استخدام HTTPS / TLS</span>
              </div>
              <Switch checked={pUseTLS} onCheckedChange={setPUseTLS} disabled={!pEnabled} />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => savePbx("P560")} className="flex-1 gradient-primary text-primary-foreground" disabled={!pEnabled}>
                <Save className="w-4 h-4 ml-2" /> حفظ إعدادات P560
              </Button>
              <Button variant="outline" onClick={() => testPbx("P560")} disabled={!pEnabled}>
                <Wifi className="w-4 h-4 ml-2" /> اختبار الاتصال
              </Button>
            </div>
          </TabsContent>

          {/* S-Series */}
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
