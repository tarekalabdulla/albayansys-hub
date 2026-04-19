import { api } from "./api";

export type MailFolder = "inbox" | "sent" | "starred" | "trash";
export type MailPriority = "high" | "normal" | "low";

export interface MailItem {
  id: string;
  subject: string;
  body: string;
  priority: MailPriority;
  date: string;
  read: boolean;
  starred: boolean;
  folder: "inbox" | "sent" | "trash";
  from_id: string;
  from_ext: string;
  from_name: string;
  from_avatar: string;
  to_id: string;
  to_ext: string;
  to_name: string;
  to_avatar: string;
}

export interface MailRecipient {
  id: string;
  ext: string;
  name: string;
  avatar: string;
}

export interface MailCounts {
  inbox: number;
  sent: number;
  trash: number;
  starred: number;
}

export const mailApi = {
  list: async (folder: MailFolder): Promise<MailItem[]> => {
    const { data } = await api.get(`/mail`, { params: { folder } });
    return data.items;
  },
  counts: async (): Promise<MailCounts> => {
    const { data } = await api.get(`/mail/counts`);
    return data;
  },
  recipients: async (): Promise<MailRecipient[]> => {
    const { data } = await api.get(`/mail/recipients`);
    return data.items;
  },
  send: async (payload: { to_user_id: string; subject: string; body: string; priority: MailPriority }) => {
    const { data } = await api.post(`/mail`, payload);
    return data;
  },
  patch: async (id: string, payload: { is_read?: boolean; starred?: boolean; folder?: "inbox" | "sent" | "trash" }) => {
    const { data } = await api.patch(`/mail/${id}`, payload);
    return data;
  },
  remove: async (id: string) => {
    const { data } = await api.delete(`/mail/${id}`);
    return data;
  },
};

export function formatMailDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (sameDay) return time;
  if (isYesterday) return `أمس ${time}`;
  return d.toLocaleDateString("ar-SA", { month: "short", day: "numeric" });
}

export function priorityMeta(p: MailPriority): { label: string; cls: string } {
  switch (p) {
    case "high":   return { label: "عاجل", cls: "bg-destructive/15 text-destructive border-destructive/30" };
    case "normal": return { label: "عادي", cls: "bg-info/15 text-info border-info/30" };
    case "low":    return { label: "منخفض", cls: "bg-muted text-muted-foreground border-border" };
  }
}

// أحرف الـ avatar من الاسم
export function initialsOf(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[parts.length - 1][0];
}
