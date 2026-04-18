import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useLiveAlerts } from "@/hooks/useLiveAgents";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  AlertOctagon,
  Info,
  Bell,
  Save,
  Volume2,
  Mail,
  MessageSquare,
} from "lucide-react";
import Swal from "sweetalert2";

interface AlertRule {
  id: string;
  level: "danger" | "warning" | "info";
  title: string;
  message: string;
  time: string;
  agent?: string;
}

const STATIC_ALERTS: AlertRule[] = [
  { id: "a1", level: "danger",  title: "تجاوز SLA حرج", message: "6 مكالمات في الانتظار لأكثر من دقيقتين", time: "منذ 3 د", agent: "النظام" },
  { id: "a2", level: "danger",  title: "موظف غير مستجيب", message: "الموظف خالد لم يستجب لـ 4 مكالمات متتالية", time: "منذ 7 د", agent: "خالد الدوسري" },
  { id: "a3", level: "warning", title: "خمول مطوّل", message: "الموظفة هند خاملة منذ 14 دقيقة", time: "منذ 12 د", agent: "هند الرشيد" },
  { id: "a4", level: "warning", title: "تجاوز مدة الاستراحة", message: "الموظف يوسف تجاوز 25 دقيقة استراحة", time: "منذ 18 د", agent: "يوسف الغامدي" },
  { id: "a5", level: "info",    title: "تحديث متاح", message: "نسخة جديدة من النظام جاهزة للتثبيت", time: "منذ ساعة", agent: "النظام" },
];

