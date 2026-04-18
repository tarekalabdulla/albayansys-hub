import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AGENTS, STATUS_LABEL, statusBadgeClass } from "@/lib/mockData";
import {
  ArrowRight,
  Phone,
  PhoneMissed,
  Timer,
  Users,
  Activity,
  TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";

interface Supervisor {
  id: string;
  name: string;
  email: string;
  ext: string;
  role: string;
  agentIds: string[];
}

const SUP_KEY = "callcenter:supervisors";

function loadSupervisors(): Supervisor[] {
  try {
    const raw = localStorage.getItem(SUP_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export default function SupervisorDetail() {
  const { id } = useParams<{ id: string }>();
  const supervisors = loadSupervisors();
  const supervisor = supervisors.find((s) => s.id === id);

  const team = useMemo(
    () => (supervisor ? AGENTS.filter((a) => supervisor.agentIds.includes(a.id)) : []),
    [supervisor],
  );

  const stats = useMemo(() => {
    const answered = team.reduce((s, a) => s + a.answered, 0);
    const missed = team.reduce((s, a) => s + a.missed, 0);
    const total = answered + missed;
    const sla = total ? Math.round((answered / total) * 100) : 0;
    const idle = team.filter((a) => a.status === "idle").length;
    const inCall = team.filter((a) => a.status === "in_call").length;
    const avgDuration = team.length
      ? Math.round(team.reduce((s, a) => s + a.avgDuration, 0) / team.length)
      : 0;
    return { answered, missed, sla, idle, inCall, avgDuration };
  }, [team]);

  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    team.forEach((a) => {
      counts[a.status] = (counts[a.status] || 0) + 1;
    });
    return Object.entries(counts).map(([k, v]) => ({
      name: STATUS_LABEL[k as keyof typeof STATUS_LABEL],
      value: v,
      key: k,
    }));
  }, [team]);

  const pieColors: Record<string, string> = {
    online: "hsl(var(--success))",
    in_call: "hsl(var(--primary))",
    idle: "hsl(var(--warning))",
    break: "hsl(var(--info))",
    offline: "hsl(var(--muted-foreground))",
  };

  const trend = useMemo(
    () =>
      Array.from({ length: 7 }).map((_, i) => ({
        day: ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"][i],
        answered: 80 + Math.floor(Math.random() * 80),
        missed: Math.floor(Math.random() * 20),
      })),
    [team],
  );

  if (!supervisor) {
    return (
      <AppLayout title="مشرف غير موجود">
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <p className="text-muted-foreground">لم يتم العثور على هذا المشرف</p>
            <Button asChild variant="outline">
              <Link to="/supervisors">
                <ArrowRight className="w-4 h-4 ml-2" />
                العودة للقائمة
              </Link>
            </Button>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={supervisor.name} subtitle={`لوحة إشراف - ${supervisor.role}`}>
      <div className="space-y-6">
        {/* Header */}
        <Card>
          <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Avatar className="w-16 h-16 ring-2 ring-primary/30">
                <AvatarFallback className="bg-primary/15 text-primary text-lg font-bold">
                  {supervisor.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div>
                <h2 className="text-xl font-extrabold">{supervisor.name}</h2>
                <p className="text-sm text-muted-foreground">{supervisor.email}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="bg-info/10 text-info border-info/30">
                    {supervisor.role}
                  </Badge>
                  <Badge variant="secondary">تحويلة {supervisor.ext}</Badge>
                  <Badge variant="secondary">{team.length} موظف</Badge>
                </div>
              </div>
            </div>
            <Button asChild variant="outline">
              <Link to="/supervisors">
                <ArrowRight className="w-4 h-4 ml-2" />
                العودة
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-success/15 text-success grid place-items-center">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">مكالمات مُجابة</p>
                <p className="text-2xl font-extrabold tabular-nums">{stats.answered}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-destructive/15 text-destructive grid place-items-center">
                <PhoneMissed className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">مكالمات فائتة</p>
                <p className="text-2xl font-extrabold tabular-nums">{stats.missed}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-primary/15 text-primary grid place-items-center">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">SLA</p>
                <p className="text-2xl font-extrabold tabular-nums">{stats.sla}%</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-warning/15 text-warning grid place-items-center">
                <Timer className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">خامل الآن</p>
                <p className="text-2xl font-extrabold tabular-nums">{stats.idle}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                المكالمات خلال الأسبوع
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="answered"
                      name="مُجابة"
                      stroke="hsl(var(--success))"
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="missed"
                      name="فائتة"
                      stroke="hsl(var(--destructive))"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                توزيع الحالات
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={2}
                    >
                      {statusData.map((entry) => (
                        <Cell key={entry.key} fill={pieColors[entry.key] || "hsl(var(--muted))"} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Per agent bar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">أداء أعضاء الفريق</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={team.map((a) => ({ name: a.name.split(" ")[0], answered: a.answered, missed: a.missed }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="answered" name="مُجابة" fill="hsl(var(--success))" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="missed" name="فائتة" fill="hsl(var(--destructive))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Team table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">قائمة الفريق</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">الموظف</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">مُجابة</TableHead>
                    <TableHead className="text-right">فائتة</TableHead>
                    <TableHead className="text-right">متوسط المدة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="w-8 h-8">
                            <AvatarFallback className="bg-muted text-[10px] font-bold">
                              {a.avatar}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-bold">{a.name}</p>
                            <p className="text-[11px] text-muted-foreground">تحويلة {a.ext}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusBadgeClass(a.status)}>
                          {STATUS_LABEL[a.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">{a.answered}</TableCell>
                      <TableCell className="tabular-nums">{a.missed}</TableCell>
                      <TableCell className="tabular-nums">
                        {Math.floor(a.avgDuration / 60)}:{String(a.avgDuration % 60).padStart(2, "0")}
                      </TableCell>
                    </TableRow>
                  ))}
                  {team.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                        لا يوجد موظفون مُعيّنون لهذا المشرف
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
