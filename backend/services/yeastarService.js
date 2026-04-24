// ============================================================================
// yeastarService — Yeastar P-Series HTTP/OAuth client (REST API)
// ----------------------------------------------------------------------------
// مسؤوليات:
//   * إدارة access_token (caching + auto-refresh) — OAuth حصراً
//   * طلبات HTTPS موحّدة مع User-Agent + retry
//   * نقطة موحّدة لكل استدعاءات API الإضافية (CDR fetch, recordings download...)
//
// ⚠️  لا نَدعم username/password. Open API لـ Yeastar P-Series يتطلّب
//     client_id + client_secret؛ أي fallback لـ username/password كان يُعيد
//     40002 PARAMETER ERROR.
//
// ⚠️  fix 2026-04 (B): الـ baseUrl يُعقَّم دوماً عبر sanitizeBaseUrl
//     (origin فقط — لا /openapi، لا /api/yeastar، لا webhook، لا {TOKEN}).
//     المسارات (مثل /openapi/v1.0/get_token) ثابتة في الكود ولا تأتي
//     مطلقاً من DB ولا من env.
//
// ENV / DB المطلوبة (DB يفوز عند التعارض):
//   YEASTAR_BASE_URL     = https://pbx.example.com[:port]
//   YEASTAR_CLIENT_ID    = ...
//   YEASTAR_CLIENT_SECRET= ...
// ============================================================================
import {
  getEffectiveConfigSync,
  getConfigSource,
  sanitizeBaseUrl,
  buildAuthPayloadShape,
} from "./runtimeConfig.js";

const USER_AGENT = "HululAlbayan-CallCenter/1.0 (+yeastar-integration)";
const TOKEN_REFRESH_MARGIN_MS = 60_000;   // جدّد قبل الانتهاء بدقيقة
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

let cache = {
  accessToken: null,
  refreshToken: null,
  expireAt: 0,
};

function log(...a)  { console.log("[yeastarService]",  ...a); }
function warn(...a) { console.warn("[yeastarService]", ...a); }

function maskSecret(s) {
  if (!s || typeof s !== "string") return "(empty)";
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-2)} (len=${s.length})`;
}

function cfg() {
  const live = getEffectiveConfigSync() || {};
  const src  = getConfigSource() || { baseUrl: "none" };

  const rawBase = live.baseUrl || process.env.YEASTAR_BASE_URL || process.env.YEASTAR_API_BASE || "";
  const base    = sanitizeBaseUrl(rawBase);

  if (rawBase && base !== rawBase.replace(/\/+$/, "")) {
    warn(`baseUrl was sanitized: raw="${rawBase}" → clean="${base}" (source=${src.baseUrl})`);
  }

  // shape موحَّد لـ payload المصادقة (client_credentials | basic_credentials)
  const shape = buildAuthPayloadShape(live);

  return {
    base,
    baseSource: src.baseUrl || "none",
    authMode:    shape.effectiveMode,
    authFields:  shape.fields,
    authPayload: shape.payload,
    authMissing: shape.missing,
    authExplicit: shape.explicit,
  };
}

export function isConfigured() {
  const c = cfg();
  return Boolean(c.base && c.authMissing.length === 0);
}

// ----------------------------------------------------------------------------
// fetch مع timeout + User-Agent
// ----------------------------------------------------------------------------
async function safeFetch(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ----------------------------------------------------------------------------
// Token management — OAuth حصراً
// ----------------------------------------------------------------------------
async function fetchTokenFresh() {
  const { base, baseSource, authMode, authFields, authPayload, authMissing, authExplicit } = cfg();
  if (!base) throw new Error("yeastar_missing_base_url");
  if (authMissing.length) {
    throw new Error(
      `yeastar_missing_${authMode}_credentials (الحقول الناقصة: ${authMissing.join(", ")})`
    );
  }

  // ⚠️ المسار ثابت — يُلحَق بـ base origin فقط
  const url = `${base}/openapi/v1.0/get_token`;

  log(
    "get_token →", url,
    `(base="${base}" source=${baseSource})`,
    `authMode="${authMode}"${authExplicit ? "" : " (inferred)"}`,
    `fields=[${authFields.join(", ")}]`,
    `values={ ${authFields.map((f) => `${f}=${maskSecret(authPayload[f])}`).join(", ")} }`,
  );

  let res;
  try {
    res = await safeFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authPayload),
    });
  } catch (e) {
    const reason = e.name === "AbortError" ? `timeout_${DEFAULT_TIMEOUT_MS}ms` : e.message;
    warn(`get_token network error: ${reason}`);
    throw new Error(`get_token_network_${reason}`);
  }

  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }

  if (!res.ok) {
    warn(
      `get_token HTTP ${res.status} authMode="${authMode}" ` +
      `errcode=${data.errcode ?? "-"} errmsg="${data.errmsg ?? ""}" endpoint="${url}"`
    );
    throw new Error(`get_token_http_${res.status}_errcode_${data.errcode ?? "?"}_${data.errmsg || ""}`);
  }
  if (data.errcode && data.errcode !== 0) {
    warn(
      `get_token rejected by PBX: authMode="${authMode}" ` +
      `errcode=${data.errcode} errmsg="${data.errmsg ?? ""}" endpoint="${url}"`
    );
    throw new Error(`get_token_errcode_${data.errcode}_${data.errmsg || ""}`);
  }

  const accessToken  = data.access_token  || data.data?.access_token;
  const refreshToken = data.refresh_token || data.data?.refresh_token;
  const expireSec    = data.expire_time   || data.data?.expire_time || 1800;
  if (!accessToken) throw new Error("get_token_no_access_token");

  cache.accessToken  = accessToken;
  cache.refreshToken = refreshToken || null;
  cache.expireAt     = Date.now() + expireSec * 1000;
  log(`get_token OK — access_token=${maskSecret(accessToken)} ttl=${expireSec}s`);
  return accessToken;
}

async function refreshIfNeeded() {
  if (!cache.accessToken) return fetchTokenFresh();
  if (Date.now() < cache.expireAt - TOKEN_REFRESH_MARGIN_MS) return cache.accessToken;
  // محاولة refresh أولاً، fallback لـ get_token
  if (cache.refreshToken) {
    try {
      const { base } = cfg();
      const res = await safeFetch(`${base}/openapi/v1.0/refresh_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: cache.refreshToken }),
      });
      if (res.ok) {
        const data = await res.json();
        if (!data.errcode || data.errcode === 0) {
          cache.accessToken  = data.access_token  || data.data?.access_token;
          cache.refreshToken = data.refresh_token || data.data?.refresh_token || cache.refreshToken;
          const ttl = data.expire_time || data.data?.expire_time || 1800;
          cache.expireAt = Date.now() + ttl * 1000;
          log(`refresh OK — new access_token=${maskSecret(cache.accessToken)} ttl=${ttl}s`);
          return cache.accessToken;
        }
      }
    } catch (e) {
      warn("refresh failed, falling back to fresh get_token:", e.message);
    }
  }
  return fetchTokenFresh();
}

