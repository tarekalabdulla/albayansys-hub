// helpers + types للبريد الداخلي (لا توجد بيانات وهمية)
export type MailFolder = "inbox" | "sent" | "drafts" | "starred" | "trash";
export type MailPriority = "high" | "normal" | "low";

export interface InternalMail {
  id: string;
  from: { name: string; avatar: string; ext: string };
  to: { name: string; avatar: string; ext: string };
  subject: string;
  body: string;
  date: string;
  read: boolean;
  starred: boolean;
  priority: MailPriority;
  folder: "inbox" | "sent" | "trash";
  attachments?: { name: string; size: string }[];
  ownerExt: string;
}

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
