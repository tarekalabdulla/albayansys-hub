import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Activity,
  MonitorPlay,
  BarChart3,
  Sparkles,
  Mic,
  Mail,
  Settings,
  PhoneCall,
  UserCog,
  User,
  Bell,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getRole, getSession, ROLE_LABELS, resolveAvatarUrl, type Role } from "@/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
  roles: Role[];
}

const NAV: NavItem[] = [
  { to: "/", label: "لوحة المعلومات", icon: LayoutDashboard, end: true, roles: ["admin", "supervisor", "agent"] },
  { to: "/live", label: "التقرير الحي", icon: Activity, roles: ["admin", "supervisor", "agent"] },
  { to: "/monitoring", label: "مراقبة الموظفين", icon: MonitorPlay, roles: ["admin", "supervisor"] },
  { to: "/performance", label: "جدول الأداء", icon: BarChart3, roles: ["admin", "supervisor"] },
  { to: "/alerts", label: "الإشعارات التنبيهية", icon: Bell, roles: ["admin", "supervisor"] },
  { to: "/supervisors", label: "إدارة المشرفين", icon: UserCog, roles: ["admin"] },
  { to: "/users", label: "إدارة المستخدمين", icon: Users, roles: ["admin"] },
  { to: "/ai", label: "تحليل الذكاء الاصطناعي", icon: Sparkles, roles: ["admin", "supervisor"] },
  { to: "/recordings", label: "تسجيلات المكالمات", icon: Mic, roles: ["admin", "supervisor", "agent"] },
  { to: "/mail", label: "البريد الداخلي", icon: Mail, roles: ["admin", "supervisor", "agent"] },
  { to: "/profile", label: "ملفي الشخصي", icon: User, roles: ["admin", "supervisor", "agent"] },
  { to: "/settings", label: "الإعدادات", icon: Settings, roles: ["admin"] },
];

interface AppSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function AppSidebar({ open, onClose }: AppSidebarProps) {
  const role = getRole();
  const visibleNav = NAV.filter((item) => role && item.roles.includes(role));
  const roleLabel = role ? ROLE_LABELS[role] : "زائر";

  const [session, setSession] = useState(getSession());
  useEffect(() => {
    const onUpd = () => setSession(getSession());
    window.addEventListener("session:updated", onUpd);
    return () => window.removeEventListener("session:updated", onUpd);
  }, []);
  const avatarSrc = resolveAvatarUrl(session?.avatarUrl);
  const displayName = session?.displayName || session?.identifier || "—";
  const initials = displayName.split(" ").map((s) => s[0]).join("").slice(0, 2);

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm lg:hidden transition-opacity",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 w-72 gradient-sidebar text-sidebar-foreground",
          "border-l border-sidebar-border shadow-elegant",
          "transition-transform duration-300 ease-out",
          "lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex items-center gap-3 px-6 py-6 border-b border-sidebar-border">
          <div className="w-11 h-11 rounded-xl gradient-primary grid place-items-center shadow-glow">
            <PhoneCall className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-sidebar-foreground leading-tight">حلول البيان</h1>
            <p className="text-[11px] text-sidebar-foreground/60">Call Center Suite</p>
          </div>
        </div>

        <nav className="px-3 py-4 space-y-1 overflow-y-auto h-[calc(100vh-180px)]">
          <p className="px-3 mb-2 text-[10px] font-bold tracking-wider text-sidebar-foreground/40">
            القائمة الرئيسية
          </p>
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium",
                  "transition-all duration-200",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-glow"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )
              }
            >
              <item.icon className="w-[18px] h-[18px] shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="absolute bottom-0 inset-x-0 p-4 border-t border-sidebar-border">
          <div className="glass rounded-xl p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full gradient-primary grid place-items-center text-sm font-bold text-primary-foreground">
              س.ع
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-sidebar-foreground truncate">سلمان العامر</p>
              <p className="text-[11px] text-sidebar-foreground/60">{roleLabel}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
