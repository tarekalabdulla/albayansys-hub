// بيانات وهمية لتسجيلات المكالمات
import { AGENTS } from "./mockData";

export interface TranscriptLine {
  speaker: "agent" | "customer";
  time: number; // seconds offset
  text: string;
}

export interface QualityMetric {
  label: string;
  score: number; // 0-100
}

export interface CallRecording {
  id: string;
  agentName: string;
  agentAvatar: string;
  customerNumber: string;
  date: string;
  time: string;
  duration: number; // seconds
  audioUrl: string;
  qualityScore: number; // 0-100
  sentiment: "positive" | "neutral" | "negative";
  category: "استفسار" | "شكوى" | "دعم فني" | "مبيعات" | "متابعة";
  tags: string[];
  metrics: QualityMetric[];
  transcript: TranscriptLine[];
  summary: string;
}

// نماذج صوت قصيرة مفتوحة المصدر للتجربة
const SAMPLE_AUDIO = [
  "https://cdn.pixabay.com/download/audio/2022/03/15/audio_1718e36b14.mp3",
  "https://cdn.pixabay.com/download/audio/2022/10/25/audio_864c2d4fb1.mp3",
  "https://cdn.pixabay.com/download/audio/2021/08/04/audio_12b0c7443c.mp3",
];

const CATEGORIES: CallRecording["category"][] = [
  "استفسار",
  "شكوى",
  "دعم فني",
  "مبيعات",
  "متابعة",
];

const SAMPLE_TRANSCRIPTS: TranscriptLine[][] = [
  [
    { speaker: "agent", time: 0, text: "السلام عليكم، أهلاً بكم في حلول البيان، معك أحمد، كيف أقدر أخدمك؟" },
    { speaker: "customer", time: 6, text: "وعليكم السلام، عندي استفسار بخصوص فاتورتي لهذا الشهر." },
    { speaker: "agent", time: 12, text: "بكل سرور، ممكن تزودني برقم الحساب أو رقم الجوال المسجل؟" },
    { speaker: "customer", time: 18, text: "رقم الجوال هو نفسه اللي أتصلت منه." },
    { speaker: "agent", time: 24, text: "تمام، لحظة من فضلك أراجع البيانات... شكراً لانتظارك، تفضل بالاستفسار." },
    { speaker: "customer", time: 32, text: "الفاتورة جت أعلى من الشهر اللي قبله، أبغى أعرف السبب." },
    { speaker: "agent", time: 40, text: "حسب البيانات، فيه باقة إضافية تم تفعيلها بتاريخ ١٠ من الشهر الماضي." },
    { speaker: "customer", time: 48, text: "آه صحيح، نسيت الموضوع، شكراً لك." },
    { speaker: "agent", time: 54, text: "العفو، هل فيه شيء ثاني أقدر أساعدك فيه؟" },
    { speaker: "customer", time: 60, text: "لا شكراً، الله يعطيك العافية." },
    { speaker: "agent", time: 64, text: "الله يعافيك، شكراً لتواصلك مع حلول البيان." },
  ],
  [
    { speaker: "customer", time: 0, text: "مرحباً، عندي مشكلة في الخدمة من يومين والمشكلة ما تحلت!" },
    { speaker: "agent", time: 5, text: "أعتذر عن الإزعاج، سأتابع معك شخصياً، ممكن توضح لي المشكلة؟" },
    { speaker: "customer", time: 12, text: "الإنترنت ينقطع كل ساعة تقريباً، وقدمت بلاغ ومحد رد علي." },
    { speaker: "agent", time: 20, text: "فهمت، سأرفع البلاغ لقسم الفنيين على وجه السرعة." },
    { speaker: "customer", time: 28, text: "أبغى حل اليوم وليس وعود فقط." },
    { speaker: "agent", time: 34, text: "أعدك بمتابعة شخصية وسأتواصل معك خلال ساعتين بحد أقصى." },
    { speaker: "customer", time: 42, text: "تمام، بانتظارك." },
    { speaker: "agent", time: 46, text: "شكراً لصبرك، ونعتذر مرة أخرى." },
  ],
  [
    { speaker: "agent", time: 0, text: "أهلاً وسهلاً، حلول البيان معك سارة، تفضل." },
    { speaker: "customer", time: 4, text: "أبغى أعرف عروض الباقات الجديدة." },
    { speaker: "agent", time: 9, text: "بكل سرور، عندنا ثلاث باقات: الفضية ٩٩ ريال، الذهبية ١٤٩ ريال، والبلاتينية ١٩٩ ريال." },
    { speaker: "customer", time: 22, text: "ايش الفرق بين الذهبية والبلاتينية؟" },
    { speaker: "agent", time: 28, text: "البلاتينية تشمل إنترنت غير محدود ومكالمات دولية، أما الذهبية فمحلية فقط." },
    { speaker: "customer", time: 38, text: "تمام، أبغى أشترك في البلاتينية." },
    { speaker: "agent", time: 44, text: "ممتاز! سأرسل لك رابط التفعيل عبر رسالة نصية." },
    { speaker: "customer", time: 50, text: "شكراً جزيلاً." },
  ],
];

function genMetrics(base: number): QualityMetric[] {
  const jitter = () => Math.max(50, Math.min(100, base + Math.floor(Math.random() * 20 - 10)));
  return [
    { label: "وضوح الصوت", score: jitter() },
    { label: "الالتزام بالنص", score: jitter() },
    { label: "حل المشكلة", score: jitter() },
    { label: "اللباقة والاحترام", score: jitter() },
    { label: "زمن الاستجابة", score: jitter() },
  ];
}

const SUMMARIES = [
  "تم الرد على استفسار العميل بخصوص الفاتورة وتوضيح سبب الزيادة.",
  "شكوى عميل بخصوص انقطاع الخدمة، تم رفع البلاغ للقسم الفني.",
  "اشترك العميل في الباقة البلاتينية بعد شرح الفروقات.",
  "متابعة طلب سابق، العميل راضٍ عن مستوى الخدمة.",
  "دعم فني لإعادة ضبط الراوتر، تم حل المشكلة خلال المكالمة.",
];

// قائمة فارغة افتراضياً — التسجيلات الحقيقية تأتي من Yeastar CDR
export const RECORDINGS: CallRecording[] = [];

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function qualityColorClass(score: number): string {
  if (score >= 85) return "text-success";
  if (score >= 70) return "text-info";
  if (score >= 55) return "text-warning";
  return "text-destructive";
}

export function qualityBgClass(score: number): string {
  if (score >= 85) return "bg-success";
  if (score >= 70) return "bg-info";
  if (score >= 55) return "bg-warning";
  return "bg-destructive";
}

export function sentimentLabel(s: CallRecording["sentiment"]): { label: string; cls: string } {
  switch (s) {
    case "positive": return { label: "إيجابي", cls: "bg-success/15 text-success border-success/30" };
    case "neutral":  return { label: "محايد", cls: "bg-info/15 text-info border-info/30" };
    case "negative": return { label: "سلبي", cls: "bg-destructive/15 text-destructive border-destructive/30" };
  }
}
