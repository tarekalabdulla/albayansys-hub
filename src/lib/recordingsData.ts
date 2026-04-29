// helpers + types لتسجيلات المكالمات (لا توجد بيانات وهمية)
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
  duration: number;
  audioUrl: string;
  qualityScore: number;
  sentiment: "positive" | "neutral" | "negative";
  category: "استفسار" | "شكوى" | "دعم فني" | "مبيعات" | "متابعة";
  tags: string[];
  metrics: QualityMetric[];
  transcript: TranscriptLine[];
  summary: string;
}

export function formatTime(s: number): string {
  if (!s || !Number.isFinite(s)) return "00:00";
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
