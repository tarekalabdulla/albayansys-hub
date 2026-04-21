import { useRef, useState } from "react";
import { Upload, Loader2, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { recordingsApi } from "@/lib/dataApi";

const MAX_MB = 100;
const ACCEPT = "audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a,.ogg,.webm";

interface Props {
  /** يُنفَّذ بعد نجاح الرفع وإنشاء التسجيل */
  onCreated?: () => void;
}

export function AudioUploadDialog({ onCreated }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [agentName, setAgentName] = useState("");
  const [customerNumber, setCustomerNumber] = useState("");
  const [category, setCategory] = useState("استفسار");
  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null); setAgentName(""); setCustomerNumber("");
    setCategory("استفسار"); setPct(0); setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onPick = (f: File | null) => {
    if (!f) return setFile(null);
    if (f.size > MAX_MB * 1024 * 1024) {
      toast({ title: "الملف كبير جداً", description: `الحد الأقصى ${MAX_MB} ميجابايت`, variant: "destructive" });
      return;
    }
    setFile(f);
  };

  const submit = async () => {
    if (!file || !agentName.trim() || !customerNumber.trim()) {
      toast({ title: "بيانات ناقصة", description: "اختر ملفاً واكتب اسم الموظف ورقم العميل", variant: "destructive" });
      return;
    }
    try {
      setBusy(true); setPct(0);
      // 1) ارفع الملف
      const { audioUrl } = await recordingsApi.uploadAudio(file, setPct);
      // 2) أنشئ سجل التسجيل
      // قدّر المدة من <audio> محلياً (اختياري سريع)
      const duration = await guessDuration(file).catch(() => 0);
      await recordingsApi.create({
        agentName: agentName.trim(),
        customerNumber: customerNumber.trim(),
        audioUrl,
        category,
        duration,
        sentiment: "neutral",
        qualityScore: 0,
      });
      toast({ title: "تم الرفع", description: "أُضيف التسجيل بنجاح" });
      setOpen(false);
      reset();
      onCreated?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
      toast({ title: "فشل الرفع", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Upload className="w-4 h-4" /> رفع تسجيل
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Music2 className="w-5 h-5 text-primary" /> رفع ملف صوتي
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">ملف الصوت (mp3, wav, m4a — حتى {MAX_MB}MB)</Label>
            <Input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              disabled={busy}
              onChange={(e) => onPick(e.target.files?.[0] || null)}
              className="mt-1"
            />
            {file && (
              <p className="text-[11px] text-muted-foreground mt-1">
                {file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">اسم الموظف</Label>
              <Input value={agentName} onChange={(e) => setAgentName(e.target.value)} disabled={busy} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">رقم العميل</Label>
              <Input value={customerNumber} onChange={(e) => setCustomerNumber(e.target.value)} disabled={busy} className="mt-1" dir="ltr" />
            </div>
          </div>

          <div>
            <Label className="text-xs">الفئة</Label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={busy}
              className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {["استفسار", "شكوى", "دعم فني", "مبيعات", "متابعة"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {busy && (
            <div className="space-y-1">
              <Progress value={pct} />
              <p className="text-[11px] text-center text-muted-foreground">{pct}%</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>إلغاء</Button>
          <Button size="sm" onClick={submit} disabled={busy || !file}>
            {busy ? (<><Loader2 className="w-4 h-4 animate-spin ms-1" /> جاري الرفع</>) : "رفع وحفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** يحاول استخراج مدة الملف الصوتي بدون رفعه */
function guessDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => {
      const d = Math.round(a.duration || 0);
      URL.revokeObjectURL(url);
      resolve(isFinite(d) ? d : 0);
    };
    a.onerror = () => { URL.revokeObjectURL(url); reject(new Error("metadata_fail")); };
    a.src = url;
  });
}
