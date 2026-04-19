import { api } from "./api";

export interface Supervisor {
  id: string;
  name: string;
  email: string;
  ext: string;
  role: string;
  agentIds: string[];
}

export const supervisorsApi = {
  list: async (): Promise<Supervisor[]> => {
    const { data } = await api.get("/supervisors");
    return data.supervisors || [];
  },

  get: async (id: string): Promise<Supervisor | null> => {
    try {
      const { data } = await api.get(`/supervisors/${id}`);
      return data.supervisor;
    } catch {
      return null;
    }
  },

  create: async (s: Omit<Supervisor, "id"> & { id?: string }): Promise<string> => {
    const { data } = await api.post("/supervisors", s);
    return data.id;
  },

  update: async (id: string, s: Omit<Supervisor, "id">): Promise<void> => {
    await api.put(`/supervisors/${id}`, s);
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/supervisors/${id}`);
  },
};
