// بيانات وهمية للبريد الداخلي بين الموظفين
import { AGENTS } from "./mockData";

export type MailFolder = "inbox" | "sent" | "drafts" | "starred" | "trash";
export type MailPriority = "high" | "normal" | "low";

export interface InternalMail {
  id: string;
  from: { name: string; avatar: string; ext: string };
  to: { name: string; avatar: string; ext: string };
  subject: string;
  body: string;
  date: string; // ISO
  read: boolean;
  starred: boolean;
  priority: MailPriority;
  folder: "inbox" | "sent" | "trash";
  attachments?: { name: string; size: string }[];
  ownerExt: string; // التحويلة المالكة للرسالة (المستخدم الحالي)
}

// المستخدم الحالي
export const CURRENT_USER = {
  name: "سلمان العامر",
  avatar: "س.ع",
  ext: "2000",
  role: "مدير النظام",
};

const SUBJECTS = [
  "تقرير الأداء الأسبوعي",
  "اجتماع تقييم ربع السنة",
  "تحديث سياسات المكالمات",
  "طلب إجازة - يرجى الموافقة",
  "ملاحظات على مكالمة العميل #5234",
  "تنبيه: تجاوز SLA يوم أمس",
  "خطة تدريبية للموظفين الجدد",
  "متابعة شكوى عميل VIP",
  "إعادة توزيع المهام للأسبوع القادم",
  "ترقية النظام يوم الجمعة",
  "نتائج مسح رضا العملاء",
  "تذكير: تعبئة تقييم الأداء",
];

const BODIES = [
  "السلام عليكم،\n\nأرجو الاطلاع على التقرير المرفق ومراجعة المؤشرات الرئيسية. هناك عدة نقاط تحتاج إلى مناقشة في الاجتماع القادم.\n\nمع التحية،",
  "مرحباً،\n\nنود إعلامكم بموعد الاجتماع التقييمي يوم الأحد القادم في تمام الساعة العاشرة صباحاً. يرجى الالتزام بالحضور وتجهيز التقارير الخاصة بفرقكم.\n\nشكراً لتعاونكم.",
  "تحية طيبة،\n\nتم تحديث سياسة التعامل مع المكالمات الواردة. النقاط الرئيسية:\n- الرد خلال ١٥ ثانية\n- إنهاء المكالمة بسؤال عن أي استفسار آخر\n- تسجيل ملاحظات دقيقة\n\nيرجى الالتزام بدءاً من الغد.",
  "الأستاذ الفاضل،\n\nأتقدم بطلب إجازة اعتيادية لمدة ٣ أيام بدءاً من ٢٠/٤. آمل التكرم بالموافقة.\n\nمع جزيل الشكر.",
  "تم رصد عدة ملاحظات على المكالمة المشار إليها. يرجى مراجعة التسجيل والاستماع للنقاط من الدقيقة 02:15 إلى 03:40 وإرسال تقرير المتابعة.",
  "تنبيه عاجل: تم تجاوز SLA في ٧ مكالمات يوم أمس. نحتاج إلى خطة تصحيحية فورية ورفع تقرير الأسباب خلال ٤٨ ساعة.",
  "تم اعتماد الخطة التدريبية الجديدة للموظفين الجدد. تتضمن الخطة ٥ ورش عمل على مدار شهر. التفاصيل في المرفق.",
  "العميل (شركة الفجر) قدم شكوى رسمية بخصوص تأخر الاستجابة. يرجى التواصل معه خلال اليوم وحل المشكلة بشكل فوري.",
];

function relativeDate(daysAgo: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, Math.floor(Math.random() * 59), 0, 0);
  return d.toISOString();
}

