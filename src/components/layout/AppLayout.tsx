import { useCallback, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { useIdleTimeout } from "@/hooks/useIdleTimeout";
import { clearSession } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

interface AppLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 ساعات
const WARNING_BEFORE_MS = 60 * 1000; // دقيقة قبل الخروج

export function AppLayout({ children, title, subtitle }: AppLayoutProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { toast, dismiss } = useToast();
  const warningToastIdRef = useRef<string | null>(null);

  const dismissWarning = useCallback(() => {
    if (warningToastIdRef.current) {
      dismiss(warningToastIdRef.current);
      warningToastIdRef.current = null;
    }
  }, [dismiss]);

  const handleWarning = useCallback(() => {
    dismissWarning();
    const t = toast({
      title: "تنبيه: ستنتهي الجلسة قريباً",
      description: "سيتم تسجيل خروجك خلال دقيقة بسبب عدم النشاط. حرّك الفأرة أو اضغط أي مفتاح للاستمرار.",
      variant: "destructive",
      duration: WARNING_BEFORE_MS,
    }) as ReturnType<typeof toast>;
    warningToastIdRef.current = (t as { id: string }).id;
  }, [toast, dismissWarning]);

  const handleTimeout = useCallback(() => {
    dismissWarning();
    clearSession();
    toast({
      title: "انتهت الجلسة",
      description: "تم تسجيل خروجك تلقائياً بسبب عدم النشاط لمدة 8 ساعات.",
    });
    navigate("/login", { replace: true });
  }, [dismissWarning, navigate, toast]);

  useIdleTimeout({
    timeout: IDLE_TIMEOUT_MS,
    warningBefore: WARNING_BEFORE_MS,
    onWarning: handleWarning,
    onTimeout: handleTimeout,
    onReset: dismissWarning,
  });

  return (
    <div className="min-h-screen flex w-full">
      <AppSidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onMenuClick={() => setOpen(true)} title={title} subtitle={subtitle} />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
