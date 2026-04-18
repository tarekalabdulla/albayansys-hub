import { Menu, Search, Bell, Sun, Moon, Palette, Check } from "lucide-react";
import { useEffect, useState } from "react";
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
import {
  applyMode,
  applyTheme,
  getInitialMode,
  getInitialTheme,
  THEMES,
  type ThemeId,
} from "@/lib/themes";
import { cn } from "@/lib/utils";

interface TopbarProps {
  onMenuClick: () => void;
  title: string;
  subtitle?: string;
}

export function Topbar({ onMenuClick, title, subtitle }: TopbarProps) {
  const [mode, setMode] = useState<"light" | "dark">("light");
  const [theme, setTheme] = useState<ThemeId>("turquoise");

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

        {/* Search */}
        <div className="flex-1 max-w-md mx-auto hidden sm:block">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="ابحث عن موظف، مكالمة، تحويلة..."
              className="pr-10 bg-background/60 border-border/60 focus-visible:ring-primary/40"
            />
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

          {/* Notifications */}
          <Button variant="ghost" size="icon" className="relative" aria-label="الإشعارات">
            <Bell className="w-5 h-5" />
            <span className="absolute top-2 left-2 w-2 h-2 rounded-full bg-destructive ring-2 ring-background" />
          </Button>

          {/* Avatar */}
          <div className="hidden sm:flex w-9 h-9 rounded-full gradient-primary items-center justify-center text-sm font-bold text-primary-foreground shadow-soft mr-1">
            س.ع
          </div>
        </div>
      </div>
    </header>
  );
}