export const MAILS: InternalMail[] = [
  // الواردة للمستخدم الحالي
  {
    id: "M-001",
    from: { name: AGENTS[0].name, avatar: AGENTS[0].avatar, ext: AGENTS[0].ext },
    to: { name: CURRENT_USER.name, avatar: CURRENT_USER.avatar, ext: CURRENT_USER.ext },
    subject: SUBJECTS[0],
    body: BODIES[0],
    date: relativeDate(0, 9),
    read: false,
    starred: true,
    priority: "high",
    folder: "inbox",
    attachments: [{ name: "تقرير_الأسبوع.pdf", size: "1.2 MB" }],
    ownerExt: CURRENT_USER.ext,
  },
  {
    id: "M-002",
    from: { name: AGENTS[1].name, avatar: AGENTS[1].avatar, ext: AGENTS[1].ext },
    to: { name: CURRENT_USER.name, avatar: CURRENT_USER.avatar, ext: CURRENT_USER.ext },
    subject: SUBJECTS[3],
    body: BODIES[3],
    date: relativeDate(0, 11),
    read: false,
    starred: false,
    priority: "normal",
    folder: "inbox",
    ownerExt: CURRENT_USER.ext,
  },
  {
    id: "M-003",
    from: { name: AGENTS[2].name, avatar: AGENTS[2].avatar, ext: AGENTS[2].ext },
    to: { name: CURRENT_USER.name, avatar: CURRENT_USER.avatar, ext: CURRENT_USER.ext },
    subject: SUBJECTS[5],
    body: BODIES[5],
    date: relativeDate(1, 14),
    read: true,
    starred: true,
    priority: "high",
    folder: "inbox",
    ownerExt: CURRENT_USER.ext,
  },
  {
    id: "M-004",
    from: { name: AGENTS[3].name, avatar: AGENTS[3].avatar, ext: AGENTS[3].ext },
    to: { name: CURRENT_USER.name, avatar: CURRENT_USER.avatar, ext: CURRENT_USER.ext },
    subject: SUBJECTS[7],
    body: BODIES[7],
    date: relativeDate(1, 16),
    read: true,
    starred: false,
    priority: "high",
    folder: "inbox",
    ownerExt: CURRENT_USER.ext,
  },
  {
    id: "M-005",
    from: { name: AGENTS[4].name, avatar: AGENTS[4].avatar, ext: AGENTS[4].ext },
    to: { name: CURRENT_USER.name, avatar: CURRENT_USER.avatar, ext: CURRENT_USER.ext },
    subject: SUBJECTS[10],
    body: BODIES[6],
    date: relativeDate(2, 10),
    read: true,
    starred: false,
    priority: "low",
    folder: "inbox",
    attachments: [{ name: "نتائج_المسح.xlsx", size: "320 KB" }],
    ownerExt: CURRENT_USER.ext,
  },
  {
    id: "M-006",
    from: { name: AGENTS[5].name, avatar: AGENTS[5].avatar, ext: AGENTS[5].ext },
    to: { name: CURRENT_USER.name, avatar: CURRENT_USER.avatar, ext: CURRENT_USER.ext },
    subject: SUBJECTS[2],
    body: BODIES[2],
    date: relativeDate(3, 13),
    read: true,
    starred: false,
    priority: "normal",
    folder: "inbox",
    ownerExt: CURRENT_USER.ext,
  },
  {
    id: "M-007",
    from: { name: AGENTS[6].name, avatar: AGENTS[6].avatar, ext: AGENTS[6].ext },
    to: { name: CURRENT_USER.name, avatar: CURRENT_USER.avatar, ext: CURRENT_USER.ext },
    subject: SUBJECTS[11],
    body: "تذكير لطيف: يرجى تعبئة استمارة تقييم الأداء قبل نهاية الأسبوع.",
    date: relativeDate(4, 9),
    read: true,
    starred: false,
    priority: "low",
    folder: "inbox",
    ownerExt: CURRENT_USER.ext,
  },

  // الصادرة من المستخدم الحالي
  {
    id: "M-101",
    from: { name: CURRENT_USER.name, avatar: CURRENT_USER.avatar, ext: CURRENT_USER.ext },
    to: { name: AGENTS[0].name, avatar: AGENTS[0].avatar, ext: AGENTS[0].ext },
    subject: "Re: " + SUBJECTS[0],
    body: "شكراً على التقرير، تم الاطلاع وسأرسل ملاحظاتي خلال اليوم.",
    date: relativeDate(0, 10),
    read: true,
    starred: false,
    priority: "normal",
    folder: "sent",
    ownerExt: CURRENT_USER.ext,
  },
  {
    id: "M-102",
    from: { name: CURRENT_USER.name, avatar: CURRENT_USER.avatar, ext: CURRENT_USER.ext },
    to: { name: AGENTS[1].name, avatar: AGENTS[1].avatar, ext: AGENTS[1].ext },
    subject: "Re: " + SUBJECTS[3],
    body: "تمت الموافقة على طلب الإجازة. أتمنى لك إجازة سعيدة.",
    date: relativeDate(0, 12),
    read: true,
    starred: false,
    priority: "normal",
    folder: "sent",
    ownerExt: CURRENT_USER.ext,
  },
  {
    id: "M-103",
    from: { name: CURRENT_USER.name, avatar: CURRENT_USER.avatar, ext: CURRENT_USER.ext },
    to: { name: AGENTS[2].name, avatar: AGENTS[2].avatar, ext: AGENTS[2].ext },
    subject: SUBJECTS[8],
    body: BODIES[1],
    date: relativeDate(1, 15),
    read: true,
    starred: true,
    priority: "high",
    folder: "sent",
    ownerExt: CURRENT_USER.ext,
  },
  {
    id: "M-104",
    from: { name: CURRENT_USER.name, avatar: CURRENT_USER.avatar, ext: CURRENT_USER.ext },
    to: { name: AGENTS[4].name, avatar: AGENTS[4].avatar, ext: AGENTS[4].ext },
    subject: SUBJECTS[4],
    body: BODIES[4],
    date: relativeDate(2, 11),
    read: true,
    starred: false,
    priority: "high",
    folder: "sent",
    ownerExt: CURRENT_USER.ext,
  },
  {
    id: "M-105",
    from: { name: CURRENT_USER.name, avatar: CURRENT_USER.avatar, ext: CURRENT_USER.ext },
    to: { name: AGENTS[3].name, avatar: AGENTS[3].avatar, ext: AGENTS[3].ext },
    subject: SUBJECTS[9],
    body: "تنبيه بترقية النظام يوم الجمعة من ١١ مساءً إلى ١ صباحاً. لن تتأثر العمليات.",
    date: relativeDate(3, 17),
    read: true,
    starred: false,
    priority: "low",
    folder: "sent",
    ownerExt: CURRENT_USER.ext,
  },
];

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