const Alerts = () => {
  const liveAlerts = useLiveAlerts(10);
  const [idleLimit, setIdleLimit] = useState([8]);
  const [delayLimit, setDelayLimit] = useState([45]);
  const [breakLimit, setBreakLimit] = useState([20]);
  const [slaThreshold, setSlaThreshold] = useState([85]);

  const [enableEmail, setEnableEmail] = useState(true);
  const [enableSound, setEnableSound] = useState(true);
  const [enableSMS, setEnableSMS] = useState(false);
  const [enableIdle, setEnableIdle] = useState(true);
  const [enableSLA, setEnableSLA] = useState(true);
  const [enableMissed, setEnableMissed] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const allAlerts: AlertRule[] = [
    ...liveAlerts.map((a) => ({
      id: a.id,
      level: a.level,
      title: a.title,
      message: a.message,
      time: "الآن",
    })),
    ...STATIC_ALERTS,
  ].filter((a) => !dismissed.has(a.id));

  const danger = allAlerts.filter((a) => a.level === "danger");
  const warning = allAlerts.filter((a) => a.level === "warning");
  const info = allAlerts.filter((a) => a.level === "info");

  const saveSettings = () => {
    Swal.fire({
      icon: "success",
      title: "تم حفظ الإعدادات",
      text: "ستُطبَّق التنبيهات الجديدة فوراً.",
      confirmButtonColor: "hsl(174 72% 38%)",
      timer: 2000,
    });
  };

  const renderGroup = (
    title: string,
    items: AlertRule[],
    Icon: typeof AlertTriangle,
    color: "destructive" | "warning" | "info",
  ) => (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-8 h-8 rounded-lg grid place-items-center",
            color === "destructive" && "bg-destructive/15 text-destructive",
            color === "warning"     && "bg-warning/15 text-warning",
            color === "info"        && "bg-info/15 text-info",
          )}>
            <Icon className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold">{title}</h3>
        </div>
        <span className={cn(
          "text-[10px] font-bold px-2 py-1 rounded-full",
          color === "destructive" && "bg-destructive/15 text-destructive",
          color === "warning"     && "bg-warning/15 text-warning",
          color === "info"        && "bg-info/15 text-info",
        )}>
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">لا توجد تنبيهات في هذه الفئة.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li
              key={a.id}
              className={cn(
                "flex items-start gap-3 p-3 rounded-xl border-r-4 bg-background/60",
                color === "destructive" && "border-r-destructive",
                color === "warning"     && "border-r-warning",
                color === "info"        && "border-r-info",
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{a.title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{a.message}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {a.agent && <span className="font-semibold">{a.agent} · </span>}{a.time}
                </p>
              </div>
              <button
                onClick={() => setDismissed((p) => new Set(p).add(a.id))}
                className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded"
              >
                إغلاق
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <AppLayout title="الإشعارات التنبيهية" subtitle="حدود ذكية وقواعد تنبيه قابلة للضبط">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Settings */}
        <div className="xl:col-span-1 space-y-5">
          <div className="glass-card p-5">
            <h3 className="text-base font-bold mb-1 flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" /> حدود التنبيه
            </h3>
            <p className="text-xs text-muted-foreground mb-5">اضبط القيم العتبية بدقة.</p>

            <div className="space-y-6">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-semibold">حد الخمول</label>
                  <span className="text-sm font-bold text-primary tabular-nums">{idleLimit[0]} د</span>
                </div>
                <Slider value={idleLimit} onValueChange={setIdleLimit} min={1} max={30} step={1} />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-semibold">حد التأخير في الرد</label>
                  <span className="text-sm font-bold text-primary tabular-nums">{delayLimit[0]} ث</span>
                </div>
                <Slider value={delayLimit} onValueChange={setDelayLimit} min={10} max={120} step={5} />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-semibold">حد مدة الاستراحة</label>
                  <span className="text-sm font-bold text-primary tabular-nums">{breakLimit[0]} د</span>
                </div>
                <Slider value={breakLimit} onValueChange={setBreakLimit} min={5} max={60} step={5} />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-semibold">عتبة SLA الدنيا</label>
                  <span className="text-sm font-bold text-primary tabular-nums">{slaThreshold[0]}%</span>
                </div>
                <Slider value={slaThreshold} onValueChange={setSlaThreshold} min={50} max={100} step={1} />
              </div>
            </div>
          </div>

          <div className="glass-card p-5">
            <h3 className="text-base font-bold mb-4">قنوات الإشعار</h3>
            <div className="space-y-3">
              {[
                { id: "email", label: "البريد الإلكتروني", icon: Mail, val: enableEmail, set: setEnableEmail },
                { id: "sound", label: "تنبيه صوتي", icon: Volume2, val: enableSound, set: setEnableSound },
                { id: "sms", label: "رسائل SMS", icon: MessageSquare, val: enableSMS, set: setEnableSMS },
              ].map((c) => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-background/60">
                  <div className="flex items-center gap-3">
                    <c.icon className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{c.label}</span>
                  </div>
                  <Switch checked={c.val} onCheckedChange={c.set} />
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-5">
            <h3 className="text-base font-bold mb-4">قواعد التفعيل</h3>
            <div className="space-y-3">
              {[
                { label: "تنبيهات الخمول", val: enableIdle, set: setEnableIdle },
                { label: "تنبيهات SLA", val: enableSLA, set: setEnableSLA },
                { label: "تنبيهات المكالمات الفائتة", val: enableMissed, set: setEnableMissed },
              ].map((c) => (
                <div key={c.label} className="flex items-center justify-between p-3 rounded-xl bg-background/60">
                  <span className="text-sm font-medium">{c.label}</span>
                  <Switch checked={c.val} onCheckedChange={c.set} />
                </div>
              ))}
            </div>
          </div>

          <Button onClick={saveSettings} className="w-full gradient-primary text-primary-foreground shadow-glow">
            <Save className="w-4 h-4 ml-2" /> حفظ جميع الإعدادات
          </Button>
        </div>

        {/* Active alerts */}
        <div className="xl:col-span-2 space-y-5">
          {renderGroup("تنبيهات حرجة (أحمر)", danger, AlertOctagon, "destructive")}
          {renderGroup("تنبيهات تحذيرية (أصفر)", warning, AlertTriangle, "warning")}
          {renderGroup("تنبيهات معلوماتية", info, Info, "info")}
        </div>
      </div>
    </AppLayout>
  );
};

export default Alerts;
