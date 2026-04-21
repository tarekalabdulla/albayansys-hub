// ============================================================
// Yeastar P-Series Open API client
// ------------------------------------------------------------
// نستخدم Open API:
//   1) نطلب access_token من /openapi/v1.0/get_token (تجديد تلقائي)
//   2) نفتح WebSocket على /openapi/v1.0/subscribe?access_token=...
//   3) نشترك بالأحداث (CDR / ExtensionStatus / CallStatus...)
//   4) نُمرّر الأحداث الواردة لنفس معالج الـ webhook (handleNormalizedEvent)
//
// ENV المطلوبة (طريقتان للمصادقة):
//   --- (أ) OAuth (موصى به) ---
//   YEASTAR_BASE_URL      = https://hululalbayan.ras.yeastar.com
//   YEASTAR_CLIENT_ID     = ...
//   YEASTAR_CLIENT_SECRET = ...
//
//   --- (ب) username/password (قديم) ---
//   YEASTAR_API_BASE = https://pbx.example.com:8088
//   YEASTAR_API_USER = ...
//   YEASTAR_API_PASS = ...
//
//   YEASTAR_API_TOPICS = 30012,30013,30014   (اختياري)
// ============================================================
import WebSocket from "ws";
import { handleNormalizedEvent } from "../routes/webhooks-yeastar.js";

const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000; // جدّد قبل الانتهاء بدقيقة

let state = {
  accessToken: null,
  refreshToken: null,
  expireAt: 0,         // ms epoch
  ws: null,
  reconnectMs: RECONNECT_MIN_MS,
  refreshTimer: null,
  stopped: false,
  io: null,
};

function log(...args) {
  console.log("[yeastar-api]", ...args);
}
function warn(...args) {
  console.warn("[yeastar-api]", ...args);
}

function cfg() {
  const base = (process.env.YEASTAR_BASE_URL || process.env.YEASTAR_API_BASE || "")
    .replace(/\/+$/, "");
  const clientId     = process.env.YEASTAR_CLIENT_ID || "";
  const clientSecret = process.env.YEASTAR_CLIENT_SECRET || "";
  const user = process.env.YEASTAR_API_USER || "";
  const pass = process.env.YEASTAR_API_PASS || "";
  // وضع المصادقة: OAuth إذا توفّر client_id+secret، وإلا username/password
  const authMode = clientId && clientSecret ? "oauth"
                 : (user && pass)            ? "basic"
                 : "";
  return {
    base, authMode, clientId, clientSecret, user, pass,
    topics: (process.env.YEASTAR_API_TOPICS || "30012,30013,30014")
      .split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean),
  };
}

// -------------- HTTP: get/refresh token --------------
async function fetchToken() {
  const { base, authMode, clientId, clientSecret, user, pass } = cfg();
  if (!base || !authMode) throw new Error("missing_yeastar_api_env");

  const url = `${base}/openapi/v1.0/get_token`;
  const body = authMode === "oauth"
    ? { client_id: clientId, client_secret: clientSecret }
    : { username: user, password: pass };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`get_token_http_${res.status}`);
  const data = await res.json();
  // أشكال شائعة في Yeastar: { errcode:0, access_token, refresh_token, expire_time }
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`get_token_errcode_${data.errcode}_${data.errmsg || ""}`);
  }
  const accessToken  = data.access_token  || data.data?.access_token;
  const refreshToken = data.refresh_token || data.data?.refresh_token;
  const expireSec    = data.expire_time   || data.data?.expire_time || 1800;
  if (!accessToken) throw new Error("get_token_no_access_token");

  state.accessToken  = accessToken;
  state.refreshToken = refreshToken || null;
  state.expireAt     = Date.now() + (expireSec * 1000);
  log(`access_token مُحدَّث (ينتهي خلال ${expireSec}s)`);
  scheduleRefresh(expireSec * 1000);
  return accessToken;
}

