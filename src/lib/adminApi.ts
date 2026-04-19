import { api, tokenStorage } from "./api";
import { API_URL } from "./config";

export type ResetScope = "calls" | "alerts" | "mail" | "supervisors" | "stats";
export type BackupFormat = "plain" | "custom";

export const adminApi = {
  resetAll: async (scopes?: ResetScope[]): Promise<{ ok: boolean; summary: Record<string, number> }> => {
    const { data } = await api.post("/admin/reset-all", scopes ? { scopes } : {});
    return data;
  },

  // تنزيل نسخة احتياطية كاملة (SQL dump) — fetch لدعم streaming + Authorization
  downloadBackup: async (format: BackupFormat = "plain"): Promise<void> => {
    const token = tokenStorage.get();
    const res = await fetch(`${API_URL}/api/admin/backup?format=${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        msg = j.error || msg;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") || "";
    const m = cd.match(/filename="?([^"]+)"?/);
    const filename = m?.[1] || `hulul-backup-${Date.now()}.${format === "custom" ? "dump" : "sql"}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
