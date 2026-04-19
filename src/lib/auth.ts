// نظام جلسة وأدوار مبني على localStorage (للعرض)
const SESSION_KEY = "callcenter:session";

export type Role = "admin" | "supervisor" | "agent";

export interface Session {
  identifier: string;
  role: Role;
  ts: number;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "مدير",
  supervisor: "مشرف",
  agent: "موظف",
};

// خريطة المسارات → الأدوار المسموح لها بالوصول
export const ROUTE_PERMISSIONS: Record<string, Role[]> = {
  "/": ["admin", "supervisor", "agent"],
  "/live": ["admin", "supervisor", "agent"],
  "/monitoring": ["admin", "supervisor"],
  "/performance": ["admin", "supervisor"],
  "/alerts": ["admin", "supervisor"],
  "/ai": ["admin", "supervisor"],
  "/recordings": ["admin", "supervisor", "agent"],
  "/mail": ["admin", "supervisor", "agent"],
  "/supervisors": ["admin"],
  "/supervisors/:id": ["admin", "supervisor"],
  "/profile": ["admin", "supervisor", "agent"],
  "/settings": ["admin"],
};

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.identifier) return null;
    // الجلسات القديمة بدون دور تُعتبر "موظف" (الأدنى صلاحية)
    if (!parsed.role) parsed.role = "agent";
    return parsed;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}

export function getRole(): Role | null {
  return getSession()?.role ?? null;
}

export function hasRole(...roles: Role[]): boolean {
  const r = getRole();
  return r !== null && roles.includes(r);
}

export function setSession(identifier: string, role: Role) {
  const session: Session = { identifier, role, ts: Date.now() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
