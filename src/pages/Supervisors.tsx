import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { type Agent, type AgentStatus } from "@/lib/mockData";
import {
  UserCog, Users, Plus, Trash2, Pencil, Search, ShieldCheck,
  Loader2, UserPlus, Phone, Power, Coffee, PowerOff, PauseCircle, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supervisorsApi, isRealApi, type ApiSupervisor } from "@/lib/dataApi";
import { useLiveAgents } from "@/hooks/useLiveAgents";

// ============================================================
// Status helpers (متوافقة مع تصميم جدول الأداء)
// ============================================================
const STATUS_META: Record<AgentStatus, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  pillClass: string;   // bg + text
  dotClass: string;    // colored dot
  pulse?: boolean;
}> = {
  in_call:  { label: "في مكالمة", icon: Phone,         pillClass: "bg-info text-info-foreground",         dotClass: "bg-info-foreground", pulse: true },
  online:   { label: "متصل",      icon: Power,         pillClass: "bg-success text-success-foreground",   dotClass: "bg-success-foreground" },
  idle:     { label: "خامل",      icon: PauseCircle,   pillClass: "bg-warning text-warning-foreground",   dotClass: "bg-warning-foreground" },
  break:    { label: "استراحة",   icon: Coffee,        pillClass: "bg-accent text-accent-foreground",     dotClass: "bg-accent-foreground" },
  offline:  { label: "غير متصل",  icon: PowerOff,      pillClass: "bg-muted text-muted-foreground",       dotClass: "bg-muted-foreground" },
};

const SUP_TONES = [
  { ring: "ring-info/30",      bg: "bg-info/10",      text: "text-info",      grad: "from-info/5 via-transparent to-transparent" },
  { ring: "ring-warning/30",   bg: "bg-warning/10",   text: "text-warning",   grad: "from-warning/5 via-transparent to-transparent" },
  { ring: "ring-primary/30",   bg: "bg-primary/10",   text: "text-primary",   grad: "from-primary/5 via-transparent to-transparent" },
  { ring: "ring-success/30",   bg: "bg-success/10",   text: "text-success",   grad: "from-success/5 via-transparent to-transparent" },
  { ring: "ring-accent/40",    bg: "bg-accent/15",    text: "text-accent-foreground", grad: "from-accent/10 via-transparent to-transparent" },
];

function StatusPill({ status }: { status: AgentStatus }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold shadow-sm",
      m.pillClass,
    )}>
      <Icon className="w-3 h-3" />
      {m.label}
      <span className={cn("w-1.5 h-1.5 rounded-full", m.dotClass, m.pulse && "animate-pulse")} />
    </span>
  );
}

