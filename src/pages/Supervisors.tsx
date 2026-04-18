import { useMemo, useState } from "react";
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
  DialogTrigger,
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
import { AGENTS, type Agent } from "@/lib/mockData";
import {
  UserCog,
  Users,
  Plus,
  Trash2,
  Pencil,
  Search,
  ShieldCheck,
  Phone,
} from "lucide-react";
import { cn } from "@/lib/utils";

import {
  loadSupervisors,
  saveSupervisors,
  type Supervisor,
} from "@/lib/supervisorsData";

export default function Supervisors() {
  const { toast } = useToast();
  const [supervisors, setSupervisors] = useState<Supervisor[]>(loadSupervisors);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Supervisor | null>(null);
  const [open, setOpen] = useState(false);

  const persist = (list: Supervisor[]) => {
    setSupervisors(list);
    saveSupervisors(list);
  };

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
      unassigned: totalAgents - assignedIds.size,
    };
  }, [supervisors]);

  const openNew = () => {
    setEditing({
      id: `S-${Date.now()}`,
      name: "",
      email: "",
      ext: "",
      role: "مشرف",
      agentIds: [],
    });
    setOpen(true);
  };

  const openEdit = (s: Supervisor) => {
    setEditing({ ...s });
    setOpen(true);
  };

  const remove = (id: string) => {
    persist(supervisors.filter((s) => s.id !== id));
    toast({ title: "تم الحذف", description: "تم حذف المشرف بنجاح" });
  };

  const save = () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.email.trim()) {
      toast({
        title: "بيانات ناقصة",
        description: "الاسم والبريد مطلوبان",
        variant: "destructive",
      });
      return;
    }
    const exists = supervisors.some((s) => s.id === editing.id);
    const next = exists
      ? supervisors.map((s) => (s.id === editing.id ? editing : s))
      : [...supervisors, editing];
    persist(next);
    setOpen(false);
    toast({
      title: exists ? "تم التحديث" : "تم الإضافة",
      description: `${editing.name} - ${editing.agentIds.length} موظف`,
    });
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
                  {filtered.map((s) => {
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
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center py-8 text-muted-foreground text-sm"
                      >
                        لا يوجد مشرفون مطابقون للبحث
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
                      setEditing({ ...editing, role: v as Supervisor["role"] })
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

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>الموظفون التابعون</Label>
                  <Badge variant="secondary">
                    {editing.agentIds.length} محدد
                  </Badge>
                </div>
                <div className="rounded-lg border border-border max-h-64 overflow-y-auto divide-y divide-border">
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
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={save}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
