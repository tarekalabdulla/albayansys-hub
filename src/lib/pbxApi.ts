// إعدادات السنترال Yeastar P-Series — للأدمن فقط
import { api } from "./api";

export interface PbxSettings {
  id: number;
  enabled: boolean;
  host: string | null;
  port: number;
  use_tls: boolean;
  api_username: string | null;
  webhook_url: string | null;
  has_secret: boolean;
  has_webhook_secret: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_msg: string | null;
  last_event_at: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface PbxUpdatePayload {
  enabled?: boolean;
  host?: string;
  port?: number;
  use_tls?: boolean;
  api_username?: string;
  api_secret?: string;     // اتركه فارغاً لعدم التغيير
  clear_secret?: boolean;  // true لمسح السر المحفوظ
  webhook_url?: string;
}

export interface PbxTestResult {
  ok: boolean;
  status?: number;
  message: string;
  elapsed_ms?: number;
}

export async function getPbxSettings(): Promise<PbxSettings | null> {
  const { data } = await api.get("/pbx");
  return data.settings;
}

export async function updatePbxSettings(payload: PbxUpdatePayload): Promise<PbxSettings> {
  const { data } = await api.put("/pbx", payload);
  return data.settings;
}

export async function testPbxConnection(payload?: {
  host?: string; port?: number; use_tls?: boolean;
  api_username?: string; api_secret?: string;
}): Promise<PbxTestResult> {
  try {
    const { data } = await api.post("/pbx/test", payload || {});
    return data;
  } catch (err: any) {
    return {
      ok: false,
      status: err?.response?.status,
      message: err?.response?.data?.message || err?.response?.data?.error || "فشل الاتصال",
    };
  }
}

// ============ Webhook secret management ============
export async function regenerateWebhookSecret(): Promise<{ secret: string; message: string }> {
  const { data } = await api.post("/pbx/webhook-secret/regenerate");
  return data;
}

export async function clearWebhookSecret(): Promise<void> {
  await api.delete("/pbx/webhook-secret");
}

// snapshot للحالة الحية (مكالمات + تحويلات) من DB
export async function getPbxLiveSnapshot(): Promise<{ calls: any[]; extensions: any[] }> {
  const { data } = await api.get("/pbx/live");
  return data;
}
