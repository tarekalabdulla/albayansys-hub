// طبقة بيانات موحّدة: تستخدم API الحقيقي عند USE_REAL_API، وإلا تعود لـ localStorage
import { api } from "./api";
import { USE_REAL_API } from "./config";

// ============================================================
// USERS
// ============================================================
export type UserRole = "admin" | "supervisor" | "agent";

export interface ApiUser {
  id: string;
  identifier: string;
  email: string | null;
  name: string;
  role: UserRole;
  active: boolean;
  phone?: string | null;
  department?: string | null;
  ext?: string | null;
  bio?: string | null;
}

export const usersApi = {
  list: async (): Promise<ApiUser[]> => {
    const { data } = await api.get("/users");
    return data.users;
  },
  create: async (payload: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    active?: boolean;
    phone?: string;
    department?: string;
    ext?: string;
  }): Promise<ApiUser> => {
    const { data } = await api.post("/users", payload);
    return data.user;
  },
  update: async (id: string, payload: Partial<ApiUser> & { password?: string }): Promise<ApiUser> => {
    const { data } = await api.patch(`/users/${id}`, payload);
    return data.user;
  },
  remove: async (id: string): Promise<void> => {
    await api.delete(`/users/${id}`);
  },
  changePassword: async (oldPassword: string, newPassword: string): Promise<void> => {
    await api.patch("/users/me/password", { oldPassword, newPassword });
  },
};

// ============================================================
// SUPERVISORS
// ============================================================
export interface ApiSupervisor {
  id: string;
  name: string;
  email: string;
  ext: string;
  role: "مشرف" | "مشرف أول" | "مدير قسم";
  agentIds: string[];
}

export const supervisorsApi = {
  list: async (): Promise<ApiSupervisor[]> => {
    const { data } = await api.get("/supervisors");
    return data.supervisors;
  },
  get: async (id: string): Promise<ApiSupervisor | null> => {
    try {
      const { data } = await api.get(`/supervisors/${id}`);
      return data.supervisor;
    } catch {
      return null;
    }
  },
  create: async (payload: Omit<ApiSupervisor, "id"> & { id?: string }): Promise<ApiSupervisor> => {
    const { data } = await api.post("/supervisors", payload);
    return data.supervisor;
  },
  update: async (id: string, payload: Partial<ApiSupervisor>): Promise<ApiSupervisor> => {
    const { data } = await api.patch(`/supervisors/${id}`, payload);
    return data.supervisor;
  },
  remove: async (id: string): Promise<void> => {
    await api.delete(`/supervisors/${id}`);
  },
};

// ============================================================
// SETTINGS
// ============================================================
export type SettingsKey = "pbx_p_series" | "pbx_s_series" | "google_ai" | "webhook";

export const settingsApi = {
  getAll: async (): Promise<Record<SettingsKey, Record<string, unknown>>> => {
    const { data } = await api.get("/settings");
    return data.settings;
  },
  save: async (key: SettingsKey, value: Record<string, unknown>): Promise<void> => {
    await api.put(`/settings/${key}`, { value });
  },
};

export const isRealApi = USE_REAL_API;
