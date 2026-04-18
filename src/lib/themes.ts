export type ThemeId =
  | "turquoise"
  | "ocean"
  | "violet"
  | "rose"
  | "sunset"
  | "forest"
  | "gold"
  | "crimson"
  | "midnight"
  | "slate";

export interface ThemeOption {
  id: ThemeId;
  name: string;
  swatch: string; // tailwind gradient classes for the swatch
}

export const THEMES: ThemeOption[] = [
  { id: "turquoise", name: "تركواز", swatch: "from-teal-500 to-emerald-400" },
  { id: "ocean", name: "محيطي", swatch: "from-sky-500 to-cyan-400" },
  { id: "violet", name: "بنفسجي", swatch: "from-violet-500 to-fuchsia-500" },
  { id: "rose", name: "وردي", swatch: "from-rose-500 to-orange-400" },
  { id: "sunset", name: "غروب", swatch: "from-orange-500 to-amber-400" },
  { id: "forest", name: "غابة", swatch: "from-emerald-600 to-lime-500" },
  { id: "gold", name: "ذهبي", swatch: "from-amber-500 to-yellow-400" },
  { id: "crimson", name: "قرمزي", swatch: "from-red-600 to-pink-500" },
  { id: "midnight", name: "منتصف الليل", swatch: "from-indigo-600 to-blue-500" },
  { id: "slate", name: "رمادي", swatch: "from-slate-600 to-slate-400" },
];

const THEME_KEY = "hb-theme";
const MODE_KEY = "hb-mode";

export function applyTheme(id: ThemeId) {
  const root = document.documentElement;
  if (id === "turquoise") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", id);
  }
  localStorage.setItem(THEME_KEY, id);
}

export function getInitialTheme(): ThemeId {
  return (localStorage.getItem(THEME_KEY) as ThemeId) || "turquoise";
}

export function applyMode(mode: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  localStorage.setItem(MODE_KEY, mode);
}

export function getInitialMode(): "light" | "dark" {
  return (localStorage.getItem(MODE_KEY) as "light" | "dark") || "light";
}
