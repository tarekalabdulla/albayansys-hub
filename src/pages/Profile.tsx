import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  User, KeyRound, Phone, ListChecks, Mail, ShieldCheck, Save,
  Eye, EyeOff, Plus, Trash2, CheckCircle2, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { usersApi, isRealApi } from "@/lib/dataApi";
import { getSession, setSession } from "@/lib/auth";

interface ProfileData {
  id: string;
  name: string;
  email: string;
  ext: string;
  role: string;
  department: string;
  phone: string;
  bio: string;
}

interface Task {
  id: string;
  text: string;
  done: boolean;
  priority: "عاجل" | "عادي" | "منخفض";
}

const TASKS_KEY = "callcenter:profile:tasks";

const defaultTasks: Task[] = [
  { id: "t1", text: "مراجعة تقرير الأداء الأسبوعي", done: false, priority: "عاجل" },
  { id: "t2", text: "اعتماد جدول استراحات الفريق", done: true, priority: "عادي" },
];

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {}
  return fallback;
}

export default function Profile() {
  const { toast } = useToast();
  const session = getSession();

  const [profile, setProfile] = useState<ProfileData>({
    id: "",
    name: session?.displayName || "",
    email: "",
    ext: "",
    role: session?.role || "",
    department: "",
    phone: "",
    bio: "",
  });
  const [loading, setLoading] = useState(isRealApi);
  const [saving, setSaving] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);

  const [tasks, setTasks] = useState<Task[]>(() => load(TASKS_KEY, defaultTasks));
  const [newTask, setNewTask] = useState("");

  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  // ====== تحميل من API ======
  useEffect(() => {
    if (!isRealApi) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { data } = await api.get("/auth/me");
        const u = data.user;
        setProfile({
          id: u.id,
          name: u.display_name || u.name || u.identifier,
          email: u.email || "",
          ext: u.ext || "",
          role: u.role || "",
          department: u.department || "",
          phone: u.phone || "",
          bio: u.bio || "",
        });
      } catch (e: any) {
        toast({ title: "تعذّر تحميل الملف", description: e?.response?.data?.error || e.message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  const initials = profile.name.split(" ").map((p) => p[0]).join("").slice(0, 2);

  const saveProfile = async () => {
    if (!isRealApi) {
      toast({ title: "وضع تجريبي", description: "تفعيل API الحقيقي مطلوب للحفظ.", variant: "destructive" });
      return;
    }

    const trimmedName = profile.name.trim();
    const trimmedEmail = profile.email.trim();

    if (!profile.id) {
      toast({ title: "فشل الحفظ", description: "تعذر تحديد المستخدم الحالي", variant: "destructive" });
      return;
    }

    if (!trimmedName) {
      toast({ title: "فشل الحفظ", description: "الاسم الكامل مطلوب", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      await usersApi.update(profile.id, {
        name: trimmedName,
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
        phone: profile.phone.trim() || null,
        department: profile.department.trim() || null,
        ext: profile.ext.trim() || null,
        bio: profile.bio.trim() || null,
      });
      if (session) setSession(session.identifier, session.role, trimmedName);
      toast({ title: "تم الحفظ", description: "تم تحديث بياناتك الشخصية" });
    } catch (e: any) {
      const code = e?.response?.data?.error;
      toast({
        title: "فشل الحفظ",
        description: code === "invalid_input" ? "تأكد من الاسم والبريد الإلكتروني بصيغة صحيحة" : (code || e.message),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (!oldPwd || !newPwd || !confirmPwd) {
      toast({ title: "حقول ناقصة", description: "يرجى تعبئة جميع الحقول", variant: "destructive" });
      return;
    }
    if (newPwd.length < 6) {
      toast({ title: "كلمة مرور ضعيفة", description: "6 أحرف على الأقل", variant: "destructive" });
      return;
    }
    if (newPwd !== confirmPwd) {
      toast({ title: "غير متطابقة", description: "كلمتا المرور غير متطابقتين", variant: "destructive" });
      return;
    }
    setChangingPwd(true);
    try {
      await usersApi.changePassword(oldPwd, newPwd);
      setOldPwd(""); setNewPwd(""); setConfirmPwd("");
      toast({ title: "تم التغيير", description: "تم تحديث كلمة المرور بنجاح" });
    } catch (e: any) {
      const code = e?.response?.data?.error;
      toast({
        title: "فشل التغيير",
        description: code === "wrong_old_password" ? "كلمة المرور الحالية غير صحيحة" : (code || e.message),
        variant: "destructive",
      });
    } finally {
      setChangingPwd(false);
    }
  };

  const persistTasks = (next: Task[]) => {
    setTasks(next);
    localStorage.setItem(TASKS_KEY, JSON.stringify(next));
  };
  const toggleTask = (id: string) => persistTasks(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const addTask = () => {
    if (!newTask.trim()) return;
    persistTasks([...tasks, { id: `t-${Date.now()}`, text: newTask.trim(), done: false, priority: "عادي" }]);
    setNewTask("");
  };
  const removeTask = (id: string) => persistTasks(tasks.filter((t) => t.id !== id));

  const doneCount = tasks.filter((t) => t.done).length;
  const progress = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
  const prioCls = (p: Task["priority"]) =>
    p === "عاجل" ? "bg-destructive/15 text-destructive border-destructive/30"
    : p === "عادي" ? "bg-info/15 text-info border-info/30"
    : "bg-muted text-muted-foreground border-border";

  if (loading) {
    return (
      <AppLayout title="الملف الشخصي">
        <div className="py-20 text-center text-muted-foreground">
          <Loader2 className="w-8 h-8 mx-auto animate-spin mb-2" /> جاري التحميل...
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="الملف الشخصي" subtitle="معلوماتك وكلمة المرور والمهام">
      <div className="space-y-6" dir="rtl">
        <Card className="overflow-hidden border-border/70 shadow-card">
          <div className="h-28 gradient-primary" />
          <CardContent className="-mt-14 p-6 sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <Avatar className="h-24 w-24 ring-4 ring-background shadow-elegant sm:h-28 sm:w-28">
                  <AvatarFallback className="bg-primary text-2xl font-bold text-primary-foreground">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 space-y-2 text-right">
                  <div>
                    <h2 className="text-2xl font-extrabold sm:text-3xl">{profile.name}</h2>
                    <p className="text-sm text-muted-foreground">{profile.role}</p>
                  </div>
                  <div className="flex flex-wrap justify-start gap-2">
                    {profile.email && <Badge variant="outline" className="gap-1"><Mail className="h-3 w-3" />{profile.email}</Badge>}
                    {profile.ext && <Badge variant="outline" className="gap-1"><Phone className="h-3 w-3" />تحويلة {profile.ext}</Badge>}
                    {profile.department && (
                      <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 text-success">
                        <ShieldCheck className="h-3 w-3" />{profile.department}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:min-w-72">
                <div className="rounded-lg border border-border/60 bg-background/70 p-3 text-right">
                  <p className="text-xs text-muted-foreground">التحويلة</p>
                  <p className="mt-1 text-lg font-bold">{profile.ext || "—"}</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/70 p-3 text-right">
                  <p className="text-xs text-muted-foreground">القسم</p>
                  <p className="mt-1 truncate text-lg font-bold">{profile.department || "—"}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid w-full max-w-2xl grid-cols-3">
            <TabsTrigger value="info" className="gap-1.5"><User className="w-4 h-4" />المعلومات</TabsTrigger>
            <TabsTrigger value="security" className="gap-1.5"><KeyRound className="w-4 h-4" />الأمان</TabsTrigger>
            <TabsTrigger value="tasks" className="gap-1.5"><ListChecks className="w-4 h-4" />المهام</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-4">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_minmax(0,0.85fr)]">
              <Card className="border-border/70 shadow-card">
                <CardHeader><CardTitle className="text-right text-base">البيانات الشخصية</CardTitle></CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5 text-right">
                      <Label>الاسم الكامل</Label>
                      <Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} className="text-right" />
                    </div>
                    <div className="space-y-1.5 text-right">
                      <Label>البريد الإلكتروني</Label>
                      <Input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} dir="ltr" className="text-right" />
                    </div>
                    <div className="space-y-1.5 text-right">
                      <Label className="flex items-center justify-end gap-1.5"><Phone className="h-3.5 w-3.5" />التحويلة الداخلية</Label>
                      <Input value={profile.ext} onChange={(e) => setProfile({ ...profile, ext: e.target.value })} placeholder="1001" className="text-right" />
                    </div>
                    <div className="space-y-1.5 text-right">
                      <Label>رقم الجوال</Label>
                      <Input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} dir="ltr" className="text-right" />
                    </div>
                    <div className="space-y-1.5 text-right sm:col-span-2">
                      <Label>القسم</Label>
                      <Input value={profile.department} onChange={(e) => setProfile({ ...profile, department: e.target.value })} className="text-right" />
                    </div>
                  </div>
                  <div className="space-y-1.5 text-right">
                    <Label>نبذة</Label>
                    <Textarea value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} rows={4} className="text-right" />
                  </div>
                  <div className="flex justify-start">
                    <Button onClick={saveProfile} className="gap-1.5" disabled={saving}>
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      حفظ التغييرات
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/70 shadow-card">
                <CardHeader><CardTitle className="text-right text-base">ملخص سريع</CardTitle></CardHeader>
                <CardContent className="space-y-4 text-right">
                  <div className="rounded-lg border border-border/60 bg-background/70 p-4">
                    <p className="text-xs text-muted-foreground">الدور</p>
                    <p className="mt-1 font-bold">{profile.role || "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background/70 p-4">
                    <p className="text-xs text-muted-foreground">البريد</p>
                    <p className="mt-1 break-all font-bold">{profile.email || "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background/70 p-4">
                    <p className="text-xs text-muted-foreground">الجوال</p>
                    <p className="mt-1 font-bold" dir="ltr">{profile.phone || "—"}</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="security" className="mt-4">
            <Card className="border-border/70 shadow-card">
              <CardHeader><CardTitle className="text-right text-base">تغيير كلمة المرور</CardTitle></CardHeader>
              <CardContent className="max-w-md space-y-4 text-right">
                <div className="space-y-1.5">
                  <Label>كلمة المرور الحالية</Label>
                  <div className="relative">
                    <Input type={showPwd ? "text" : "password"} value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} className="pr-10 text-right" />
                    <button type="button" onClick={() => setShowPwd((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>كلمة المرور الجديدة</Label>
                  <Input type={showPwd ? "text" : "password"} value={newPwd} onChange={(e) => setNewPwd(e.target.value)} className="text-right" />
                  <p className="text-[10px] text-muted-foreground">6 أحرف على الأقل.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>تأكيد كلمة المرور</Label>
                  <Input type={showPwd ? "text" : "password"} value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} className="text-right" />
                </div>
                <div className="flex justify-start pt-2">
                  <Button onClick={changePassword} className="gap-1.5" disabled={changingPwd}>
                    {changingPwd ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                    تحديث كلمة المرور
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tasks" className="mt-4">
            <Card className="border-border/70 shadow-card">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">قائمة مهامك</CardTitle>
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle2 className="w-3 h-3" />{doneCount}/{tasks.length} • {progress}%
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full gradient-primary transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex gap-2">
                  <Input value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} placeholder="أضف مهمة..." className="text-right" />
                  <Button onClick={addTask} className="shrink-0 gap-1.5"><Plus className="w-4 h-4" />إضافة</Button>
                </div>
                <div className="divide-y divide-border rounded-lg border border-border">
                  {tasks.map((t) => (
                    <div key={t.id} className={cn("flex items-center gap-3 px-3 py-2.5", t.done && "bg-muted/30")}>
                      <Button variant="ghost" size="icon" onClick={() => removeTask(t.id)} className="h-7 w-7 text-destructive hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                      <Badge variant="outline" className={cn("h-5 text-[10px]", prioCls(t.priority))}>{t.priority}</Badge>
                      <span className={cn("flex-1 text-right text-sm", t.done && "line-through text-muted-foreground")}>{t.text}</span>
                      <Checkbox checked={t.done} onCheckedChange={() => toggleTask(t.id)} />
                    </div>
                  ))}
                  {tasks.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">لا توجد مهام</div>}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
