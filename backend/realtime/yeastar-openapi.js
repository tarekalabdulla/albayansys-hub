// ============================================================
// Yeastar P-Series Open API client
// ------------------------------------------------------------
// نستخدم Open API:
//   1) نطلب access_token من /openapi/v1.0/get_token (تجديد تلقائي)
//   2) نفتح WebSocket على /openapi/v1.0/subscribe?access_token=...
//   3) نشترك بالأحداث (CDR / ExtensionStatus / CallStatus...)
//   4) نُمرّر الأحداث الواردة لنفس معالج الـ webhook (handleNormalizedEvent)
//
// ⚠️  منذ تعديل 2026-04: لم نعد ندعم username/password إطلاقاً.
//     Yeastar P-Series Open API يتطلّب OAuth (client_id + client_secret).
//
// ⚠️  fix 2026-04 (B): الـ baseUrl يأتي من runtimeConfig وقد عُقِّم مسبقاً
//     (origin فقط — لا /openapi، لا /api/yeastar، لا {TOKEN}). نضيف هنا
//     طبقة دفاع إضافية + log واضح يبيّن:
//        - baseUrl المستخدم فعلياً (المصدر: DB أم env)
//        - أن المسار المُلحَق هو /openapi/v1.0/get_token حصراً
//
// ENV / DB المطلوبة (الأولوية: DB ← env):
//   YEASTAR_BASE_URL      = https://hululalbayan.ras.yeastar.com
//   YEASTAR_CLIENT_ID     = ...
//   YEASTAR_CLIENT_SECRET = ...
//   YEASTAR_API_TOPICS    = 30012,30013,30014   (اختياري)
// ============================================================
import WebSocket from "ws";
import { handleNormalizedEvent } from "../routes/webhooks-yeastar.js";
import {
  getEffectiveConfigSync,
  getConfigSource,
  sanitizeBaseUrl,
} from "../services/runtimeConfig.js";

const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000; // جدّد قبل الانتهاء بدقيقة
const HTTP_TIMEOUT_MS = 15_000;

let state = {
  accessToken: null,
  refreshToken: null,
  expireAt: 0,         // ms epoch
  ws: null,
  reconnectMs: RECONNECT_MIN_MS,
  refreshTimer: null,
  stopped: false,
  io: null,
  lastConnectedAt: 0,
  lastEventAt: 0,
  lastError: null,
  lastBaseUrl: "",
  lastBaseSource: "none",
};

function log(...args)  { console.log("[yeastar-api]",  ...args); }
function warn(...args) { console.warn("[yeastar-api]", ...args); }

