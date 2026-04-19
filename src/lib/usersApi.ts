// API لإدارة المستخدمين (admin only)
import { api } from "./api";
import type { Role } from "./auth";

export interface ManagedUser {
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
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateUserPayload {
  identifier: string;
  password: string;
  role: Role;
  display_name: string;
  email?: string;
  ext?: string;
  department?: string;
  phone?: string;
  job_title?: string;
  is_active?: boolean;
}

export interface UpdateUserPayload {
  password?: string;
  role?: Role;
  display_name?: string;
  email?: string;
  ext?: string;
  department?: string;
  phone?: string;
  bio?: string;
  job_title?: string;
  is_active?: boolean;
}

export async function listUsers(): Promise<ManagedUser[]> {
  const { data } = await api.get("/users");
  return data.users;
}

export async function createUser(payload: CreateUserPayload): Promise<ManagedUser> {
  const { data } = await api.post("/users", payload);
  return data.user;
}

export async function updateUser(id: string, payload: UpdateUserPayload): Promise<ManagedUser> {
  const { data } = await api.patch(`/users/${id}`, payload);
  return data.user;
}

export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/users/${id}`);
}
