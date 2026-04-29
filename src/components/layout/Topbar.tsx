import { Menu, Search, Bell, Sun, Moon, Palette, Check, Mail, Star, Paperclip, Inbox, AlertOctagon, AlertTriangle, Info, CheckCheck, ArrowLeft, LogOut, UserRound, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  applyMode,
  applyTheme,
  getInitialMode,
  getInitialTheme,
  THEMES,
  type ThemeId,
} from "@/lib/themes";
import { formatMailDate, priorityMeta, type InternalMail } from "@/lib/mailData";
import { clearSession, getSession, ROLE_LABELS } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useLiveAgents } from "@/hooks/useLiveAgents";

import { cn } from "@/lib/utils";

interface TopbarProps {
  onMenuClick: () => void;
  title: string;
  subtitle?: string;
}

export function Topbar({ onMenuClick, title, subtitle }: TopbarProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const session = getSession();
  const agents = useLiveAgents();
  const [mode, setMode] = useState<"light" | "dark">("light");
  const [theme, setTheme] = useState<ThemeId>("turquoise");
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const filteredAgents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return [];
    return agents
      .filter((a) =>
        a.name.toLowerCase().includes(q) ||
        (a.ext || "").toLowerCase().includes(q) ||
        (a.id || "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [agents, searchTerm]);

  const goToAgent = (agentId: string) => {
    setSearchTerm("");
    setSearchOpen(false);
    navigate(`/performance?agent=${encodeURIComponent(agentId)}`);
  };

  const handleLogout = () => {
    clearSession();
    toast({ title: "تم تسجيل الخروج", description: "إلى اللقاء" });
    navigate("/login", { replace: true });
  };

  useEffect(() => {
    const m = getInitialMode();
    const t = getInitialTheme();
    setMode(m);
    setTheme(t);
    applyMode(m);
    applyTheme(t);
  }, []);

  const toggleMode = () => {
    const next = mode === "light" ? "dark" : "light";
    setMode(next);
    applyMode(next);
  };

  const setT = (id: ThemeId) => {
    setTheme(id);
    applyTheme(id);
  };

  // الرسائل غير المقروءة في الوارد — في وضع REAL_API لا نعرض بيانات mock
  const inboxMails: InternalMail[] = [];
  const unreadCount = inboxMails.filter((m) => !m.read).length;
  const latestThree = [...inboxMails]
    .sort((a, b) => +new Date(b.date) - +new Date(a.date))
    .slice(0, 3);

  // التنبيهات: قائمة محلية مع حالة "مقروء"
  type AlertItem = {
    id: string;
    level: "danger" | "warning" | "info";
    title: string;
    message: string;
    time: string;
  };
  // التنبيهات الحقيقية تأتي من Socket في صفحة /alerts
  const initialAlerts: AlertItem[] = useMemo(() => [], []);
  const [readAlerts, setReadAlerts] = useState<Set<string>>(new Set());
  const unreadAlertsCount = initialAlerts.filter((a) => !readAlerts.has(a.id)).length;
  const markAllAlertsRead = () => setReadAlerts(new Set(initialAlerts.map((a) => a.id)));

  return (
    <header className="sticky top-0 z-30 glass border-b border-border/60">
      <div className="flex items-center gap-3 px-4 sm:px-6 h-16">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onMenuClick}
          aria-label="فتح القائمة"
        >
          <Menu className="w-5 h-5" />
        </Button>

        <div className="hidden md:block">
          <h2 className="text-lg font-bold leading-tight">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>

        {/* Search — يبحث في الموظفين الأحياء */}
        <div className="flex-1 max-w-md mx-auto hidden sm:block">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filteredAgents[0]) goToAgent(filteredAgents[0].id);
                if (e.key === "Escape") { setSearchTerm(""); setSearchOpen(false); }
              }}
              placeholder="ابحث عن موظف، مكالمة، تحويلة..."
              className="pr-10 bg-background/60 border-border/60 focus-visible:ring-primary/40"
            />

            {searchOpen && searchTerm.trim() && (
              <div className="absolute top-full mt-1.5 right-0 left-0 z-50 rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
                {filteredAgents.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                    لا توجد نتائج لـ "{searchTerm}"
                  </div>
                ) : (
                  <ul className="max-h-72 overflow-y-auto py-1">
                    {filteredAgents.map((a) => (
                      <li key={a.id}>
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => goToAgent(a.id)}
                          className="w-full flex items-center gap-3 px-3 py-2 text-right hover:bg-muted/60 transition-colors"
                        >
                          <div className="w-8 h-8 rounded-lg gradient-primary grid place-items-center text-[10px] font-bold text-primary-foreground shrink-0">
                            {a.avatar || a.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold truncate">{a.name}</p>
                            <p className="text-[10px] text-muted-foreground" dir="ltr">
                              ext: {a.ext} · {a.id}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                              a.status === "in_call" && "bg-primary/15 text-primary",
                              a.status === "online" && "bg-success/15 text-success",
                              a.status === "idle" && "bg-warning/15 text-warning",
                              a.status === "break" && "bg-info/15 text-info",
                              a.status === "offline" && "bg-muted text-muted-foreground",
                            )}
                          >
                            {a.status}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mr-auto flex items-center gap-1.5">
          {/* Theme picker */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="اختر الثيم">
                <Palette className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>اختر تدرج الألوان</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="grid grid-cols-5 gap-2 p-2">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setT(t.id)}
                    title={t.name}
                    className={cn(
                      "relative h-9 rounded-lg bg-gradient-to-br",
                      t.swatch,
                      "ring-2 ring-transparent hover:ring-foreground/20 transition",
                      theme === t.id && "ring-foreground/60",
                    )}
                  >
                    {theme === t.id && (
                      <Check className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow" />
                    )}
                  </button>
                ))}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-xs text-muted-foreground" disabled>
                الثيم الحالي: {THEMES.find((t) => t.id === theme)?.name}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Dark mode */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMode}
            aria-label="الوضع الليلي"
          >
            {mode === "light" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
          </Button>

          {/* Mail dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative" aria-label="البريد الداخلي">
                <Mail className="w-5 h-5" />
                {unreadCount > 0 && (
                  <>
                    <span className="absolute top-1.5 left-1.5 w-2.5 h-2.5 rounded-full bg-destructive ring-2 ring-background animate-pulse" />
                    <span className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-extrabold ring-2 ring-background">
                      {unreadCount}
                    </span>
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-0">
              {/* رأس */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-l from-primary/10 to-transparent">
                <div className="flex items-center gap-2">
                  <Inbox className="w-4 h-4 text-primary" />
                  <span className="text-sm font-bold">البريد الوارد</span>
                </div>
                {unreadCount > 0 && (
                  <Badge className="bg-destructive text-destructive-foreground text-[10px] h-5">
                    {unreadCount} جديدة
                  </Badge>
                )}
              </div>

              {/* قائمة آخر ٣ */}
              <div className="max-h-[320px] overflow-y-auto">
                {latestThree.length === 0 && (
                  <div className="text-center py-8 text-xs text-muted-foreground">
                    لا توجد رسائل
                  </div>
                )}
                {latestThree.map((m) => {
                  const prio = priorityMeta(m.priority);
                  return (
                    <button
                      key={m.id}
                      onClick={() => navigate("/mail")}
                      className={cn(
                        "w-full text-right px-4 py-3 border-b border-border/60 transition-colors flex gap-3 hover:bg-muted/50",
                        !m.read && "bg-info/5",
                      )}
                    >
                      <div className="w-9 h-9 rounded-full gradient-primary grid place-items-center text-[10px] font-bold text-primary-foreground shrink-0">
                        {m.from.avatar}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className={cn("text-xs truncate", !m.read ? "font-extrabold" : "font-semibold")}>
                            {m.from.name}
                          </p>
                          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                            {formatMailDate(m.date)}
                          </span>
                        </div>
                        <p className={cn(
                          "text-[11px] truncate mb-1",
                          !m.read ? "font-bold text-foreground" : "text-foreground/75",
                        )}>
                          {m.subject}
                        </p>
                        <div className="flex items-center gap-1.5">
                          {!m.read && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                          {m.starred && <Star className="w-3 h-3 fill-warning text-warning" />}
                          {m.attachments && m.attachments.length > 0 && (
                            <Paperclip className="w-3 h-3 text-muted-foreground" />
                          )}
                          <Badge variant="outline" className={cn("text-[9px] h-4 px-1.5", prio.cls)}>
                            {prio.label}
                          </Badge>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* تذييل */}
              <button
                onClick={() => navigate("/mail")}
                className="w-full px-4 py-2.5 text-xs font-bold text-primary hover:bg-primary/5 transition-colors border-t border-border"
              >
                عرض كل الرسائل ←
              </button>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Notifications dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative"
                aria-label="الإشعارات التنبيهية"
              >
                <Bell className="w-5 h-5" />
                {unreadAlertsCount > 0 && (
                  <>
                    <span className="absolute top-1.5 left-1.5 w-2.5 h-2.5 rounded-full bg-destructive ring-2 ring-background animate-pulse" />
                    <span className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-extrabold ring-2 ring-background">
                      {unreadAlertsCount}
                    </span>
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-0">
              {/* رأس */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-l from-destructive/10 to-transparent">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-destructive" />
                  <span className="text-sm font-bold">آخر التنبيهات</span>
                </div>
                {unreadAlertsCount > 0 && (
                  <Badge className="bg-destructive text-destructive-foreground text-[10px] h-5">
                    {unreadAlertsCount} جديدة
                  </Badge>
                )}
              </div>

              {/* قائمة التنبيهات */}
              <div className="max-h-[320px] overflow-y-auto">
                {initialAlerts.map((a) => {
                  const isRead = readAlerts.has(a.id);
                  const Icon =
                    a.level === "danger" ? AlertOctagon : a.level === "warning" ? AlertTriangle : Info;
                  const colorCls =
                    a.level === "danger"
                      ? "bg-destructive/15 text-destructive"
                      : a.level === "warning"
                      ? "bg-warning/15 text-warning"
                      : "bg-info/15 text-info";
                  const borderCls =
                    a.level === "danger"
                      ? "border-r-destructive"
                      : a.level === "warning"
                      ? "border-r-warning"
                      : "border-r-info";
                  return (
                    <button
                      key={a.id}
                      onClick={() => setReadAlerts((p) => new Set(p).add(a.id))}
                      className={cn(
                        "w-full text-right px-4 py-3 border-b border-border/60 border-r-4 transition-colors flex gap-3 hover:bg-muted/50",
                        borderCls,
                        !isRead && "bg-destructive/5",
                      )}
                    >
                      <div className={cn("w-9 h-9 rounded-lg grid place-items-center shrink-0", colorCls)}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className={cn("text-xs truncate", !isRead ? "font-extrabold" : "font-semibold")}>
                            {a.title}
                          </p>
                          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                            {a.time}
                          </span>
                        </div>
                        <p className={cn(
                          "text-[11px] truncate",
                          !isRead ? "font-bold text-foreground" : "text-foreground/70",
                        )}>
                          {a.message}
                        </p>
                        {!isRead && (
                          <span className="inline-block mt-1 w-1.5 h-1.5 rounded-full bg-destructive" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* تذييل */}
              <div className="grid grid-cols-2 border-t border-border">
                <button
                  onClick={markAllAlertsRead}
                  disabled={unreadAlertsCount === 0}
                  className="px-3 py-2.5 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 border-l border-border"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  تعليم الكل كمقروء
                </button>
                <button
                  onClick={() => navigate("/alerts")}
                  className="px-3 py-2.5 text-xs font-bold text-primary hover:bg-primary/5 transition-colors flex items-center justify-center gap-1.5"
                >
                  فتح صفحة التنبيهات
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Logout — زر مستقل ظاهر */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLogoutOpen(true)}
            className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
            aria-label="تسجيل الخروج"
            title="تسجيل الخروج"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden md:inline text-xs font-bold">خروج</span>
          </Button>

          {/* Avatar — قائمة منسدلة (الملف الشخصي / الإعدادات / تسجيل الخروج) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="hidden sm:flex w-9 h-9 rounded-full gradient-primary items-center justify-center text-sm font-bold text-primary-foreground shadow-soft mr-1 hover:scale-105 transition-transform"
                aria-label="قائمة المستخدم"
                title={session?.identifier ?? "المستخدم"}
              >
                س.ع
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col gap-1">
                <span className="text-sm font-bold">
                  {session?.identifier ?? "المستخدم"}
                </span>
                <Badge
                  variant="outline"
                  className="self-start text-[10px] h-5 px-2 bg-primary/10 text-primary border-primary/30 font-bold"
                >
                  {session ? ROLE_LABELS[session.role] : "زائر"}
                </Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/profile")} className="gap-2">
                <UserRound className="w-4 h-4" />
                الملف الشخصي
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/settings")} className="gap-2">
                <SettingsIcon className="w-4 h-4" />
                الإعدادات
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setLogoutOpen(true);
                }}
                className="gap-2 text-destructive focus:text-destructive"
              >
                <LogOut className="w-4 h-4" />
                تسجيل الخروج
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Confirm logout dialog */}
      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد تسجيل الخروج</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من رغبتك في تسجيل الخروج من النظام؟ ستحتاج إلى إعادة إدخال بيانات الدخول للوصول إلى لوحة التحكم.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLogout}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <LogOut className="w-4 h-4 ml-1.5" />
              تأكيد الخروج
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