async function refreshAccessToken() {
  const { base } = cfg();
  if (!state.refreshToken) return fetchToken();
  try {
    const res = await fetch(`${base}/openapi/v1.0/refresh_token`, {
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
    log(`access_token جُدِّد بنجاح (ينتهي خلال ${expireSec}s)`);
    scheduleRefresh(expireSec * 1000);
    return accessToken;
  } catch (e) {
    warn("refresh فشل، نعيد get_token:", e.message);
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
  log("فتح WebSocket إلى PBX...");

  const ws = new WebSocket(url, {
    handshakeTimeout: 10_000,
    perMessageDeflate: false,
  });
  state.ws = ws;

  ws.on("open", () => {
    state.reconnectMs = RECONNECT_MIN_MS;
    const { topics } = cfg();
    const sub = JSON.stringify({ topic_list: topics });
    ws.send(sub);
    log(`WebSocket مفتوح — اشتراك في topics: [${topics.join(", ")}]`);
  });

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); }
    catch { return warn("رسالة غير JSON تم تجاهلها"); }
    handleIncomingEvent(msg).catch((e) => warn("handle event:", e.message));
  });

  ws.on("close", (code, reason) => {
    warn(`WebSocket مغلق code=${code} reason=${reason?.toString() || ""}`);
    scheduleReconnect();
  });

  ws.on("error", (e) => {
    warn("WebSocket خطأ:", e.message);
    // close سيُستدعى بعدها وسيُجدول reconnect
  });

  // ping/keepalive — Yeastar قد يقطع الاتصال الخامل
  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.ping(); } catch { }
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
  log(`إعادة الاتصال خلال ${Math.round(delay / 1000)}s...`);
  setTimeout(async () => {
    if (state.stopped) return;
    try {
      // إذا اقترب التوكن من الانتهاء، جدّده أولاً
      if (Date.now() > state.expireAt - TOKEN_REFRESH_MARGIN_MS) {
        await refreshAccessToken();
      }
      connectWs();
    } catch (e) {
      warn("reconnect فشل:", e.message);
      scheduleReconnect();
    }
  }, delay).unref();
}

// -------------- Event normalizer --------------
// Yeastar Open API يرسل event بصيغة:
//   { type: 30012, sn:"...", msg:{ ... event payload ... } }
// نُحوّله إلى نفس shape الذي يفهمه webhook normalizer
async function handleIncomingEvent(msg) {
  // أحياناً يرسل ack للاشتراك أولاً
  if (msg.errcode !== undefined && msg.type === undefined) {
    if (msg.errcode === 0) log("اشتراك مؤكَّد من PBX");
    else warn("ack خطأ من PBX:", msg);
    return;
  }

  const topic = msg.type;
  const payload = msg.msg || msg.data || msg;

  // مخطط مبدئي — يُغطّي معظم أحداث المكالمات والامتدادات
  // (Yeastar توثّق أرقام topic مثل 30012=CallStatus, 30013=ExtensionStatus...)
  let mapped = { ...payload };
  if (topic === 30012 || /call/i.test(payload.event_name || "")) {
    // CallStatus event: status في الـ payload
    const st = (payload.call_status || payload.status || "").toString().toLowerCase();
    if (/ringing/.test(st))      mapped.event = "ExtensionRing";
    else if (/answer|talking/.test(st)) mapped.event = "ExtensionAnswer";
    else if (/hangup|end|released/.test(st))   mapped.event = "ExtensionHangup";
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

  // مرّرها لمعالج webhook ليستفيد من نفس منطق DB + socket.io
  await handleNormalizedEvent(mapped, state.io, "yeastar-openapi");
}

// -------------- Public API --------------
export async function startYeastarOpenApi(io) {
  const { base, authMode } = cfg();
  if (!base || !authMode) {
    log("⏭️  Yeastar Open API معطّل (لم تُضبط YEASTAR_BASE_URL مع CLIENT_ID/SECRET أو API_USER/PASS)");
    return;
  }
  state.io = io;
  state.stopped = false;
  log(`بدء التكامل مع PBX: ${base} (auth=${authMode})`);
  try {
    await fetchToken();
    connectWs();
  } catch (e) {
    warn("بدء فشل:", e.message);
    scheduleReconnect();
  }
}

export function stopYeastarOpenApi() {
  state.stopped = true;
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  try { state.ws?.close(); } catch { }
  state.ws = null;
}

export function getYeastarApiStatus() {
  const c = cfg();
  return {
    configured: Boolean(c.base && c.authMode),
    authMode: c.authMode || "none",
    hasToken: Boolean(state.accessToken),
    expiresIn: state.expireAt ? Math.max(0, Math.round((state.expireAt - Date.now()) / 1000)) : 0,
    wsState: state.ws ? state.ws.readyState : -1,   // 0:CONNECTING 1:OPEN 2:CLOSING 3:CLOSED
    topics: c.topics,
  };
}
