import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, LogIn, User, Lock } from "lucide-react";
import logo from "@/assets/logo.png";

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password.trim()) {
      toast({
        title: "حقول ناقصة",
        description: "أدخل الاسم/التحويلة وكلمة السر",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    setTimeout(() => {
      localStorage.setItem(
        "callcenter:session",
        JSON.stringify({ identifier, ts: Date.now() }),
      );
      toast({ title: "أهلاً بك", description: "تم تسجيل الدخول بنجاح" });
      setLoading(false);
      navigate("/");
    }, 500);
  };

  return (
    <main
      dir="rtl"
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
    >
      {/* Decorative blobs */}
      <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-accent/20 blur-3xl" />

      <div className="w-full max-w-md anim-scale-in relative z-10">
        {/* Logo + title */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-24 h-24 rounded-2xl gradient-primary shadow-glow flex items-center justify-center mb-4 p-3">
            <img
              src={logo}
              alt="شعار حلول البيان"
              className="w-full h-full object-contain"
            />
          </div>
          <h1 className="text-3xl font-bold text-gradient tracking-tight">
            Hulul Abayan
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            نظام إدارة مركز الاتصال
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="glass-card p-7 space-y-5 shadow-elegant"
        >
          <div className="space-y-2">
            <Label htmlFor="identifier" className="text-sm">
              الاسم أو رقم التحويلة
            </Label>
            <div className="relative">
              <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="identifier"
                type="text"
                placeholder="مثال: أحمد أو 1023"
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
            <Link
              to="/forgot-password"
              className="text-primary hover:underline"
            >
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
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">
          © {new Date().getFullYear()} Hulul Abayan — جميع الحقوق محفوظة
        </p>
      </div>
    </main>
  );
};

export default Login;
