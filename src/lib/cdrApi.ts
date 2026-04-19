// CDR API — جلب سجل المكالمات من Yeastar عبر الباك-إند
import { api } from "./api";
import { API_URL } from "./config";
import { tokenStorage } from "./api";

export interface CdrItem {
  id: string;
  startedAt: string | null;
  from: { number: string; name: string };
  to: { number: string; name: string };
  extension: string;
  duration: number;
  status: string;
  direction: string;
  hasRecording: boolean;
  recordingFile: string | null;
  recordingUrl: string | null; // مسار نسبي للباك-إند
}

export interface CdrListResponse {
  page: number;
  pageSize: number;
  total: number;
  items: CdrItem[];
}

export interface CdrFilters {
  page?: number;
  page_size?: number;
  start_time?: string;
  end_time?: string;
  search?: string;
  call_status?: "ANSWERED" | "NO ANSWER" | "BUSY" | "FAILED" | "VOICEMAIL";
}

export async function fetchCdr(filters: CdrFilters = {}): Promise<CdrListResponse> {
  const { data } = await api.get("/cdr", { params: filters });
  return data;
}

// رابط مطلق للتسجيل مع توكن المستخدم (للتشغيل في <audio>/التحميل)
// نستخدم query param token لأن وسم <audio> لا يدعم Authorization header.
// (الباك-إند يقبل توكن من الهيدر فقط، لذا نستخدم fetch+blob في AudioPlayer.)
export function buildAbsoluteRecordingUrl(relPath: string): string {
  if (!relPath) return "";
  if (relPath.startsWith("http")) return relPath;
  return `${API_URL}${relPath.startsWith("/api") ? relPath : `/api${relPath}`}`;
}

// جلب التسجيل كـ Blob URL (يضيف Authorization تلقائياً)
export async function fetchRecordingBlobUrl(relPath: string): Promise<string> {
  const url = buildAbsoluteRecordingUrl(relPath);
  const token = tokenStorage.get();
  const r = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) throw new Error(`فشل تنزيل التسجيل (${r.status})`);
  const blob = await r.blob();
  return URL.createObjectURL(blob);
}
