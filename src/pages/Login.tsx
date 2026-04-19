import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, LogIn, User, Lock } from "lucide-react";
import { isAuthenticated, setSession, loginViaApi, type Role, ROLE_LABELS } from "@/lib/auth";
import { USE_REAL_API } from "@/lib/config";
import logo from "@/assets/logo.png";

// قاعدة مستخدمين تجريبية ثابتة — تُستخدم فقط في وضع mock (بدون VPS)
const DEMO_USERS: Record<string, { password: string; role: Role }> = {
  admin:      { password: "admin123",      role: "admin" },
  supervisor: { password: "supervisor123", role: "supervisor" },
  agent:      { password: "agent123",      role: "agent" },
};

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) navigate("/", { replace: true });
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = identifier.trim().toLowerCase();
    const pwd = password.trim();
    if (!id || !pwd) {
      toast({
        title: "حقول ناقصة",
        description: "أدخل الاسم/التحويلة وكلمة السر",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);

    // ============ وضع API الحقيقي (VPS) ============
    if (USE_REAL_API) {
      try {
        const user = await loginViaApi(id, pwd);
        toast({
          title: "أهلاً بك",
          description: `تم تسجيل الدخول كـ ${ROLE_LABELS[user.role as Role]}`,
        });
        navigate("/");
      } catch (err: any) {
        toast({
          title: "بيانات غير صحيحة",
          description: err?.response?.data?.error === "invalid_credentials"
            ? "المستخدم أو كلمة السر غير صحيحة"
            : "تعذّر الاتصال بالخادم",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
      return;
    }

    // ============ وضع Mock (افتراضي) ============
    setTimeout(() => {
      const user = DEMO_USERS[id];
      if (!user || user.password !== pwd) {
        setLoading(false);
        toast({
          title: "بيانات غير صحيحة",
          description: "المستخدم أو كلمة السر غير صحيحة",
          variant: "destructive",
        });
        return;
      }
      setSession(id, user.role);
      toast({
        title: "أهلاً بك",
        description: `تم تسجيل الدخول كـ ${ROLE_LABELS[user.role]}`,
      });
      setLoading(false);
      navigate("/");
    }, 500);
  };

  return (
    <main
      dir="rtl"
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
    >
      <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-accent/20 blur-3xl" />

      <div className="w-full max-w-md anim-scale-in relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="w-24 h-24 rounded-2xl gradient-primary shadow-glow flex items-center justify-center mb-4 p-3">
            <img src={logo} alt="شعار حلول البيان" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-3xl font-bold text-gradient tracking-tight">Hulul Abayan</h1>
          <p className="text-sm text-muted-foreground mt-1">نظام إدارة مركز الاتصال</p>
        </div>

        <form onSubmit={handleSubmit} className="glass-card p-7 space-y-5 shadow-elegant">
          <div className="space-y-2">
            <Label htmlFor="identifier" className="text-sm">
              الاسم أو رقم التحويلة
            </Label>
            <div className="relative">
              <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="identifier"
                type="text"
                placeholder="admin / supervisor / agent"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="pr-10"
                autoComplete="username"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm">
              كلمة السر
            </Label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="password"
                type={showPwd ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10 pl-10"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="إظهار/إخفاء"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-2 cursor-pointer text-muted-foreground">
              <input type="checkbox" className="accent-primary" />
              تذكرني
            </label>
            <Link to="/forgot-password" className="text-primary hover:underline">
              نسيت كلمة السر؟
            </Link>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full gradient-primary text-primary-foreground hover:opacity-90 h-11 text-base"
          >
            <LogIn className="w-4 h-4 ml-2" />
            {loading ? "جاري الدخول..." : "تسجيل الدخول"}
          </Button>

          <p className="text-[11px] text-muted-foreground text-center leading-relaxed pt-2 border-t border-border/40">
            بيانات تجريبية: <span dir="ltr">admin / supervisor / agent</span> — كلمة السر = اسم المستخدم + 123
          </p>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">
          © {new Date().getFullYear()} Hulul Abayan — جميع الحقوق محفوظة
        </p>
      </div>
    </main>
  );
};

export default Login;
