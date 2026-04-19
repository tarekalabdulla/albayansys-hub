import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { type Agent } from "@/lib/mockData";
import { useLiveAgents } from "@/hooks/useLiveAgents";
import {
  UserCog,
  Users,
  Plus,
  Trash2,
  Pencil,
  Search,
  ShieldCheck,
  Phone,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supervisorsApi, type Supervisor } from "@/lib/supervisorsApi";
import { listUsers, type ManagedUser } from "@/lib/usersApi";

export default function Supervisors() {
  const { toast } = useToast();
  const AGENTS = useLiveAgents();
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Supervisor | null>(null);
  const [open, setOpen] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [list, us] = await Promise.all([
        supervisorsApi.list(),
        listUsers().catch(() => [] as ManagedUser[]),
      ]);
      setSupervisors(list);
      setUsers(us);
    } catch (e: any) {
      toast({
        title: "تعذر التحميل",
        description: e?.response?.data?.error || "فشل الاتصال بالخادم",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const filtered = useMemo(
    () =>
      supervisors.filter(
        (s) =>
          s.name.includes(search) ||
          s.email.includes(search) ||
          s.ext.includes(search),
      ),
    [supervisors, search],
  );

  const stats = useMemo(() => {
    const totalAgents = AGENTS.length;
    const assignedIds = new Set(supervisors.flatMap((s) => s.agentIds));
    return {
      supervisors: supervisors.length,
      assigned: assignedIds.size,
      unassigned: Math.max(0, totalAgents - assignedIds.size),
    };
  }, [supervisors, AGENTS]);

  const openNew = () => {
    setEditing({
      id: "",
      name: "",
      email: "",
      ext: "",
      role: "مشرف",
      userId: null,
      agentIds: [],
    });
    setOpen(true);
  };

  const openEdit = (s: Supervisor) => {
    setEditing({ ...s });
    setOpen(true);
  };

  const remove = async (id: string) => {
    try {
      await supervisorsApi.remove(id);
      setSupervisors((prev) => prev.filter((s) => s.id !== id));
      toast({ title: "تم الحذف", description: "تم حذف المشرف بنجاح" });
    } catch (e: any) {
      toast({
        title: "تعذر الحذف",
        description: e?.response?.data?.error || "حدث خطأ",
        variant: "destructive",
      });
    }
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.email.trim() || !editing.ext.trim()) {
      toast({
        title: "بيانات ناقصة",
        description: "الاسم والبريد والتحويلة مطلوبة",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const isUpdate = supervisors.some((s) => s.id === editing.id);
      const payload = {
        name: editing.name,
        email: editing.email,
        ext: editing.ext,
        role: editing.role,
        userId: editing.userId || null,
        agentIds: editing.agentIds,
      };
      if (isUpdate) {
        await supervisorsApi.update(editing.id, payload);
      } else {
        await supervisorsApi.create(payload);
      }
      await fetchAll();
      setOpen(false);
      toast({
        title: isUpdate ? "تم التحديث" : "تم الإضافة",
        description: `${editing.name} - ${editing.agentIds.length} موظف`,
      });
    } catch (e: any) {
      toast({
        title: "تعذر الحفظ",
        description:
          e?.response?.data?.message ||
          e?.response?.data?.error ||
          "حدث خطأ",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleAgent = (agentId: string) => {
    if (!editing) return;
    const has = editing.agentIds.includes(agentId);
    setEditing({
      ...editing,
      agentIds: has
        ? editing.agentIds.filter((x) => x !== agentId)
        : [...editing.agentIds, agentId],
    });
  };

  const getAgentsOf = (s: Supervisor): Agent[] =>
    AGENTS.filter((a) => s.agentIds.includes(a.id));

  return (
    <AppLayout title="إدارة المشرفين" subtitle="ربط المشرفين بفِرَق الموظفين">
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-primary/15 text-primary grid place-items-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">عدد المشرفين</p>
                <p className="text-2xl font-extrabold">{stats.supervisors}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-success/15 text-success grid place-items-center">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">موظفون مُعيّنون</p>
                <p className="text-2xl font-extrabold">{stats.assigned}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-warning/15 text-warning grid place-items-center">
                <UserCog className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">بدون إشراف</p>
                <p className="text-2xl font-extrabold">{stats.unassigned}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Toolbar */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">قائمة المشرفين</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث..."
                  className="pr-10 w-56"
                />
              </div>
              <Button onClick={openNew} className="gap-1.5">
                <Plus className="w-4 h-4" />
                مشرف جديد
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">المشرف</TableHead>
                    <TableHead className="text-right">الرتبة</TableHead>
                    <TableHead className="text-right">التحويلة</TableHead>
                    <TableHead className="text-right">الفريق</TableHead>
                    <TableHead className="text-right">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin inline" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((s) => {
                      const team = getAgentsOf(s);
                      return (
                        <TableRow key={s.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="w-9 h-9">
                                <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                                  {s.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <Link
                                  to={`/supervisors/${s.id}`}
                                  className="text-sm font-bold hover:text-primary hover:underline transition-colors"
                                >
                                  {s.name}
                                </Link>
                                <p className="text-[11px] text-muted-foreground">
                                  {s.email}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-info/10 text-info border-info/30">
                              {s.role}
                            </Badge>
                          </TableCell>
                          <TableCell className="tabular-nums font-mono text-sm">
                            <span className="inline-flex items-center gap-1">
                              <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                              {s.ext}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <div className="flex -space-x-2 -space-x-reverse">
                                {team.slice(0, 4).map((a) => (
                                  <Avatar
                                    key={a.id}
                                    className="w-7 h-7 ring-2 ring-background"
                                    title={a.name}
                                  >
                                    <AvatarFallback className="bg-muted text-[10px] font-bold">
                                      {a.avatar}
                                    </AvatarFallback>
                                  </Avatar>
                                ))}
                              </div>
                              <Badge variant="secondary" className="mr-2">
                                {team.length} موظف
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEdit(s)}
                                aria-label="تعديل"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => remove(s.id)}
                                aria-label="حذف"
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                  {!loading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center py-8 text-muted-foreground text-sm"
                      >
                        لا يوجد مشرفون — اضغط "مشرف جديد" للبدء
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing && supervisors.some((s) => s.id === editing.id)
                ? "تعديل بيانات المشرف"
                : "إضافة مشرف جديد"}
            </DialogTitle>
          </DialogHeader>

          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>الاسم الكامل</Label>
                  <Input
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                    placeholder="أ. أحمد محمد"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>البريد الإلكتروني</Label>
                  <Input
                    type="email"
                    value={editing.email}
                    onChange={(e) =>
                      setEditing({ ...editing, email: e.target.value })
                    }
                    placeholder="user@bayan.sa"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>التحويلة</Label>
                  <Input
                    value={editing.ext}
                    onChange={(e) =>
                      setEditing({ ...editing, ext: e.target.value })
                    }
                    placeholder="1001"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>الرتبة</Label>
                  <Select
                    value={editing.role}
                    onValueChange={(v) =>
                      setEditing({ ...editing, role: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="مشرف">مشرف</SelectItem>
                      <SelectItem value="مشرف أول">مشرف أول</SelectItem>
                      <SelectItem value="مدير قسم">مدير قسم</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>حساب المستخدم المرتبط (لتسجيل الدخول)</Label>
                <Select
                  value={editing.userId || "none"}
                  onValueChange={(v) =>
                    setEditing({ ...editing, userId: v === "none" ? null : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر مستخدم..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— بدون ربط —</SelectItem>
                    {users
                      .filter((u) => u.role === "supervisor" || u.role === "admin")
                      .map((u) => {
                        // أخفِ المستخدمين المرتبطين بمشرف آخر
                        const linkedToOther = supervisors.some(
                          (s) => s.userId === u.id && s.id !== editing.id,
                        );
                        return (
                          <SelectItem
                            key={u.id}
                            value={u.id}
                            disabled={linkedToOther}
                          >
                            {u.display_name || u.identifier} ({u.identifier})
                            {linkedToOther ? " — مرتبط" : ""}
                          </SelectItem>
                        );
                      })}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  المشرف سيرى فريقه فقط عند تسجيل الدخول بهذا الحساب
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>الموظفون التابعون</Label>
                  <Badge variant="secondary">
                    {editing.agentIds.length} محدد
                  </Badge>
                </div>
                <div className="rounded-lg border border-border max-h-64 overflow-y-auto divide-y divide-border">
                  {AGENTS.length === 0 && (
                    <p className="p-4 text-center text-xs text-muted-foreground">
                      لا يوجد موظفون متاحون
                    </p>
                  )}
                  {AGENTS.map((a) => {
                    const checked = editing.agentIds.includes(a.id);
                    return (
                      <label
                        key={a.id}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors",
                          checked && "bg-primary/5",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleAgent(a.id)}
                        />
                        <Avatar className="w-7 h-7">
                          <AvatarFallback className="text-[10px] bg-muted">
                            {a.avatar}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold truncate">{a.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            تحويلة {a.ext}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