export default function Supervisors() {
  const { toast } = useToast();
  const liveAgents = useLiveAgents();
  const [supervisors, setSupervisors] = useState<ApiSupervisor[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | ApiSupervisor["role"]>("all");
  const [editing, setEditing] = useState<ApiSupervisor | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [open, setOpen] = useState(false);
  const [assignFor, setAssignFor] = useState<ApiSupervisor | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await supervisorsApi.list();
        setSupervisors(list);
      } catch (e: any) {
        toast({ title: "تعذّر التحميل", description: e?.response?.data?.error || e.message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  // خريطة الموظفين الحية للوصول السريع بالـ id
  const agentsMap = useMemo(() => {
    const m = new Map<string, Agent>();
    liveAgents.forEach((a) => m.set(a.id, a));
    return m;
  }, [liveAgents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return supervisors.filter((s) => {
      if (roleFilter !== "all" && s.role !== roleFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.ext.toLowerCase().includes(q)
      );
    });
  }, [supervisors, search, roleFilter]);

  const stats = useMemo(() => {
    const totalAgents = liveAgents.length;
    const assignedIds = new Set(supervisors.flatMap((s) => s.agentIds));
    return {
      supervisors: supervisors.length,
      assigned: assignedIds.size,
      unassigned: Math.max(0, totalAgents - assignedIds.size),
    };
  }, [supervisors, liveAgents]);

  const openNew = () => {
    setEditing({ id: "", name: "", email: "", ext: "", role: "مشرف", agentIds: [] });
    setIsNew(true);
    setOpen(true);
  };
  const openEdit = (s: ApiSupervisor) => {
    setEditing({ ...s });
    setIsNew(false);
    setOpen(true);
  };

  const remove = async (id: string) => {
    try {
      await supervisorsApi.remove(id);
      setSupervisors((p) => p.filter((s) => s.id !== id));
      toast({ title: "تم الحذف", description: "تم حذف المشرف بنجاح" });
    } catch (e: any) {
      toast({ title: "تعذّر الحذف", description: e?.response?.data?.error || e.message, variant: "destructive" });
    }
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.email.trim() || !editing.ext.trim()) {
      toast({ title: "بيانات ناقصة", description: "الاسم والبريد والتحويلة مطلوبة", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      if (isNew) {
        const created = await supervisorsApi.create({
          name: editing.name, email: editing.email, ext: editing.ext,
          role: editing.role, agentIds: editing.agentIds,
        });
        setSupervisors((p) => [created, ...p]);
        toast({ title: "تمت الإضافة", description: `${created.name} - ${created.agentIds.length} موظف` });
      } else {
        const updated = await supervisorsApi.update(editing.id, {
          name: editing.name, email: editing.email, ext: editing.ext,
          role: editing.role, agentIds: editing.agentIds,
        });
        setSupervisors((p) => p.map((s) => (s.id === editing.id ? updated : s)));
        toast({ title: "تم التحديث", description: `${updated.name}` });
      }
      setOpen(false);
    } catch (e: any) {
      toast({ title: "فشل الحفظ", description: e?.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAgent = (agentId: string) => {
    if (!editing) return;
    const has = editing.agentIds.includes(agentId);
    setEditing({
      ...editing,
      agentIds: has ? editing.agentIds.filter((x) => x !== agentId) : [...editing.agentIds, agentId],
    });
  };

  // إزالة موظف مباشرة من بطاقة المشرف
  const unassignAgent = async (sup: ApiSupervisor, agentId: string) => {
    try {
      const newIds = sup.agentIds.filter((x) => x !== agentId);
      const updated = await supervisorsApi.update(sup.id, { agentIds: newIds });
      setSupervisors((p) => p.map((s) => (s.id === sup.id ? updated : s)));
      toast({ title: "تم الإلغاء", description: "تم إزالة الموظف من المشرف" });
    } catch (e: any) {
      toast({ title: "تعذّر التحديث", description: e?.response?.data?.error || e.message, variant: "destructive" });
    }
  };

  // فتح نافذة "تعيين" سريعة لإضافة موظفين فقط
  const openAssign = (s: ApiSupervisor) => setAssignFor({ ...s });

  const saveAssign = async () => {
    if (!assignFor) return;
    setSubmitting(true);
    try {
      const updated = await supervisorsApi.update(assignFor.id, { agentIds: assignFor.agentIds });
      setSupervisors((p) => p.map((s) => (s.id === assignFor.id ? updated : s)));
      toast({ title: "تم الحفظ", description: `${updated.agentIds.length} موظف معيّن` });
      setAssignFor(null);
    } catch (e: any) {
      toast({ title: "تعذّر الحفظ", description: e?.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // ملاحظة: isRealApi = true دائماً الآن — لا حاجة لشاشة تفعيل خاصة.

  return (
    <AppLayout title="إدارة المشرفين" subtitle="إدارة المشرفين وتعيين الموظفين">
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/15 text-primary grid place-items-center"><ShieldCheck className="w-5 h-5" /></div>
            <div><p className="text-xs text-muted-foreground">عدد المشرفين</p><p className="text-2xl font-extrabold">{stats.supervisors}</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-success/15 text-success grid place-items-center"><Users className="w-5 h-5" /></div>
            <div><p className="text-xs text-muted-foreground">موظفون مُعيّنون</p><p className="text-2xl font-extrabold">{stats.assigned}</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-warning/15 text-warning grid place-items-center"><UserCog className="w-5 h-5" /></div>
            <div><p className="text-xs text-muted-foreground">بدون إشراف</p><p className="text-2xl font-extrabold">{stats.unassigned}</p></div>
          </CardContent></Card>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row gap-2 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بالاسم أو البريد أو التحويلة..."
                className="pr-10"
              />
            </div>
            <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as typeof roleFilter)}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="كل الأدوار" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأدوار</SelectItem>
                <SelectItem value="مشرف">مشرف</SelectItem>
                <SelectItem value="مشرف أول">مشرف أول</SelectItem>
                <SelectItem value="مدير قسم">مدير قسم</SelectItem>
              </SelectContent>
            </Select>
            {(search || roleFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSearch(""); setRoleFilter("all"); }}
                className="gap-1.5 text-muted-foreground"
              >
                <X className="w-3.5 h-3.5" />
                مسح
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="hidden sm:inline-flex">{filtered.length} نتيجة</Badge>
            <Button onClick={openNew} className="gap-1.5"><Plus className="w-4 h-4" />مشرف جديد</Button>
          </div>
        </div>

        {/* Cards Grid */}
        {loading ? (
          <div className="py-16 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 mx-auto animate-spin mb-2" /> جاري التحميل...
          </div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground text-sm">
            لا يوجد مشرفون مطابقون للبحث
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {filtered.map((s, idx) => {
              const tone = SUP_TONES[idx % SUP_TONES.length];
              const team = s.agentIds
                .map((id) => agentsMap.get(id))
                .filter((a): a is Agent => Boolean(a));
              const activeCount = team.filter((a) => a.status === "online" || a.status === "in_call").length;
              const idleCount = team.filter((a) => a.status === "idle" || a.status === "offline").length;
              const initial = s.name.replace(/^أ\.\s*/, "").trim().charAt(0);

              return (
                <Card
                  key={s.id}
                  className={cn(
                    "relative overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5",
                    "bg-gradient-to-br", tone.grad,
                  )}
                >
                  {/* Header */}
                  <div className="p-5 pb-3 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn(
                        "w-12 h-12 rounded-full grid place-items-center font-extrabold text-lg ring-2",
                        tone.bg, tone.text, tone.ring,
                      )}>
                        {initial}
                      </div>
                      <div className="min-w-0">
                        <Link
                          to={`/supervisors/${s.id}`}
                          className="text-base font-extrabold hover:text-primary hover:underline truncate block"
                        >
                          {s.name}
                        </Link>
                        <p className="text-xs text-muted-foreground truncate">{s.role}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openAssign(s)}
                        className="h-8 gap-1.5 rounded-lg text-xs"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        تعيين
                      </Button>
                    </div>
                  </div>

                  {/* Meta row */}
                  <div className="px-5 pb-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      <span className="font-bold text-foreground">{team.length}</span> موظفين
                    </span>
                    <span className="text-border">•</span>
                    <span>نشط <span className="font-bold text-success">{activeCount}</span></span>
                    <span className="text-border">•</span>
                    <span>خامل <span className="font-bold text-warning">{idleCount}</span></span>
                  </div>

                  {/* Agents list */}
                  <div className="px-3 pb-3 space-y-2">
                    {team.length === 0 ? (
                      <div className="text-center text-xs text-muted-foreground py-6 border border-dashed border-border rounded-lg">
                        لا يوجد موظفون معيّنون
                      </div>
                    ) : (
                      team.map((a) => (
                        <div
                          key={a.id}
                          className="group flex items-center justify-between gap-2 rounded-xl bg-card/60 backdrop-blur-sm border border-border/60 px-3 py-2 hover:border-border transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <StatusPill status={a.status} />
                            <button
                              onClick={() => unassignAgent(s, a.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                              title="إزالة من المشرف"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="text-right min-w-0">
                              <p className="text-sm font-bold truncate">{a.name}</p>
                              <p className="text-[10px] text-muted-foreground">تحويلة {a.ext}</p>
                            </div>
                            <Avatar className="w-8 h-8">
                              <AvatarFallback className="bg-muted text-[10px] font-bold">{a.avatar}</AvatarFallback>
                            </Avatar>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Footer actions */}
                  <div className="px-5 py-3 border-t border-border/60 flex items-center justify-between bg-background/30">
                    <div className="text-[11px] text-muted-foreground">
                      <span>تحويلة {s.ext}</span>
                      <span className="mx-1.5">•</span>
                      <span className="truncate">{s.email}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => remove(s.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit / Create Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNew ? "إضافة مشرف جديد" : "تعديل بيانات المشرف"}</DialogTitle>
          </DialogHeader>

          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>الاسم الكامل</Label>
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="أ. أحمد محمد" />
                </div>
                <div className="space-y-1.5">
                  <Label>البريد الإلكتروني</Label>
                  <Input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} placeholder="user@bayan.sa" />
                </div>
                <div className="space-y-1.5">
                  <Label>التحويلة</Label>
                  <Input value={editing.ext} onChange={(e) => setEditing({ ...editing, ext: e.target.value })} placeholder="1001" />
                </div>
                <div className="space-y-1.5">
                  <Label>الرتبة</Label>
                  <Select value={editing.role} onValueChange={(v) => setEditing({ ...editing, role: v as ApiSupervisor["role"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                  <Badge variant="secondary">{editing.agentIds.length} محدد</Badge>
                </div>
                <div className="rounded-lg border border-border max-h-64 overflow-y-auto divide-y divide-border">
                  {AGENTS.map((a) => {
                    const checked = editing.agentIds.includes(a.id);
                    return (
                      <label key={a.id} className={cn(
                        "flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50",
                        checked && "bg-primary/5",
                      )}>
                        <Checkbox checked={checked} onCheckedChange={() => toggleAgent(a.id)} />
                        <Avatar className="w-7 h-7"><AvatarFallback className="text-[10px] bg-muted">{a.avatar}</AvatarFallback></Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold truncate">{a.name}</p>
                          <p className="text-[10px] text-muted-foreground">تحويلة {a.ext}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
            <Button onClick={save} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Assign Dialog */}
      <Dialog open={!!assignFor} onOpenChange={(v) => !v && setAssignFor(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تعيين موظفين — {assignFor?.name}</DialogTitle>
          </DialogHeader>
          {assignFor && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">اختر الموظفين الذين يتبعون هذا المشرف</p>
                <Badge variant="secondary">{assignFor.agentIds.length} محدد</Badge>
              </div>
              <div className="rounded-lg border border-border max-h-80 overflow-y-auto divide-y divide-border">
                {AGENTS.map((a) => {
                  const checked = assignFor.agentIds.includes(a.id);
                  const live = agentsMap.get(a.id) ?? a;
                  return (
                    <label key={a.id} className={cn(
                      "flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50",
                      checked && "bg-primary/5",
                    )}>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => {
                          const has = assignFor.agentIds.includes(a.id);
                          setAssignFor({
                            ...assignFor,
                            agentIds: has
                              ? assignFor.agentIds.filter((x) => x !== a.id)
                              : [...assignFor.agentIds, a.id],
                          });
                        }}
                      />
                      <Avatar className="w-7 h-7"><AvatarFallback className="text-[10px] bg-muted">{a.avatar}</AvatarFallback></Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate">{a.name}</p>
                        <p className="text-[10px] text-muted-foreground">تحويلة {a.ext}</p>
                      </div>
                      <StatusPill status={live.status} />
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignFor(null)} disabled={submitting}>إلغاء</Button>
            <Button onClick={saveAssign} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              حفظ التعيين
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
