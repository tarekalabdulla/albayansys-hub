import { useEffect, useRef, useState } from "react";
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
  UserPlus, Pencil, Trash2, Webhook, Database, Download,
  Save, Shield, Sparkles, KeyRound, Loader2,
  RotateCcw, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Swal from "sweetalert2";
import {
  usersApi, settingsApi, adminApi, isRealApi,
  type ApiUser, type UserRole, type SettingsKey, type BackupFile,
} from "@/lib/dataApi";
import { CsvImportButton } from "@/components/CsvImportButton";
import { USERS_TEMPLATE_HEADERS, USERS_TEMPLATE_SAMPLE } from "@/lib/csvImport";

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "مدير النظام",
  supervisor: "مشرف",
  agent: "موظف",
};
const ROLE_BADGE: Record<UserRole, string> = {
  admin: "bg-destructive/15 text-destructive border-destructive/30",
  supervisor: "bg-primary/15 text-primary border-primary/30",
  agent: "bg-info/15 text-info border-info/30",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const getUserSaveError = (error: any) => {
  const code = error?.response?.data?.error;
  const fieldErrors = error?.response?.data?.details?.fieldErrors;

  if (code === "duplicate") return "البريد أو المعرّف أو رقم التحويلة مستخدم بالفعل.";

  if (code === "invalid_input") {
    const messages = [
      ...(fieldErrors?.name?.length ? ["الاسم مطلوب"] : []),
      ...(fieldErrors?.email?.length ? ["البريد غير صحيح"] : []),
      ...(fieldErrors?.password?.length ? ["كلمة المرور يجب أن تكون 6 أحرف على الأقل"] : []),
      ...(fieldErrors?.role?.length ? ["اختر دورًا صحيحًا"] : []),
      ...(fieldErrors?.ext?.length ? ["رقم التحويلة غير صحيح"] : []),
    ];

    return messages.length ? messages.join(" — ") : "تأكد من البيانات المُدخَلة.";
  }

  if (code === "server_error") {
    return "فشل الحفظ من السيرفر. غالبًا قاعدة البيانات على الـ VPS تحتاج تشغيل migration الأخير.";
  }

  return code || error?.message || "حدث خطأ غير متوقع.";
};

const Settings = () => {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ApiUser | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "", email: "", ext: "", role: "agent" as UserRole, active: true, password: "",
  });

  // Settings state (يُحمَّل من DB)
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [googleAi, setGoogleAi] = useState({ enabled: false, model: "gemini-1.5-pro", apiKey: "" });
  const [webhook, setWebhook] = useState({ url: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  // ===== تحميل أولي =====
  useEffect(() => {
    if (!isRealApi) {
      setLoadingUsers(false);
      setSettingsLoading(false);
      return;
    }
    (async () => {
      try {
        const [u, s] = await Promise.all([usersApi.list(), settingsApi.getAll()]);
        setUsers(u);
        if (s.google_ai) setGoogleAi((p) => ({ ...p, ...(s.google_ai as any) }));
        if (s.webhook) setWebhook((p) => ({ ...p, ...(s.webhook as any) }));
      } catch (e: any) {
        Swal.fire({ icon: "error", title: "تعذّر التحميل", text: e?.response?.data?.error || e.message });
      } finally {
        setLoadingUsers(false);
        setSettingsLoading(false);
      }
    })();
  }, []);

  // ===== Users CRUD =====
  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", email: "", ext: "", role: "agent", active: true, password: "" });
    setOpen(true);
  };
  const openEdit = (u: ApiUser) => {
    setEditing(u);
    setForm({ name: u.name, email: u.email || "", ext: u.ext || "", role: u.role, active: u.active, password: "" });
    setOpen(true);
  };

  const submit = async () => {
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    const ext = form.ext.trim();

    if (!name) {
      Swal.fire({ icon: "warning", title: "الاسم مطلوب" });
      return;
    }
    // البريد اختياري — لكن لو أُدخل يجب أن يكون صحيحاً
    if (email && !EMAIL_REGEX.test(email)) {
      Swal.fire({ icon: "warning", title: "بريد غير صحيح", text: "أدخل بريدًا إلكترونيًا بصيغة صحيحة أو اتركه فارغًا." });
      return;
    }
    // عند الإنشاء يجب وجود طريقة لتسجيل الدخول: بريد أو تحويلة
    if (!editing && !email && !ext) {
      Swal.fire({ icon: "warning", title: "البريد أو التحويلة مطلوبان", text: "يلزم أحدهما لتسجيل الدخول." });
      return;
    }
    if (!editing && form.password.length < 6) {
      Swal.fire({ icon: "warning", title: "كلمة مرور ضعيفة", text: "6 أحرف على الأقل." });
      return;
    }
    if (editing && form.password && form.password.length < 6) {
      Swal.fire({ icon: "warning", title: "كلمة مرور ضعيفة", text: "إذا أردت تغييرها يجب أن تكون 6 أحرف على الأقل." });
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        const updated = await usersApi.update(editing.id, {
          name,
          email: email || null,
          ext: ext || null,
          role: form.role,
          active: form.active,
          ...(form.password ? { password: form.password } : {}),
        });
        setUsers((p) => p.map((u) => (u.id === editing.id ? updated : u)));
        Swal.fire({ icon: "success", title: "تم التعديل", timer: 1500, showConfirmButton: false });
      } else {
        const created = await usersApi.create({
          name,
          ...(email ? { email } : {}),
          ...(ext ? { ext } : {}),
          password: form.password,
          role: form.role,
          active: form.active,
        });
        setUsers((p) => [created, ...p]);
        Swal.fire({ icon: "success", title: "تم إضافة المستخدم", timer: 1500, showConfirmButton: false });
      }
      setOpen(false);
    } catch (e: any) {
      Swal.fire({
        icon: "error",
        title: "فشل الحفظ",
        text: getUserSaveError(e),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const remove = (u: ApiUser) => {
    Swal.fire({
      title: `حذف ${u.name}؟`,
      text: "لا يمكن التراجع عن هذا الإجراء.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "نعم، احذف",
      cancelButtonText: "إلغاء",
      confirmButtonColor: "hsl(0 78% 56%)",
    }).then(async (r) => {
      if (!r.isConfirmed) return;
      try {
        await usersApi.remove(u.id);
        setUsers((p) => p.filter((x) => x.id !== u.id));
        Swal.fire({ icon: "success", title: "تم الحذف", timer: 1200, showConfirmButton: false });
      } catch (e: any) {
        Swal.fire({ icon: "error", title: "تعذّر الحذف", text: e?.response?.data?.error || e.message });
      }
    });
  };

  const toggleActive = async (u: ApiUser) => {
    try {
      const updated = await usersApi.update(u.id, { active: !u.active });
      setUsers((p) => p.map((x) => (x.id === u.id ? updated : x)));
    } catch (e: any) {
      Swal.fire({ icon: "error", title: "فشل التحديث", text: e?.response?.data?.error || e.message });
    }
  };

  // ===== Settings save =====
  const persist = async (key: SettingsKey, value: Record<string, unknown>, label: string) => {
    try {
      await settingsApi.save(key, value);
      Swal.fire({ icon: "success", title: `تم حفظ ${label}`, timer: 1600, showConfirmButton: false });
    } catch (e: any) {
      Swal.fire({ icon: "error", title: "فشل الحفظ", text: e?.response?.data?.error || e.message });
    }
  };

  const saveGoogleAi = () => {
    if (googleAi.enabled && !googleAi.apiKey.trim() && !(googleAi as any).apiKeyIsSet) {
      Swal.fire({ icon: "warning", title: "المفتاح مطلوب" });
      return;
    }
    const payload: Record<string, unknown> = { enabled: googleAi.enabled, model: googleAi.model };
    if (googleAi.apiKey) payload.apiKey = googleAi.apiKey;
    persist("google_ai", payload, "Google AI");
  };
  const saveWebhook = () => persist("webhook", { url: webhook.url }, "Webhook");

  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  // نسخة احتياطية كاملة (المستخدمون + المشرفون + الموظفون + المكالمات + التسجيلات + الإعدادات...)
  const exportFullBackup = async () => {
    try {
      setBackupBusy(true);
      const payload = await adminApi.backup();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `hulul-albayan-backup-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      const totals = Object.entries(payload.counts || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      Swal.fire({ icon: "success", title: "تم تنزيل النسخة الاحتياطية", text: totals, timer: 3000 });
    } catch (e: any) {
      Swal.fire({ icon: "error", title: "فشل النسخ الاحتياطي", text: e?.response?.data?.message || e.message });
    } finally {
      setBackupBusy(false);
    }
  };

  const triggerRestorePick = () => restoreInputRef.current?.click();

  const onRestoreFile = async (file: File | null) => {
    if (!file) return;
    let backup: BackupFile;
    try {
      const text = await file.text();
      backup = JSON.parse(text);
      if (!backup?.data || typeof backup.data !== "object") {
        throw new Error("ملف غير صالح: يجب أن يحوي حقل data");
      }
    } catch (e: any) {
      Swal.fire({ icon: "error", title: "ملف نسخة احتياطية غير صالح", text: e.message });
      if (restoreInputRef.current) restoreInputRef.current.value = "";
      return;
    }

    const choice = await Swal.fire({
      icon: "question",
      title: "وضع الاستعادة",
      html:
        "<b>دمج</b>: يضيف فقط الصفوف غير الموجودة (آمن).<br/>" +
        "<b>استبدال</b>: يحذف بياناتك الحالية ويستعيد كل شيء (خطير).",
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: "دمج",
      denyButtonText: "استبدال كامل",
      cancelButtonText: "إلغاء",
      confirmButtonColor: "hsl(var(--primary))",
      denyButtonColor: "hsl(0 78% 56%)",
    });
    if (choice.isDismissed) {
      if (restoreInputRef.current) restoreInputRef.current.value = "";
      return;
    }
    const mode: "merge" | "replace" = choice.isDenied ? "replace" : "merge";

    if (mode === "replace") {
      const confirm = await Swal.fire({
        icon: "warning",
        title: "تأكيد الاستبدال",
        text: "سيتم حذف كل البيانات الحالية واستبدالها. لا يمكن التراجع.",
        showCancelButton: true,
        confirmButtonText: "نعم، استبدل",
        cancelButtonText: "إلغاء",
        confirmButtonColor: "hsl(0 78% 56%)",
      });
      if (!confirm.isConfirmed) {
        if (restoreInputRef.current) restoreInputRef.current.value = "";
        return;
      }
    }

    try {
      setRestoreBusy(true);
      const report = await adminApi.restore(backup, mode);
      const restored = Object.entries(report.restored || {})
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}: ${n}`)
        .join("\n") || "لا جديد";
      Swal.fire({
        icon: "success",
        title: "تمت الاستعادة",
        text: `الوضع: ${mode === "merge" ? "دمج" : "استبدال"}\n${restored}`,
      });
      // أعِد تحميل المستخدمين والإعدادات لتعكس التغييرات
      try {
        const [u, s] = await Promise.all([usersApi.list(), settingsApi.getAll()]);
        setUsers(u);
        if (s.google_ai) setGoogleAi((p) => ({ ...p, ...(s.google_ai as any) }));
        if (s.webhook) setWebhook((p) => ({ ...p, ...(s.webhook as any) }));
      } catch { /* ignore */ }
    } catch (e: any) {
      Swal.fire({ icon: "error", title: "فشل الاستعادة", text: e?.response?.data?.message || e.message });
    } finally {
      setRestoreBusy(false);
      if (restoreInputRef.current) restoreInputRef.current.value = "";
    }
  };

  const resetSystem = async () => {
    const choice = await Swal.fire({
      icon: "warning",
      title: "تصفير النظام",
      html:
        "اختر نطاق التصفير:<br/><br/>" +
        "<b>البيانات فقط</b>: يحذف المكالمات والتسجيلات والإحصائيات والتنبيهات والبريد. <br/>" +
        "<b>كل شيء</b>: يحذف أيضاً الموظفين والمشرفين وكل المستخدمين عدا حسابك.",
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: "البيانات فقط",
      denyButtonText: "كل شيء",
      cancelButtonText: "إلغاء",
      confirmButtonColor: "hsl(var(--primary))",
      denyButtonColor: "hsl(0 78% 56%)",
    });
    if (choice.isDismissed) return;
    const scope: "data" | "all" = choice.isDenied ? "all" : "data";

    const confirm = await Swal.fire({
      icon: "warning",
      title: scope === "all" ? "تأكيد التصفير الشامل" : "تأكيد تصفير البيانات",
      input: "text",
      inputLabel: 'اكتب RESET للتأكيد',
      inputPlaceholder: "RESET",
      showCancelButton: true,
      confirmButtonText: "نعم، صفِّر الآن",
      cancelButtonText: "إلغاء",
      confirmButtonColor: "hsl(0 78% 56%)",
      preConfirm: (val) => {
        if (val !== "RESET") {
          Swal.showValidationMessage("اكتب RESET بالأحرف الكبيرة");
          return false;
        }
        return true;
      },
    });
    if (!confirm.isConfirmed) return;

    try {
      setResetBusy(true);
      const report = await adminApi.reset(scope);
      const lines = Object.entries(report.deleted || {})
        .map(([k, n]) => `${k}: ${n}`)
        .join("\n");
      Swal.fire({ icon: "success", title: "تم التصفير", text: lines || "لا يوجد ما يحذف" });
      if (scope === "all") {
        try { setUsers(await usersApi.list()); } catch { /* ignore */ }
      }
    } catch (e: any) {
      Swal.fire({ icon: "error", title: "فشل التصفير", text: e?.response?.data?.message || e.message });
    } finally {
      setResetBusy(false);
    }
  };

  if (!isRealApi) {
    return (
      <AppLayout title="الإعدادات">
        <div className="glass-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            هذه الصفحة تتطلب الاتصال بـ API الحقيقي. فعّل <code className="bg-muted px-1 rounded">VITE_USE_REAL_API=true</code> في ملف .env
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="الإعدادات والمستخدمين" subtitle="إدارة الصلاحيات وإعدادات النظام">
      {/* Users Table */}
      <section className="glass-card overflow-hidden mb-6">
        <div className="flex items-center justify-between p-5 border-b border-border/60 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <div>
              <h3 className="text-base font-bold">إدارة المستخدمين والصلاحيات</h3>
              <p className="text-xs text-muted-foreground">{users.length} مستخدم</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <CsvImportButton
              label="موظف"
              requiredHeaders={["name", "email"]}
              templateHeaders={USERS_TEMPLATE_HEADERS}
              templateSample={USERS_TEMPLATE_SAMPLE}
              templateFileName="users-template.csv"
              onImport={async (rows, opts) => usersApi.bulkCreate(rows, { duplicateMode: opts.duplicateMode })}
              onSuccess={async () => {
                try { setUsers(await usersApi.list()); } catch { /* ignore */ }
              }}
            />
            <Button onClick={openAdd} className="gradient-primary text-primary-foreground">
              <UserPlus className="w-4 h-4 ml-2" /> إضافة مستخدم
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          {loadingUsers ? (
            <div className="p-10 text-center text-muted-foreground">
              <Loader2 className="w-6 h-6 mx-auto animate-spin mb-2" />
              جاري التحميل...
            </div>
          ) : (
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
                          {u.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
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
                {users.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-10 text-muted-foreground text-sm">لا يوجد مستخدمون.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Google AI */}
        <section className="glass-card p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-base font-bold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Google AI
            </h3>
            <Switch checked={googleAi.enabled} onCheckedChange={(v) => setGoogleAi({ ...googleAi, enabled: v })} />
          </div>
          <p className="text-xs text-muted-foreground mb-5">مفتاح Gemini للتحليلات الذكية.</p>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block flex items-center gap-1.5">
                <KeyRound className="w-3 h-3" /> API Key {(googleAi as any).apiKeyIsSet && <span className="text-success">(محفوظ)</span>}
              </label>
              <Input value={googleAi.apiKey} onChange={(e) => setGoogleAi({ ...googleAi, apiKey: e.target.value })} type="password" dir="ltr" placeholder={(googleAi as any).apiKeyIsSet ? "اتركه فارغًا للإبقاء" : "AIza..."} className="bg-background/60" disabled={!googleAi.enabled} />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">النموذج</label>
              <Select value={googleAi.model} onValueChange={(v) => setGoogleAi({ ...googleAi, model: v })} disabled={!googleAi.enabled}>
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
                <Webhook className="w-3 h-3" /> Webhook URL
              </label>
              <div className="flex gap-2">
                <Input value={webhook.url} onChange={(e) => setWebhook({ url: e.target.value })} dir="ltr" className="bg-background/60" />
                <Button variant="outline" onClick={saveWebhook}>حفظ</Button>
              </div>
            </div>
            <Button onClick={saveGoogleAi} className="w-full gradient-primary text-primary-foreground">
              <Save className="w-4 h-4 ml-2" /> حفظ إعدادات Google AI
            </Button>
          </div>
        </section>

        {/* Backup / Restore / Reset */}
        <section className="glass-card p-5">
          <h3 className="text-base font-bold flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" /> النسخ الاحتياطي والاستعادة
          </h3>
          <p className="text-xs text-muted-foreground mb-5">
            صدّر نسخة كاملة (مستخدمون، مشرفون، موظفون، مكالمات، تسجيلات، إعدادات) أو استعدها لاحقاً.
          </p>

          <input
            ref={restoreInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => onRestoreFile(e.target.files?.[0] || null)}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <button
              onClick={exportFullBackup}
              disabled={backupBusy}
              className="p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/60 transition group bg-background/40 disabled:opacity-60"
            >
              {backupBusy
                ? <Loader2 className="w-6 h-6 mx-auto mb-2 text-primary animate-spin" />
                : <Download className="w-6 h-6 mx-auto mb-2 text-primary group-hover:scale-110 transition" />}
              <p className="text-sm font-bold">نسخة احتياطية</p>
              <p className="text-[11px] text-muted-foreground">تنزيل JSON كامل</p>
            </button>

            <button
              onClick={triggerRestorePick}
              disabled={restoreBusy}
              className="p-4 rounded-xl border-2 border-dashed border-border hover:border-success/60 transition group bg-background/40 disabled:opacity-60"
            >
              {restoreBusy
                ? <Loader2 className="w-6 h-6 mx-auto mb-2 text-success animate-spin" />
                : <RotateCcw className="w-6 h-6 mx-auto mb-2 text-success group-hover:scale-110 transition" />}
              <p className="text-sm font-bold">استعادة من ملف</p>
              <p className="text-[11px] text-muted-foreground">دمج أو استبدال كامل</p>
            </button>
          </div>

          <button
            onClick={resetSystem}
            disabled={resetBusy}
            className="w-full p-4 rounded-xl border-2 border-dashed border-destructive/40 hover:border-destructive transition group bg-destructive/5 disabled:opacity-60"
          >
            {resetBusy
              ? <Loader2 className="w-6 h-6 mx-auto mb-2 text-destructive animate-spin" />
              : <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-destructive group-hover:scale-110 transition" />}
            <p className="text-sm font-bold text-destructive">تصفير النظام</p>
            <p className="text-[11px] text-muted-foreground">حذف المكالمات والتسجيلات والإحصائيات</p>
          </button>
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
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="أحمد العتيبي" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block">
                البريد الإلكتروني <span className="text-muted-foreground font-normal">(اختياري)</span>
              </label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" dir="ltr" placeholder="user@hb.sa" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block">
                رقم التحويلة <span className="text-muted-foreground font-normal">(اختياري — يُستخدم للدخول إن لم يوجد بريد)</span>
              </label>
              <Input value={form.ext} onChange={(e) => setForm({ ...form, ext: e.target.value })} dir="ltr" placeholder="1001" inputMode="numeric" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block">
                كلمة المرور {editing && <span className="text-muted-foreground">(اتركها فارغة للإبقاء)</span>}
              </label>
              <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} type="password" dir="ltr" placeholder="6 أحرف على الأقل" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block">الدور</label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as UserRole })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">مدير النظام</SelectItem>
                  <SelectItem value="supervisor">مشرف</SelectItem>
                  <SelectItem value="agent">موظف</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40">
              <span className="text-sm font-medium">حساب نشط</span>
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
            <Button onClick={submit} className="gradient-primary text-primary-foreground" disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              {editing ? "حفظ التعديلات" : "إضافة المستخدم"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Settings;
