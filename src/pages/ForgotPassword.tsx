import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  Mail,
  UserCog,
  KeyRound,
  CheckCircle2,
  Send,
} from "lucide-react";
import logo from "@/assets/logo.png";

type Method = "email" | "supervisor";

const ForgotPassword = () => {
  const { toast } = useToast();
  const [method, setMethod] = useState<Method>("email");
  const [email, setEmail] = useState("");
  const [ext, setExt] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (method === "email") {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
      if (!emailOk) {
        toast({
          title: "بريد غير صحيح",
          description: "أدخل بريداً إلكترونياً صالحاً",
          variant: "destructive",
        });
        return;
      }
    } else {
      if (!ext.trim()) {
        toast({
          title: "حقل مطلوب",
          description: "أدخل رقم التحويلة",
          variant: "destructive",
        });
        return;
      }
    }

    setLoading(true);
    setTimeout(() => {
      // Persist mock request
      try {
        const key = "callcenter:reset_requests";
        const list = JSON.parse(localStorage.getItem(key) || "[]");
        list.unshift({
          id: `R-${Date.now()}`,
          method,
          email: method === "email" ? email : undefined,
          ext: method === "supervisor" ? ext : undefined,
          reason: method === "supervisor" ? reason : undefined,
          ts: Date.now(),
          status: "pending",
        });
        localStorage.setItem(key, JSON.stringify(list.slice(0, 50)));
      } catch {}

      setLoading(false);
      setSent(true);
      toast({
        title: "تم الإرسال",
        description:
          method === "email"
            ? "تحقق من بريدك للحصول على رابط إعادة التعيين"
            : "تم إرسال طلبك إلى المشرف",
      });
    }, 700);
  };

  return (
    <main
      dir="rtl"
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
    >
      <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-accent/20 blur-3xl" />

      <div className="w-full max-w-md anim-scale-in relative z-10">
        {/* Logo + title */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-2xl gradient-primary shadow-glow flex items-center justify-center mb-4 p-3">
            <img
              src={logo}
              alt="شعار حلول البيان"
              className="w-full h-full object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold text-gradient tracking-tight">
            استعادة كلمة السر
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            اختر طريقة استعادة كلمة السر المناسبة لك
          </p>
        </div>

        <div className="glass-card p-6 sm:p-7 shadow-elegant">
          {sent ? (
            <div className="text-center py-6 anim-fade-in">
              <div className="w-16 h-16 mx-auto rounded-full bg-success/15 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8 text-success" />
              </div>
              <h2 className="text-lg font-semibold mb-2">تم استلام طلبك</h2>
              <p className="text-sm text-muted-foreground mb-6">
                {method === "email"
                  ? `أرسلنا رابط إعادة التعيين إلى ${email}. تحقق من صندوق الوارد.`
                  : "سيقوم المشرف بمراجعة طلبك وإعادة تعيين كلمة السر قريباً."}
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link to="/login">
                  <ArrowRight className="w-4 h-4 ml-2" />
                  العودة لتسجيل الدخول
                </Link>
              </Button>
            </div>
          ) : (
            <>
              {/* Method tabs */}
              <div className="grid grid-cols-2 gap-2 mb-6 p-1 rounded-lg bg-muted">
                <button
                  type="button"
                  onClick={() => setMethod("email")}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                    method === "email"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Mail className="w-4 h-4" />
                  عبر البريد
                </button>
                <button
                  type="button"
                  onClick={() => setMethod("supervisor")}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                    method === "supervisor"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <UserCog className="w-4 h-4" />
                  طلب من المشرف
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {method === "email" ? (
                  <div className="space-y-2">
                    <Label htmlFor="email">البريد الإلكتروني</Label>
                    <div className="relative">
                      <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="name@bayan.sa"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pr-10"
                        autoComplete="email"
                        maxLength={120}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      سنرسل لك رابطاً لإعادة تعيين كلمة السر.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="ext">رقم التحويلة</Label>
                      <div className="relative">
                        <KeyRound className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          id="ext"
                          type="text"
                          inputMode="numeric"
                          placeholder="مثال: 1023"
                          value={ext}
                          onChange={(e) => setExt(e.target.value)}
                          className="pr-10"
                          maxLength={10}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reason">سبب الطلب (اختياري)</Label>
                      <textarea
                        id="reason"
                        rows={3}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="مثال: نسيت كلمة السر بعد إجازة"
                        maxLength={300}
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                      />
                      <p className="text-xs text-muted-foreground">
                        سيصل الطلب إلى مشرفك المباشر للموافقة.
                      </p>
                    </div>
                  </>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full gradient-primary text-primary-foreground hover:opacity-90 h-11"
                >
                  <Send className="w-4 h-4 ml-2" />
                  {loading
                    ? "جاري الإرسال..."
                    : method === "email"
                      ? "إرسال رابط الاستعادة"
                      : "إرسال الطلب للمشرف"}
                </Button>
              </form>
            </>
          )}

          <div className="mt-6 pt-4 border-t border-border/60 text-center">
            <Link
              to="/login"
              className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
            >
              <ArrowRight className="w-3 h-3" />
              العودة لتسجيل الدخول
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          © {new Date().getFullYear()} Hulul Abayan
        </p>
      </div>
    </main>
  );
};

export default ForgotPassword;
