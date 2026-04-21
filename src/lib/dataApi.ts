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
  bulkCreate: async (rows: Record<string, unknown>[], defaultPassword?: string): Promise<BulkImportResult> => {
    const { data } = await api.post("/users/bulk", { rows, defaultPassword });
    return data;
  },
};

export interface BulkImportResult {
  created: number;
  skipped: number;
  errors: Array<{ row: number; reason: string; [k: string]: unknown }>;
}

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

// ============================================================
// MAILS — البريد الداخلي
// ============================================================
export type MailFolder = "inbox" | "sent" | "drafts" | "starred" | "trash";
export type MailPriority = "high" | "normal" | "low";

export interface ApiMail {
  id: string;
  from: { name: string; ext: string; avatar: string };
  to:   { name: string; ext: string; avatar: string };
  subject: string;
  body: string;
  date: string;
  read: boolean;
  starred: boolean;
  priority: MailPriority;
  folder: "inbox" | "sent" | "trash";
  ownerExt: string;
}

export interface MailCounts {
  inbox: number; sent: number; starred: number; drafts: number; trash: number;
}

export const mailsApi = {
  list: async (folder: MailFolder): Promise<ApiMail[]> => {
    const { data } = await api.get(`/mails`, { params: { folder } });
    return data.mails;
  },
  counts: async (): Promise<MailCounts> => {
    const { data } = await api.get(`/mails/counts`);
    return data.counts;
  },
  send: async (payload: { toExt: string; subject: string; body: string; priority: MailPriority }): Promise<ApiMail> => {
    const { data } = await api.post(`/mails`, payload);
    return data.mail;
  },
  update: async (id: string, payload: { is_read?: boolean; is_starred?: boolean; folder?: "inbox" | "sent" | "trash" }): Promise<ApiMail> => {
    const { data } = await api.patch(`/mails/${id}`, payload);
    return data.mail;
  },
  remove: async (id: string): Promise<void> => {
    await api.delete(`/mails/${id}`);
  },
};

// ============================================================
// RECORDINGS — التسجيلات
// ============================================================
export interface ApiRecordingMetric { label: string; score: number; }
export interface ApiTranscriptLine { speaker: "agent" | "customer"; time: number; text: string; }

export interface ApiRecording {
  id: string;
  agentId: string | null;
  agentName: string;
  agentAvatar: string;
  customerNumber: string;
  date: string;
  time: string;
  duration: number;
  audioUrl: string | null;
  qualityScore: number;
  sentiment: "positive" | "neutral" | "negative";
  category: string;
  tags: string[];
  metrics: ApiRecordingMetric[];
  transcript: ApiTranscriptLine[];
  summary: string;
}

export const recordingsApi = {
  list: async (): Promise<ApiRecording[]> => {
    const { data } = await api.get("/recordings");
    return data.recordings;
  },
  get: async (id: string): Promise<ApiRecording | null> => {
    try {
      const { data } = await api.get(`/recordings/${id}`);
      return data.recording;
    } catch { return null; }
  },
  create: async (payload: Record<string, unknown>): Promise<{ id: string }> => {
    const { data } = await api.post("/recordings", payload);
    return data;
  },
  bulkCreate: async (rows: Record<string, unknown>[]): Promise<BulkImportResult> => {
    const { data } = await api.post("/recordings/bulk", { rows });
    return data;
  },
  /** رفع ملف صوت مستقل — يعيد الـ URL لاستخدامه في create */
  uploadAudio: async (
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<{ audioUrl: string; filename: string; size: number }> => {
    const fd = new FormData();
    fd.append("file", file);
    const { data } = await api.post("/recordings/upload", fd, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 5 * 60_000,
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
    return data;
  },
  /** ربط/استبدال صوت لتسجيل موجود */
  uploadAudioFor: async (
    id: string,
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<{ audioUrl: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const { data } = await api.post(`/recordings/${id}/audio`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 5 * 60_000,
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
    return data;
  },
  remove: async (id: string): Promise<void> => {
    await api.delete(`/recordings/${id}`);
  },
};

// ============================================================
// AI ANALYTICS
// ============================================================
export interface ApiAiRecommendation {
  id: string; icon: string; color: string; title: string; body: string; impact: string | null;
}
export interface SentimentSummary { positive: number; neutral: number; negative: number; total: number; }
export interface SentimentTrendDay { day: string; positive: number; neutral: number; negative: number; }
export interface AiOverview { calls24h: number; recordings24h: number; activeRecs: number; }

export const aiAnalyticsApi = {
  recommendations: async (): Promise<ApiAiRecommendation[]> => {
    const { data } = await api.get("/ai-analytics/recommendations");
    return data.recommendations;
  },
  sentiment: async (): Promise<SentimentSummary> => {
    const { data } = await api.get("/ai-analytics/sentiment");
    return data.summary;
  },
  trend: async (): Promise<SentimentTrendDay[]> => {
    const { data } = await api.get("/ai-analytics/sentiment-trend");
    return data.trend;
  },
  overview: async (): Promise<AiOverview> => {
    const { data } = await api.get("/ai-analytics/overview");
    return data.overview;
  },
};

export const isRealApi = USE_REAL_API;
