// ============================================================================
// yeastarService — Yeastar P-Series HTTP/OAuth client (REST API)
// ----------------------------------------------------------------------------
// مسؤوليات:
//   * إدارة access_token (caching + auto-refresh)
//   * طلبات HTTPS موحّدة مع User-Agent + retry
//   * نقطة موحّدة لكل استدعاءات API الإضافية (CDR fetch, recordings download...)
//
// لا يُلمَس realtime/yeastar-openapi.js (الذي يدير WebSocket).
// هذه الخدمة مكمّلة — للاستدعاءات الـ on-demand فقط.
//
// ENV المطلوبة:
//   YEASTAR_BASE_URL     = https://pbx.example.com[:port]
//   YEASTAR_CLIENT_ID    = ...
//   YEASTAR_CLIENT_SECRET= ...
// ============================================================================

const USER_AGENT = "HululAlbayan-CallCenter/1.0 (+yeastar-integration)";
const TOKEN_REFRESH_MARGIN_MS = 60_000;   // جدّد قبل الانتهاء بدقيقة
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

let cache = {
  accessToken: null,
  refreshToken: null,
  expireAt: 0,
};

function log(...a)  { console.log("[yeastarService]", ...a); }
function warn(...a) { console.warn("[yeastarService]", ...a); }

function cfg() {
  const base = (process.env.YEASTAR_BASE_URL || process.env.YEASTAR_API_BASE || "").replace(/\/+$/, "");
  return {
    base,
    clientId:     process.env.YEASTAR_CLIENT_ID     || "",
    clientSecret: process.env.YEASTAR_CLIENT_SECRET || "",
    user:         process.env.YEASTAR_API_USER      || "",
    pass:         process.env.YEASTAR_API_PASS      || "",
  };
}

export function isConfigured() {
  const c = cfg();
  return Boolean(c.base && ((c.clientId && c.clientSecret) || (c.user && c.pass)));
}

// ----------------------------------------------------------------------------
// fetch مع timeout + User-Agent
// ----------------------------------------------------------------------------
async function safeFetch(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ----------------------------------------------------------------------------
// Token management
// ----------------------------------------------------------------------------
async function fetchTokenFresh() {
  const { base, clientId, clientSecret, user, pass } = cfg();
  if (!base) throw new Error("yeastar_missing_base_url");

  const body = (clientId && clientSecret)
    ? { client_id: clientId, client_secret: clientSecret }
    : { username: user, password: pass };

  const res = await safeFetch(`${base}/openapi/v1.0/get_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`get_token_http_${res.status}`);
  const data = await res.json();
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`get_token_errcode_${data.errcode}_${data.errmsg || ""}`);
  }

  const accessToken  = data.access_token  || data.data?.access_token;
  const refreshToken = data.refresh_token || data.data?.refresh_token;
  const expireSec    = data.expire_time   || data.data?.expire_time || 1800;
  if (!accessToken) throw new Error("get_token_no_access_token");

  cache.accessToken  = accessToken;
  cache.refreshToken = refreshToken || null;
  cache.expireAt     = Date.now() + expireSec * 1000;
  log(`token مُحدَّث (TTL=${expireSec}s)`);
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
          log(`token جُدِّد عبر refresh (TTL=${ttl}s)`);
          return cache.accessToken;
        }
      }
    } catch (e) {
      warn("refresh failed, falling back to fetch:", e.message);
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
  return {
    configured: isConfigured(),
    hasToken: Boolean(cache.accessToken),
    expiresInSec: cache.expireAt ? Math.max(0, Math.round((cache.expireAt - Date.now()) / 1000)) : 0,
  };
}
