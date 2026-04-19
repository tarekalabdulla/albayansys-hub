import { api } from "./api";

export type ResetScope = "calls" | "alerts" | "mail" | "supervisors" | "stats";

export const adminApi = {
  resetAll: async (scopes?: ResetScope[]): Promise<{ ok: boolean; summary: Record<string, number> }> => {
    const { data } = await api.post("/admin/reset-all", scopes ? { scopes } : {});
    return data;
  },
};
