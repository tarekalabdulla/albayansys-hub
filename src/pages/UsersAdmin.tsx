import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { USE_REAL_API } from "@/lib/config";
import { ROLE_LABELS, getSession, resolveAvatarUrl, setSession, type Role } from "@/lib/auth";
import {
  listUsers, createUser, updateUser, deleteUser,
  uploadUserAvatar, deleteUserAvatar,
  type ManagedUser, type CreateUserPayload,
} from "@/lib/usersApi";
import {
  UserPlus, Pencil, Trash2, Search, ShieldAlert, Users as UsersIcon, Loader2, Camera,
} from "lucide-react";

const ROLE_BADGE: Record<Role, string> = {
  admin:      "bg-destructive/15 text-destructive border-destructive/30",
  supervisor: "bg-warning/15 text-warning border-warning/30",
  agent:      "bg-info/15 text-info border-info/30",
};

const EMPTY_FORM: CreateUserPayload = {
  identifier: "",
  password: "",
  role: "agent",
  display_name: "",
  email: "",
  ext: "",
  department: "",
  phone: "",
  job_title: "",
  is_active: true,
};

export default function UsersAdmin() {
  const { toast } = useToast();
  const session = getSession();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // dialog state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState<CreateUserPayload & { newPassword?: string }>(EMPTY_FORM);

  // delete confirm
  const [toDelete, setToDelete] = useState<ManagedUser | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listUsers();
      setUsers(data);
    } catch (err: any) {
      toast({
        title: "تعذّر التحميل",
        description: err?.response?.data?.error || "خطأ في الاتصال",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (USE_REAL_API) load();
    else setLoading(false);
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const openEdit = (u: ManagedUser) => {
    setEditing(u);
    setForm({
      identifier: u.identifier,
      password: "",
      role: u.role,
      display_name: u.display_name || "",
      email: u.email || "",
      ext: u.ext || "",
      department: u.department || "",
      phone: u.phone || "",
      job_title: u.job_title || "",
      is_active: u.is_active,
    });
    setOpen(true);
  };

  const errMsg = (code?: string) => {
    switch (code) {
      case "identifier_taken":   return "اسم الدخول مستخدم مسبقاً";
      case "duplicate_value":    return "قيمة مكررة (ربما البريد)";
      case "cannot_demote_self": return "لا يمكن تخفيض دور حسابك";
      case "cannot_disable_self":return "لا يمكن تعطيل حسابك";
      case "cannot_delete_self": return "لا يمكن حذف حسابك";
      case "invalid_input":      return "تحقّق من صحة الحقول";
      default:                   return "خطأ في الاتصال بالخادم";
    }
  };

  const submit = async () => {
    if (!form.identifier.trim() || !form.display_name.trim()) {
      toast({ title: "حقول ناقصة", description: "اسم الدخول والاسم الكامل مطلوبان", variant: "destructive" });
      return;
    }
    if (!editing && form.password.length < 6) {
      toast({ title: "كلمة سر قصيرة", description: "6 أحرف على الأقل", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        const payload: any = {
          role: form.role,
          display_name: form.display_name,
          email: form.email,
          ext: form.ext,
          department: form.department,
          phone: form.phone,
          job_title: form.job_title,
          is_active: form.is_active,
        };
        if (form.password && form.password.length >= 6) payload.password = form.password;
        await updateUser(editing.id, payload);
        toast({ title: "تم التحديث", description: form.display_name });
      } else {
        await createUser(form);
        toast({ title: "تم الإنشاء", description: form.display_name });
      }
      setOpen(false);
      await load();
    } catch (err: any) {
      toast({
        title: "تعذّر الحفظ",
        description: errMsg(err?.response?.data?.error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteUser(toDelete.id);
      toast({ title: "تم الحذف", description: toDelete.display_name || toDelete.identifier });
      setToDelete(null);
      await load();
    } catch (err: any) {
      toast({
        title: "تعذّر الحذف",
        description: errMsg(err?.response?.data?.error),
        variant: "destructive",
      });
    }
  };

  const filtered = users.filter((u) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      u.identifier.toLowerCase().includes(s) ||
      (u.display_name || "").toLowerCase().includes(s) ||
      (u.email || "").toLowerCase().includes(s) ||
      (u.department || "").toLowerCase().includes(s)
    );
  });

  // إذا الـ API غير مفعّل
  if (!USE_REAL_API) {
    return (
      <AppLayout title="إدارة المستخدمين" subtitle="إنشاء وتعديل وحذف الحسابات">
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <ShieldAlert className="w-12 h-12 mx-auto text-warning" />
            <h3 className="text-lg font-bold">يحتاج اتصال بالخادم</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              صفحة إدارة المستخدمين تعمل فقط في وضع API الحقيقي.
              فعّل <code className="px-1 bg-muted rounded">VITE_USE_REAL_API=true</code> ثم أعد البناء.
            </p>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="إدارة المستخدمين" subtitle="إنشاء وتعديل وحذف حسابات النظام">
      <div className="space-y-4">
        {/* Toolbar */}
        <Card>
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بالاسم أو اسم الدخول أو البريد..."
                className="pr-10"
              />
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <UsersIcon className="w-3 h-3" />
                {filtered.length} / {users.length}
              </Badge>
              <Button onClick={openCreate} className="gap-1.5">
                <UserPlus className="w-4 h-4" />
                إضافة مستخدم
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">قائمة المستخدمين</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="py-16 grid place-items-center text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">الاسم</TableHead>
                      <TableHead className="text-right">اسم الدخول</TableHead>
                      <TableHead className="text-right">الدور</TableHead>
                      <TableHead className="text-right">البريد</TableHead>
                      <TableHead className="text-right">القسم</TableHead>
                      <TableHead className="text-right">التحويلة</TableHead>
                      <TableHead className="text-right">الحالة</TableHead>
                      <TableHead className="text-right">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">
                          لا توجد نتائج
                        </TableCell>
                      </TableRow>
                    )}
                    {filtered.map((u) => {
                      const isMe = u.id === session?.identifier || u.identifier === session?.identifier;
                      return (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">
                            {u.display_name || "—"}
                            {isMe && <Badge variant="secondary" className="mr-2 text-[10px]">أنت</Badge>}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{u.identifier}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={ROLE_BADGE[u.role]}>
                              {ROLE_LABELS[u.role]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground" dir="ltr">
                            {u.email || "—"}
                          </TableCell>
                          <TableCell className="text-xs">{u.department || "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{u.ext || "—"}</TableCell>
                          <TableCell>
                            {u.is_active ? (
                              <Badge className="bg-success/15 text-success border-success/30" variant="outline">
                                نشط
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-muted text-muted-foreground">
                                معطّل
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openEdit(u)}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setToDelete(u)}
                                disabled={isMe}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل مستخدم" : "إضافة مستخدم جديد"}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div className="space-y-1.5">
              <Label>اسم الدخول *</Label>
              <Input
                value={form.identifier}
                onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                disabled={!!editing}
                placeholder="admin / 1001"
                dir="ltr"
                className="text-right"
              />
            </div>
            <div className="space-y-1.5">
              <Label>الاسم الكامل *</Label>
              <Input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>الدور *</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm({ ...form, role: v as Role })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
                  <SelectItem value="supervisor">{ROLE_LABELS.supervisor}</SelectItem>
                  <SelectItem value="agent">{ROLE_LABELS.agent}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{editing ? "كلمة سر جديدة (اختياري)" : "كلمة السر *"}</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={editing ? "اتركها فارغة للإبقاء" : "6 أحرف على الأقل"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>البريد الإلكتروني</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                dir="ltr"
                className="text-right"
              />
            </div>
            <div className="space-y-1.5">
              <Label>التحويلة</Label>
              <Input
                value={form.ext}
                onChange={(e) => setForm({ ...form, ext: e.target.value })}
                dir="ltr"
                className="text-right"
              />
            </div>
            <div className="space-y-1.5">
              <Label>القسم</Label>
              <Input
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>المسمّى الوظيفي</Label>
              <Input
                value={form.job_title}
                onChange={(e) => setForm({ ...form, job_title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>رقم الجوال</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                dir="ltr"
                className="text-right"
              />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-border sm:col-span-1">
              <div>
                <Label className="text-sm">حساب نشط</Label>
                <p className="text-[11px] text-muted-foreground">يستطيع تسجيل الدخول</p>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={submit} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editing ? "حفظ التغييرات" : "إنشاء"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف المستخدم <strong>{toDelete?.display_name || toDelete?.identifier}</strong> نهائياً.
              لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
