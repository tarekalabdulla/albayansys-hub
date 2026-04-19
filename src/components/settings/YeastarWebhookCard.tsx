// بطاقة إعدادات Webhook الـ Yeastar (URL + إدارة سر التوقيع HMAC)
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Webhook, Copy, RefreshCw, Trash2, Loader2, CheckCircle2, AlertCircle, ShieldCheck, Activity } from "lucide-react";
import Swal from "sweetalert2";
import { regenerateWebhookSecret, clearWebhookSecret } from "@/lib/pbxApi";
import { cn } from "@/lib/utils";

interface Props {
  hasSecret: boolean;
  webhookUrl: string;
  lastEventAt: string | null;
  onChange: (hasSecret: boolean) => void;
}

export function YeastarWebhookCard({ hasSecret, webhookUrl, lastEventAt, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  const copy = async (txt: string, label: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      Swal.fire({ icon: "success", title: `تم نسخ ${label}`, timer: 1100, showConfirmButton: false });
    } catch {
      Swal.fire({ icon: "error", title: "تعذّر النسخ" });
    }
  };

  const regen = async () => {
    const r = await Swal.fire({
      icon: "warning",
      title: hasSecret ? "إعادة توليد سر Webhook؟" : "توليد سر Webhook جديد؟",
      text: hasSecret
        ? "سيُلغى السر الحالي فوراً وسيتوقف Yeastar عن إرسال الأحداث حتى تحديث الإعدادات في لوحته."
        : "احفظ السر فوراً — لن يُعرض مرة أخرى.",
      showCancelButton: true,
      confirmButtonText: "نعم، ولّد",
      cancelButtonText: "إلغاء",
    });
    if (!r.isConfirmed) return;
    setBusy(true);
    try {
      const res = await regenerateWebhookSecret();
      setRevealed(res.secret);
      onChange(true);
    } catch (e: any) {
      Swal.fire({ icon: "error", title: "تعذّر التوليد", text: e?.response?.data?.message || e?.message });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    const r = await Swal.fire({
      icon: "warning",
      title: "حذف سر Webhook؟",
      text: "سيُقبل أي طلب webhook بدون تحقق — لا يُنصح في الإنتاج.",
      showCancelButton: true,
      confirmButtonText: "نعم، احذف",
      cancelButtonText: "إلغاء",
      confirmButtonColor: "hsl(0 78% 56%)",
    });
    if (!r.isConfirmed) return;
    setBusy(true);
    try {
      await clearWebhookSecret();
      onChange(false);
      setRevealed(null);
      Swal.fire({ icon: "success", title: "تم الحذف", timer: 1100, showConfirmButton: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Webhook className="w-4 h-4 text-primary" />
        <h4 className="text-sm font-bold">Webhook للأحداث الحية</h4>
        {hasSecret ? (
          <span className="ms-auto text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30">
            <ShieldCheck className="w-3 h-3" /> HMAC مفعّل
          </span>
        ) : (
          <span className="ms-auto text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/30">
            <AlertCircle className="w-3 h-3" /> بدون توقيع
          </span>
        )}
      </div>

      {/* URL */}
      <div>
        <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
          رابط Webhook (انسخه إلى لوحة Yeastar → Event Notifications)
        </label>
        <div className="flex gap-1.5">
          <Input value={webhookUrl} readOnly dir="ltr" className="font-mono text-xs" />
          <Button variant="outline" size="icon" onClick={() => copy(webhookUrl, "الرابط")}>
            <Copy className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Secret reveal */}
      {revealed && (
        <div className="rounded-lg bg-warning/10 border border-warning/30 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-warning">
            <AlertCircle className="w-3.5 h-3.5" /> احفظ السر الآن — لن يُعرض مرة أخرى
          </div>
          <div className="flex gap-1.5">
            <Input value={revealed} readOnly dir="ltr" className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={() => copy(revealed, "السر")}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            ضع هذا السر في حقل <code className="px-1 bg-muted rounded">Signature Secret</code> ضمن إعدادات Webhook في Yeastar.
          </p>
          <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>إخفاء</Button>
        </div>
      )}

      {/* آخر حدث */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Activity className={cn("w-3.5 h-3.5", lastEventAt ? "text-success" : "text-muted-foreground")} />
        {lastEventAt
          ? <>آخر حدث مستقبَل: <span className="font-mono">{new Date(lastEventAt).toLocaleString("ar-SA", { hour12: false })}</span></>
          : <>لم يُستقبَل أي حدث بعد</>}
      </div>

      <div className="flex gap-2 pt-1">
        <Button onClick={regen} disabled={busy} className="flex-1">
          {busy ? <Loader2 className="w-4 h-4 ms-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 ms-1.5" />}
          {hasSecret ? "إعادة توليد السر" : "توليد سر جديد"}
        </Button>
        {hasSecret && (
          <Button variant="outline" onClick={clear} disabled={busy}>
            <Trash2 className="w-4 h-4 ms-1.5" /> حذف
          </Button>
        )}
      </div>

      <div className="text-[11px] text-muted-foreground bg-info/5 border border-info/20 rounded-lg p-2 leading-relaxed">
        <CheckCircle2 className="w-3 h-3 text-info inline ms-1" />
        في لوحة Yeastar P-Series: <strong>System → Event Notification → Webhook</strong>،
        أضف الرابط أعلاه واختر الأحداث (Call Status, Extension Presence, CDR, Queue) ثم ضع السر في حقل التوقيع.
      </div>
    </div>
  );
}
