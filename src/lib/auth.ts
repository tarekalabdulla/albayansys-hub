// نظام جلسة بسيط مبني على localStorage
const SESSION_KEY = "callcenter:session";

export interface Session {
  identifier: string;
  ts: number;
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.identifier) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
