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
  avatarUrl?: string;
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
  "/users": ["admin"],
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

export function setSession(identifier: string, role: Role, displayName?: string, avatarUrl?: string) {
  const prev = getSession();
  const session: Session = {
    identifier,
    role,
    ts: Date.now(),
    displayName,
    avatarUrl: avatarUrl !== undefined ? avatarUrl : prev?.avatarUrl,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  // أعلم الواجهة بأي تغيير (Topbar/Sidebar)
  try { window.dispatchEvent(new CustomEvent("session:updated")); } catch {}
}

// رابط كامل للصورة (يجمع API_URL مع المسار النسبي /uploads/...)
export function resolveAvatarUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  // نستورد من config محلياً لتفادي circular import
  const base = (import.meta.env.VITE_API_URL as string | undefined) || "";
  return `${base}${url}`;
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

// شكل الملف الشخصي الكامل من الخادم
export interface ProfileFromApi {
  id: string;
  identifier: string;
  role: Role;
  display_name: string | null;
  email: string | null;
  ext: string | null;
  department: string | null;
  phone: string | null;
  bio: string | null;
  job_title: string | null;
  avatar_url: string | null;
}

// جلب الملف الشخصي الكامل
export async function fetchProfileViaApi(): Promise<ProfileFromApi> {
  const { data } = await api.get("/auth/me");
  return data.user;
}

// رفع صورة شخصية
export async function uploadAvatarViaApi(file: File): Promise<ProfileFromApi> {
  const fd = new FormData();
  fd.append("avatar", file);
  const { data } = await api.post("/auth/avatar", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data.user;
}

// حذف الصورة الشخصية
export async function deleteAvatarViaApi(): Promise<ProfileFromApi> {
  const { data } = await api.delete("/auth/avatar");
  return data.user;
}

// تحديث بيانات الملف الشخصي على الخادم
export async function updateProfileViaApi(payload: {
  display_name?: string;
  email?: string;
  ext?: string;
  department?: string;
  phone?: string;
  bio?: string;
  job_title?: string;
}): Promise<ProfileFromApi> {
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