// -------- إخفاء الأسرار في السجلات --------
function maskSecret(s) {
  if (!s || typeof s !== "string") return "(empty)";
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-2)} (len=${s.length})`;
}

function cfg() {
  // DB ∪ env (DB يفوز إن كانت قيمة غير فارغة) — مع تعقيم نهائي للأمان
  const live = getEffectiveConfigSync() || {};
  const src  = getConfigSource() || { baseUrl: "none" };

  // طبقة دفاع: حتى لو تسرّبت قيمة ملوّثة، sanitizeBaseUrl يُعيد origin فقط
  const rawBase = live.baseUrl || process.env.YEASTAR_BASE_URL || process.env.YEASTAR_API_BASE || "";
  const base    = sanitizeBaseUrl(rawBase);

  // إذا اختلفت القيمة بعد التعقيم، أبلغ — هذا يدل على bug في مكان آخر
  if (rawBase && base !== rawBase.replace(/\/+$/, "")) {
    warn(`baseUrl was sanitized: raw="${rawBase}" → clean="${base}" (source=${src.baseUrl})`);
  }

  const clientId     = live.clientId     || process.env.YEASTAR_CLIENT_ID     || "";
  const clientSecret = live.clientSecret || process.env.YEASTAR_CLIENT_SECRET || "";

  // OAuth فقط — لم نعد ندعم username/password
  const authMode = (clientId && clientSecret) ? "oauth" : "";

  // حدّث state للسجلات
  state.lastBaseUrl    = base;
  state.lastBaseSource = src.baseUrl || "none";

  return {
    base, baseSource: src.baseUrl || "none",
    authMode, clientId, clientSecret,
    topics: (process.env.YEASTAR_API_TOPICS || "30012,30013,30014")
      .split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean),
  };
}

// -------------- HTTP helper مع timeout --------------
async function httpJson(url, opts = {}, timeoutMs = HTTP_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(tm);
  }
}

// -------------- HTTP: get/refresh token --------------
async function fetchToken() {
  const { base, baseSource, authMode, clientId, clientSecret } = cfg();
  if (!base) throw new Error("missing_yeastar_base_url");
  if (authMode !== "oauth") {
    throw new Error("missing_oauth_credentials (client_id + client_secret مطلوبان)");
  }

  // ⚠️ المسار ثابت تماماً — يُلحَق بـ base origin، لا يأتي من DB ولا من env.
  const url = `${base}/openapi/v1.0/get_token`;
  const payload = { client_id: clientId, client_secret: clientSecret };

  log(
    "get_token →", url,
    `(base="${base}" source=${baseSource})`,
    "auth=oauth",
    "client_id=" + maskSecret(clientId),
    "client_secret=" + maskSecret(clientSecret),
  );

  let res;
  try {
    res = await httpJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const reason = e.name === "AbortError" ? `timeout_${HTTP_TIMEOUT_MS}ms` : e.message;
    warn(`get_token network error: ${reason}`);
    throw new Error(`get_token_network_${reason}`);
  }

  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }

  if (!res.ok) {
    warn(`get_token HTTP ${res.status} errcode=${data.errcode ?? "-"} errmsg="${data.errmsg ?? ""}"`);
    throw new Error(`get_token_http_${res.status}_errcode_${data.errcode ?? "?"}_${data.errmsg || ""}`);
  }
  if (data.errcode && data.errcode !== 0) {
    warn(`get_token rejected by PBX: errcode=${data.errcode} errmsg="${data.errmsg ?? ""}"`);
    throw new Error(`get_token_errcode_${data.errcode}_${data.errmsg || ""}`);
  }

  const accessToken  = data.access_token  || data.data?.access_token;
  const refreshToken = data.refresh_token || data.data?.refresh_token;
  const expireSec    = data.expire_time   || data.data?.expire_time || 1800;
  if (!accessToken) {
    warn("get_token returned no access_token; raw keys=", Object.keys(data || {}));
    throw new Error("get_token_no_access_token");
  }

  state.accessToken  = accessToken;
  state.refreshToken = refreshToken || null;
  state.expireAt     = Date.now() + (expireSec * 1000);
  log(`get_token OK — access_token=${maskSecret(accessToken)} ttl=${expireSec}s`);
  scheduleRefresh(expireSec * 1000);
  return accessToken;
}

async function refreshAccessToken() {
  const { base, baseSource } = cfg();
  if (!state.refreshToken) return fetchToken();
  try {
    const url = `${base}/openapi/v1.0/refresh_token`;
    log(`refresh_token →`, url, `(base="${base}" source=${baseSource})`,
        "refresh_token=" + maskSecret(state.refreshToken));
    const res = await httpJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: state.refreshToken }),
    });
    if (!res.ok) throw new Error(`refresh_http_${res.status}`);
    const data = await res.json();
    if (data.errcode && data.errcode !== 0) throw new Error(`refresh_errcode_${data.errcode}`);
    const accessToken  = data.access_token  || data.data?.access_token;
    const refreshToken = data.refresh_token || data.data?.refresh_token || state.refreshToken;
    const expireSec    = data.expire_time   || data.data?.expire_time || 1800;
    state.accessToken  = accessToken;
    state.refreshToken = refreshToken;
    state.expireAt     = Date.now() + (expireSec * 1000);
    log(`refresh OK — new access_token=${maskSecret(accessToken)} ttl=${expireSec}s`);
    scheduleRefresh(expireSec * 1000);
    return accessToken;
  } catch (e) {
    warn("refresh failed, falling back to fresh get_token:", e.message);
    return fetchToken();
  }
}

function scheduleRefresh(ttlMs) {
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  const delay = Math.max(5_000, ttlMs - TOKEN_REFRESH_MARGIN_MS);
  state.refreshTimer = setTimeout(() => {
    if (state.stopped) return;
    refreshAccessToken().catch((e) => warn("auto-refresh:", e.message));
  }, delay).unref();
}

// -------------- WebSocket: subscribe to events --------------
function buildWsUrl(token) {
  const { base } = cfg();
  // حوّل http(s) إلى ws(s)
  const wsBase = base.replace(/^http/i, "ws");
  return `${wsBase}/openapi/v1.0/subscribe?access_token=${encodeURIComponent(token)}`;
}

function connectWs() {
  if (state.stopped) return;
  if (!state.accessToken) {
    warn("لا يوجد access_token — لن يُفتح WebSocket");
    return;
  }
  const url = buildWsUrl(state.accessToken);
  log("opening WebSocket to PBX subscribe endpoint…");

  const ws = new WebSocket(url, {
    handshakeTimeout: 10_000,
    perMessageDeflate: false,
  });
  state.ws = ws;

  ws.on("open", () => {
    state.reconnectMs = RECONNECT_MIN_MS;
    state.lastConnectedAt = Date.now();
    state.lastError = null;
    const { topics } = cfg();
    const sub = JSON.stringify({ topic_list: topics });
    ws.send(sub);
    log(`WebSocket OPEN — subscribed to topics: [${topics.join(", ")}]`);
  });

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); }
    catch { return warn("non-JSON ws message ignored"); }
    state.lastEventAt = Date.now();
    handleIncomingEvent(msg).catch((e) => warn("handle event:", e.message));
  });

  ws.on("close", (code, reason) => {
    warn(`WebSocket CLOSED code=${code} reason=${reason?.toString() || ""}`);
    state.lastError = `ws_closed_${code}`;
    scheduleReconnect();
  });

  ws.on("error", (e) => {
    state.lastError = e.message;
    warn("WebSocket ERROR:", e.message);
    // close سيُستدعى بعدها وسيُجدول reconnect
  });

  // ping/keepalive — Yeastar قد يقطع الاتصال الخامل
  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.ping(); } catch { /* noop */ }
    } else {
      clearInterval(pingTimer);
    }
  }, 30_000);
  pingTimer.unref?.();
}

function scheduleReconnect() {
  if (state.stopped) return;
  const delay = state.reconnectMs;
  state.reconnectMs = Math.min(state.reconnectMs * 2, RECONNECT_MAX_MS);
  log(`reconnect scheduled in ${Math.round(delay / 1000)}s…`);
  setTimeout(async () => {
    if (state.stopped) return;
    try {
      // إذا اقترب التوكن من الانتهاء، جدّده أولاً
      if (Date.now() > state.expireAt - TOKEN_REFRESH_MARGIN_MS) {
        await refreshAccessToken();
      }
      connectWs();
    } catch (e) {
      warn("reconnect failed:", e.message);
      scheduleReconnect();
    }
  }, delay).unref();
}

// -------------- Event normalizer --------------
async function handleIncomingEvent(msg) {
  // أحياناً يرسل ack للاشتراك أولاً
  if (msg.errcode !== undefined && msg.type === undefined) {
    if (msg.errcode === 0) log("PBX subscription ACK");
    else warn("PBX ACK error:", msg);
    return;
  }

  const topic = msg.type;
  const payload = msg.msg || msg.data || msg;

  let mapped = { ...payload };
  if (topic === 30012 || /call/i.test(payload.event_name || "")) {
    const st = (payload.call_status || payload.status || "").toString().toLowerCase();
    if (/ringing/.test(st))                     mapped.event = "ExtensionRing";
    else if (/answer|talking/.test(st))         mapped.event = "ExtensionAnswer";
    else if (/hangup|end|released/.test(st))    mapped.event = "ExtensionHangup";
    mapped.uuid       = payload.call_id || payload.uuid || payload.linkedid;
    mapped.extension  = payload.extension || payload.callee_num || payload.member_num;
    mapped.caller     = payload.caller_num || payload.from_num;
    mapped.direction  = payload.direction || (payload.call_type === "1" ? "outbound" : "inbound");
    mapped.duration   = payload.talk_duration || payload.duration || 0;
  } else if (topic === 30013 || /extension.*status/i.test(payload.event_name || "")) {
    mapped.event     = "ExtensionStatus";
    mapped.extension = payload.extension || payload.number;
    mapped.status    = (payload.presence_status || payload.status || "").toString().toLowerCase();
  }

  await handleNormalizedEvent(mapped, state.io, "yeastar-openapi");
}

// -------------- Public API --------------
export async function startYeastarOpenApi(io) {
  const { base, baseSource, authMode } = cfg();
  if (!base || authMode !== "oauth") {
    log("⏭️  Yeastar Open API DISABLED — يحتاج YEASTAR_BASE_URL + YEASTAR_CLIENT_ID + YEASTAR_CLIENT_SECRET");
    return;
  }
  state.io = io;
  state.stopped = false;
  log(`starting OpenAPI integration: base="${base}" (source=${baseSource}) auth=oauth`);
  try {
    await fetchToken();
    connectWs();
  } catch (e) {
    warn("start failed:", e.message);
    scheduleReconnect();
  }
}

export function stopYeastarOpenApi() {
  state.stopped = true;
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  try { state.ws?.close(); } catch { /* noop */ }
  state.ws = null;
}

export function getYeastarApiStatus() {
  const c = cfg();
  return {
    configured: Boolean(c.base && c.authMode === "oauth"),
    authMode: c.authMode || "none",
    baseUrl: c.base || null,
    baseUrlSource: c.baseSource || "none",
    hasToken: Boolean(state.accessToken),
    expiresIn: state.expireAt ? Math.max(0, Math.round((state.expireAt - Date.now()) / 1000)) : 0,
    wsState: state.ws ? state.ws.readyState : -1,   // 0:CONNECTING 1:OPEN 2:CLOSING 3:CLOSED
    topics: c.topics,
    lastConnectedAt: state.lastConnectedAt || null,
    lastEventAt:     state.lastEventAt || null,
    lastError:       state.lastError || null,
    disabled:        String(process.env.YEASTAR_OPENAPI_DISABLED || "").toLowerCase() === "true",
  };
}
