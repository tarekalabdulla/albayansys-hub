import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { USE_REAL_API } from "@/lib/config";
import {
  getSession,
  setSession,
  fetchProfileViaApi,
  updateProfileViaApi,
  changePasswordViaApi,
  uploadAvatarViaApi,
  deleteAvatarViaApi,
  resolveAvatarUrl,
  ROLE_LABELS,
  type Role,
} from "@/lib/auth";
import {
  User,
  KeyRound,
  Phone,
  ListChecks,
  Mail,
  ShieldCheck,
  Save,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  CheckCircle2,
  Camera,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRef } from "react";

interface ProfileData {
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

const PROFILE_KEY = "callcenter:profile";
const TASKS_KEY = "callcenter:profile:tasks";

const defaultProfile: ProfileData = {
  name: "",
  email: "",
  ext: "",
  role: "",
  department: "",
  phone: "",
  bio: "",
};

const defaultTasks: Task[] = [
  { id: "t1", text: "مراجعة تقرير الأداء الأسبوعي", done: false, priority: "عاجل" },
  { id: "t2", text: "اعتماد جدول استراحات الفريق", done: true, priority: "عادي" },
  { id: "t3", text: "متابعة شكاوى تجاوز SLA", done: false, priority: "عاجل" },
  { id: "t4", text: "تدريب الموظف الجديد على نظام Yeastar", done: false, priority: "منخفض" },
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

  const [profile, setProfile] = useState<ProfileData>(() => {
    const local = load<Partial<ProfileData>>(PROFILE_KEY, {});
    return {
      ...defaultProfile,
      ...local,
      name: session?.displayName || local.name || session?.identifier || "",
      role: session ? ROLE_LABELS[session.role as Role] : (local.role || ""),
    };
  });

  // جلب الملف الشخصي من الخادم عند فتح الصفحة
  useEffect(() => {
    const s = getSession();
    if (s?.displayName) {
      setProfile((p) => ({ ...p, name: s.displayName!, role: ROLE_LABELS[s.role] }));
    }
    if (!USE_REAL_API) return;
    (async () => {
      try {
        const u = await fetchProfileViaApi();
        setProfile((p) => ({
          ...p,
          name: u.display_name || u.identifier,
          email: u.email || "",
          ext: u.ext || "",
          department: u.department || "",
          phone: u.phone || "",
          bio: u.bio || "",
          role: u.job_title || ROLE_LABELS[u.role],
        }));
        setAvatarUrl(u.avatar_url ?? undefined);
        // زامن مع الـ session
        const cur = getSession();
        if (cur) setSession(cur.identifier, cur.role, u.display_name ?? cur.displayName, u.avatar_url ?? undefined);
      } catch {
        /* ignore — fallback to local */
      }
    })();
  }, []);

  const [tasks, setTasks] = useState<Task[]>(() => load(TASKS_KEY, defaultTasks));
  const [newTask, setNewTask] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(() => session?.avatarUrl);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  const initials = (profile.name || "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);

  const onPickAvatar = () => fileInputRef.current?.click();

  const onAvatarSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!USE_REAL_API) {
      toast({ title: "وضع تجريبي", description: "رفع الصورة يعمل فقط بعد ربط الخادم", variant: "destructive" });
      return;
    }
    if (!/^image\//.test(file.type)) {
      toast({ title: "نوع غير مدعوم", description: "اختر صورة (PNG/JPG/WEBP)", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "الحجم كبير", description: "الحد الأقصى 2 ميجابايت", variant: "destructive" });
      return;
    }
    setUploadingAvatar(true);
    try {
      const u = await uploadAvatarViaApi(file);
      setAvatarUrl(u.avatar_url ?? undefined);
      toast({ title: "تم الرفع", description: "تم تحديث صورتك الشخصية" });
    } catch (err: any) {
      const code = err?.response?.data?.error;
      toast({
        title: "تعذّر الرفع",
        description:
          code === "file_too_large" ? "الحجم أكبر من 2MB" :
          code === "invalid_file_type" ? "نوع الملف غير مسموح" :
          "خطأ في الاتصال بالخادم",
        variant: "destructive",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    if (!USE_REAL_API || !avatarUrl) return;
    setUploadingAvatar(true);
    try {
      await deleteAvatarViaApi();
      setAvatarUrl(undefined);
      toast({ title: "تم الحذف", description: "تمت إزالة الصورة الشخصية" });
    } catch {
      toast({ title: "تعذّر الحذف", variant: "destructive" });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const saveProfile = async () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    if (USE_REAL_API) {
      setSavingProfile(true);
      try {
        await updateProfileViaApi({
          display_name: profile.name,
          email: profile.email,
          ext: profile.ext,
          department: profile.department,
          phone: profile.phone,
          bio: profile.bio,
          job_title: profile.role,
        });
        toast({ title: "تم الحفظ", description: "تم تحديث بياناتك على الخادم" });
      } catch (err: any) {
        const code = err?.response?.data?.error;
        toast({
          title: "تعذّر الحفظ",
          description:
            code === "email_taken"
              ? "هذا البريد مستخدم لحساب آخر"
              : code === "invalid_input"
              ? "تحقق من صحة الحقول (البريد، الأطوال...)"
              : "خطأ في الاتصال بالخادم",
          variant: "destructive",
        });
      } finally {
        setSavingProfile(false);
      }
      return;
    }
    toast({ title: "تم الحفظ", description: "تم تحديث بياناتك الشخصية" });
  };

  const changePassword = async () => {
    if (!oldPwd || !newPwd || !confirmPwd) {
      toast({
        title: "حقول ناقصة",
        description: "يرجى تعبئة جميع حقول كلمة المرور",
        variant: "destructive",
      });
      return;
    }
    if (newPwd.length < 8) {
      toast({
        title: "كلمة مرور ضعيفة",
        description: "يجب أن تكون 8 أحرف على الأقل",
        variant: "destructive",
      });
      return;
    }
    if (newPwd !== confirmPwd) {
      toast({
        title: "غير متطابقة",
        description: "كلمتا المرور الجديدتان غير متطابقتين",
        variant: "destructive",
      });
      return;
    }

    if (USE_REAL_API) {
      setSavingPwd(true);
      try {
        await changePasswordViaApi(oldPwd, newPwd);
        setOldPwd("");
        setNewPwd("");
        setConfirmPwd("");
        toast({ title: "تم التغيير", description: "تم تحديث كلمة المرور بنجاح" });
      } catch (err: any) {
        const code = err?.response?.data?.error;
        toast({
          title: "تعذّر التحديث",
          description:
            code === "wrong_current_password"
              ? "كلمة المرور الحالية غير صحيحة"
              : code === "invalid_input"
              ? "كلمة المرور الجديدة قصيرة جداً"
              : "خطأ في الاتصال بالخادم",
          variant: "destructive",
        });
      } finally {
        setSavingPwd(false);
      }
      return;
    }

    setOldPwd("");
    setNewPwd("");
    setConfirmPwd("");
    toast({
      title: "وضع تجريبي",
      description: "تغيير كلمة السر يعمل فقط بعد ربط الخادم",
    });
  };

  const persistTasks = (next: Task[]) => {
    setTasks(next);
    localStorage.setItem(TASKS_KEY, JSON.stringify(next));
  };

  const toggleTask = (id: string) => {
    persistTasks(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const addTask = () => {
    if (!newTask.trim()) return;
    persistTasks([
      ...tasks,
      {
        id: `t-${Date.now()}`,
        text: newTask.trim(),
        done: false,
        priority: "عادي",
      },
    ]);
    setNewTask("");
  };

  const removeTask = (id: string) => {
    persistTasks(tasks.filter((t) => t.id !== id));
  };

  const doneCount = tasks.filter((t) => t.done).length;
  const progress = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;

  const prioCls = (p: Task["priority"]) =>
    p === "عاجل"
      ? "bg-destructive/15 text-destructive border-destructive/30"
      : p === "عادي"
      ? "bg-info/15 text-info border-info/30"
      : "bg-muted text-muted-foreground border-border";

  return (
    <AppLayout title="الملف الشخصي" subtitle="معلوماتك وكلمة المرور والمهام">
      <div className="space-y-6">
        {/* Header card */}
        <Card className="overflow-hidden">
          <div className="h-24 gradient-primary" />
          <CardContent className="p-6 -mt-12">
            <div className="flex flex-col sm:flex-row sm:items-end gap-4">
              <div className="relative">
                <Avatar className="w-24 h-24 ring-4 ring-background shadow-elegant">
                  {avatarUrl && <AvatarImage src={resolveAvatarUrl(avatarUrl)} alt={profile.name} />}
                  <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-bold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <button
                  type="button"
                  onClick={onPickAvatar}
                  disabled={uploadingAvatar}
                  className="absolute -bottom-1 -left-1 w-9 h-9 rounded-full bg-primary text-primary-foreground grid place-items-center shadow-elegant ring-2 ring-background hover:scale-105 transition disabled:opacity-60"
                  aria-label="تغيير الصورة الشخصية"
                  title="تغيير الصورة الشخصية"
                >
                  {uploadingAvatar ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={onAvatarSelected}
                />
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={removeAvatar}
                    disabled={uploadingAvatar}
                    className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-destructive text-destructive-foreground grid place-items-center shadow-elegant ring-2 ring-background hover:scale-105 transition disabled:opacity-60"
                    aria-label="إزالة الصورة"
                    title="إزالة الصورة"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl font-extrabold">{profile.name}</h2>
                <p className="text-sm text-muted-foreground">{profile.role}</p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <Badge variant="outline" className="gap-1">
                    <Mail className="w-3 h-3" />
                    {profile.email}
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <Phone className="w-3 h-3" />
                    تحويلة {profile.ext}
                  </Badge>
                  <Badge variant="outline" className="gap-1 bg-success/10 text-success border-success/30">
                    <ShieldCheck className="w-3 h-3" />
                    {profile.department}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid w-full grid-cols-3 max-w-xl">
            <TabsTrigger value="info" className="gap-1.5">
              <User className="w-4 h-4" />
              المعلومات
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-1.5">
              <KeyRound className="w-4 h-4" />
              الأمان
            </TabsTrigger>
            <TabsTrigger value="tasks" className="gap-1.5">
              <ListChecks className="w-4 h-4" />
              المهام
            </TabsTrigger>
          </TabsList>

          {/* INFO */}
          <TabsContent value="info" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">البيانات الشخصية</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>الاسم الكامل</Label>
                    <Input
                      value={profile.name}
                      onChange={(e) =>
                        setProfile({ ...profile, name: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>البريد الإلكتروني</Label>
                    <Input
                      type="email"
                      value={profile.email}
                      onChange={(e) =>
                        setProfile({ ...profile, email: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5" />
                      التحويلة الداخلية
                    </Label>
                    <Input
                      value={profile.ext}
                      onChange={(e) =>
                        setProfile({ ...profile, ext: e.target.value })
                      }
                      placeholder="1001"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>رقم الجوال</Label>
                    <Input
                      value={profile.phone}
                      onChange={(e) =>
                        setProfile({ ...profile, phone: e.target.value })
                      }
                      dir="ltr"
                      className="text-right"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>الدور الوظيفي</Label>
                    <Input
                      value={profile.role}
                      onChange={(e) =>
                        setProfile({ ...profile, role: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>القسم</Label>
                    <Input
                      value={profile.department}
                      onChange={(e) =>
                        setProfile({ ...profile, department: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>نبذة</Label>
                  <Textarea
                    value={profile.bio}
                    onChange={(e) =>
                      setProfile({ ...profile, bio: e.target.value })
                    }
                    rows={3}
                  />
                </div>
                <div className="flex justify-end">
                  <Button onClick={saveProfile} disabled={savingProfile} className="gap-1.5">
                    <Save className="w-4 h-4" />
                    {savingProfile ? "جاري الحفظ..." : "حفظ التغييرات"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SECURITY */}
          <TabsContent value="security" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">تغيير كلمة المرور</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 max-w-md">
                <div className="space-y-1.5">
                  <Label>كلمة المرور الحالية</Label>
                  <div className="relative">
                    <Input
                      type={showPwd ? "text" : "password"}
                      value={oldPwd}
                      onChange={(e) => setOldPwd(e.target.value)}
                      className="pl-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((v) => !v)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>كلمة المرور الجديدة</Label>
                  <Input
                    type={showPwd ? "text" : "password"}
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    8 أحرف على الأقل، يُفضل خليط من الأرقام والرموز.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>تأكيد كلمة المرور</Label>
                  <Input
                    type={showPwd ? "text" : "password"}
                    value={confirmPwd}
                    onChange={(e) => setConfirmPwd(e.target.value)}
                  />
                </div>
                <div className="flex justify-end pt-2">
                  <Button onClick={changePassword} disabled={savingPwd} className="gap-1.5">
                    <KeyRound className="w-4 h-4" />
                    {savingPwd ? "جاري التحديث..." : "تحديث كلمة المرور"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TASKS */}
          <TabsContent value="tasks" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">قائمة مهامك</CardTitle>
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    {doneCount}/{tasks.length} • {progress}%
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Progress bar */}
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full gradient-primary transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                {/* Add */}
                <div className="flex gap-2">
                  <Input
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addTask()}
                    placeholder="أضف مهمة جديدة..."
                  />
                  <Button onClick={addTask} className="gap-1.5 shrink-0">
                    <Plus className="w-4 h-4" />
                    إضافة
                  </Button>
                </div>

                {/* List */}
                <div className="rounded-lg border border-border divide-y divide-border">
                  {tasks.map((t) => (
                    <div
                      key={t.id}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 transition-colors",
                        t.done && "bg-muted/30",
                      )}
                    >
                      <Checkbox
                        checked={t.done}
                        onCheckedChange={() => toggleTask(t.id)}
                      />
                      <span
                        className={cn(
                          "flex-1 text-sm",
                          t.done && "line-through text-muted-foreground",
                        )}
                      >
                        {t.text}
                      </span>
                      <Badge variant="outline" className={cn("text-[10px] h-5", prioCls(t.priority))}>
                        {t.priority}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTask(t.id)}
                        className="h-7 w-7 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                  {tasks.length === 0 && (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      لا توجد مهام حالياً
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