export async function getAccessToken() {
  return refreshIfNeeded();
}

// ----------------------------------------------------------------------------
// طلب موحّد لـ Yeastar API (مع retry على 401 — token expired)
// ----------------------------------------------------------------------------
export async function apiRequest(path, { method = "GET", body, query, timeoutMs } = {}) {
  if (!isConfigured()) throw new Error("yeastar_not_configured");
  const { base } = cfg();

  let url = `${base}${path.startsWith("/") ? path : "/" + path}`;
  if (query && typeof query === "object") {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.append(k, String(v));
    }
    if (qs.toString()) url += (url.includes("?") ? "&" : "?") + qs.toString();
  }

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const token = await getAccessToken();
    try {
      log(`apiRequest ${method} ${url} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
      const res = await safeFetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      }, timeoutMs);

      if (res.status === 401 && attempt < MAX_RETRIES) {
        warn("401 — invalidating token and retrying");
        cache.expireAt = 0;
        continue;
      }

      const text = await res.text();
      let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!res.ok) throw new Error(`yeastar_http_${res.status}_${data.errmsg || data.error || ""}`);
      if (data.errcode && data.errcode !== 0) throw new Error(`yeastar_errcode_${data.errcode}_${data.errmsg || ""}`);
      return data;
    } catch (e) {
      lastErr = e;
      if (e.name === "AbortError") {
        warn(`timeout (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("yeastar_request_failed");
}

// ----------------------------------------------------------------------------
// تنزيل ملف (للتسجيلات)
// ----------------------------------------------------------------------------
export async function downloadFile(path, { timeoutMs = 30_000 } = {}) {
  if (!isConfigured()) throw new Error("yeastar_not_configured");
  const { base } = cfg();
  const token = await getAccessToken();
  const url = `${base}${path.startsWith("/") ? path : "/" + path}`;

  const res = await safeFetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  }, timeoutMs);

  if (!res.ok) throw new Error(`yeastar_download_http_${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ----------------------------------------------------------------------------
// الحالة (للتشخيص)
// ----------------------------------------------------------------------------
export function getServiceStatus() {
  const c = cfg();
  return {
    configured: isConfigured(),
    authMode: isConfigured() ? "oauth" : "none",
    baseUrl: c.base || null,
    baseUrlSource: c.baseSource || "none",
    hasToken: Boolean(cache.accessToken),
    expiresInSec: cache.expireAt ? Math.max(0, Math.round((cache.expireAt - Date.now()) / 1000)) : 0,
  };
}
