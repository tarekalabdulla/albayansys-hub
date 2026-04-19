// نظام جلسة وأدوار يدعم وضعين:
//   - Mock (افتراضي): localStorage فقط، بيانات DEMO من Login.tsx
//   - Real API: JWT حقيقي من backend على VPS
// يتم التحويل عبر VITE_USE_REAL_API في .env
import { USE_REAL_API } from "./config";
import { api, tokenStorage } from "./api";

const SESSION_KEY = "callcenter:session";

export type Role = "admin" | "supervisor" | "agent";

export interface Session {
  identifier: string;
  role: Role;
  ts: number;
  displayName?: string;
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
    if (!parsed.role) parsed.role = "agent";
    return parsed;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  if (USE_REAL_API) return !!tokenStorage.get() && !!getSession();
  return getSession() !== null;
}

export function getRole(): Role | null {
  return getSession()?.role ?? null;
}

export function hasRole(...roles: Role[]): boolean {
  const r = getRole();
  return r !== null && roles.includes(r);
}

export function setSession(identifier: string, role: Role, displayName?: string) {
  const session: Session = { identifier, role, ts: Date.now(), displayName };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  tokenStorage.clear();
}

// ============================================================
// Login عبر API الحقيقي — يُستخدم فقط عند USE_REAL_API
// ============================================================
export async function loginViaApi(identifier: string, password: string) {
  const { data } = await api.post("/auth/login", { identifier, password });
  tokenStorage.set(data.token);
  setSession(data.user.identifier, data.user.role, data.user.display_name);
  return data.user;
}

export async function logoutViaApi() {
  try {
    await api.post("/auth/logout");
  } catch {
    /* ignore */
  } finally {
    clearSession();
  }
}

// تحديث بيانات الملف الشخصي على الخادم
export async function updateProfileViaApi(payload: { display_name?: string }) {
  const { data } = await api.patch("/auth/me", payload);
  const current = getSession();
  if (current) {
    setSession(current.identifier, current.role, data.user.display_name);
  }
  return data.user;
}

// تغيير كلمة السر على الخادم
export async function changePasswordViaApi(current_password: string, new_password: string) {
  await api.post("/auth/change-password", { current_password, new_password });
}
