// ============================================================
// Yeastar P-Series Open API client
// ------------------------------------------------------------
// نستخدم Open API:
//   1) نطلب access_token من /openapi/v1.0/get_token (تجديد تلقائي)
//   2) نفتح WebSocket على /openapi/v1.0/subscribe?access_token=...
//   3) نشترك بالأحداث (CDR / ExtensionStatus / CallStatus...)
//   4) نُمرّر الأحداث الواردة لنفس معالج الـ webhook (handleNormalizedEvent)
//
// ⚠️  fix 2026-04 (C):
//     - إبقاء baseUrl معقّمًا وصحيحًا
//     - دعم وضعين صريحين للمصادقة:
//         1) client_credentials  → client_id + client_secret
//         2) basic_credentials   → username + password
//     - إذا رفض PBX وضع client_credentials بـ errcode=40002 PARAMETER ERROR
//       ووجدنا username/password مضبوطين، نجرّب basic_credentials تلقائيًا.
// ============================================================
import WebSocket from "ws";
import { handleNormalizedEvent } from "../routes/webhooks-yeastar.js";
import {
  getEffectiveConfigSync,
  getConfigSource,
  sanitizeBaseUrl,
  buildAuthPayloadShape,
} from "../services/runtimeConfig.js";

const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const HTTP_TIMEOUT_MS = 15_000;

let state = {
  accessToken: null,
  refreshToken: null,
  expireAt: 0,
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
  lastAuthModeUsed: null,
};

function log(...args) {
  console.log("[yeastar-api]", ...args);
}

function warn(...args) {
  console.warn("[yeastar-api]", ...args);
}

function maskSecret(s) {
  if (!s || typeof s !== "string") return "(empty)";
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-2)} (len=${s.length})`;
}

function cfg() {
  const live = getEffectiveConfigSync() || {};
  const src = getConfigSource() || { baseUrl: "none" };

  const rawBase =
    live.baseUrl ||
    process.env.YEASTAR_BASE_URL ||
    process.env.YEASTAR_API_BASE ||
    "";

  const base = sanitizeBaseUrl(rawBase);

  if (rawBase && base !== rawBase.replace(/\/+$/, "")) {
    warn(`baseUrl was sanitized: raw="${rawBase}" → clean="${base}" (source=${src.baseUrl})`);
  }

  const shape = buildAuthPayloadShape(live);

  state.lastBaseUrl = base;
  state.lastBaseSource = src.baseUrl || "none";

  return {
    live,
    base,
    baseSource: src.baseUrl || "none",
    authMode: shape.effectiveMode,
    authFields: shape.fields,
    authPayload: shape.payload,
    authMissing: shape.missing,
    authExplicit: shape.explicit,
    topics: (process.env.YEASTAR_API_TOPICS || "30012,30013,30014")
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter(Boolean),
  };
}

async function httpJson(url, opts = {}, timeoutMs = HTTP_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(tm);
  }
}

function buildTokenUrl(base) {
  return `${base}/openapi/v1.0/get_token`;
}

function makeAuthAttempt(mode, payload, fields, explicit = true) {
  return {
    mode,
    payload,
    fields,
    explicit,
  };
}

function isNonEmpty(v) {
  return typeof v === "string" ? v.trim().length > 0 : Boolean(v);
}

function buildFallbackAttempts() {
  const { live, authMode, authFields, authPayload, authExplicit } = cfg();

  const attempts = [];
  const seen = new Set();

  const pushAttempt = (mode, payload, fields, explicit = true) => {
    const key = `${mode}:${fields.join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push(makeAuthAttempt(mode, payload, fields, explicit));
  };

  if (authFields.length && Object.keys(authPayload || {}).length) {
    pushAttempt(authMode, authPayload, authFields, authExplicit);
  }

  const clientId =
    live.clientId ||
    process.env.YEASTAR_CLIENT_ID ||
    "";

  const clientSecret =
    live.clientSecret ||
    process.env.YEASTAR_CLIENT_SECRET ||
    "";

  const apiUser =
    live.apiUser ||
    process.env.YEASTAR_API_USER ||
    "";

  const apiPass =
    live.apiPass ||
    process.env.YEASTAR_API_PASS ||
    "";

  const hasClientCreds = isNonEmpty(clientId) && isNonEmpty(clientSecret);
  const hasBasicCreds = isNonEmpty(apiUser) && isNonEmpty(apiPass);

  if (hasClientCreds) {
    pushAttempt(
      "client_credentials",
      {
        client_id: clientId,
        client_secret: clientSecret,
      },
      ["client_id", "client_secret"],
      true
    );
  }

  if (hasBasicCreds) {
    pushAttempt(
      "basic_credentials",
      {
        username: apiUser,
        password: apiPass,
      },
      ["username", "password"],
      true
    );
  }

  return attempts;
}

function isParamError40002(data) {
  return String(data?.errcode || "") === "40002";
}

async function executeGetTokenAttempt(url, base, baseSource, attempt) {
  log(
    "get_token →",
    url,
    `(base="${base}" source=${baseSource})`,
    `authMode="${attempt.mode}"${attempt.explicit ? "" : " (inferred)"}`,
    `fields=[${attempt.fields.join(", ")}]`,
    `values={ ${attempt.fields
      .map((f) => `${f}=${maskSecret(attempt.payload[f])}`)
      .join(", ")} }`
  );

  let res;
  try {
    res = await httpJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(attempt.payload),
    });
  } catch (e) {
    const reason = e.name === "AbortError" ? `timeout_${HTTP_TIMEOUT_MS}ms` : e.message;
    warn(`get_token network error: ${reason} authMode="${attempt.mode}" endpoint="${url}"`);
    throw new Error(`get_token_network_${reason}`);
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    warn(
      `get_token HTTP ${res.status} authMode="${attempt.mode}" ` +
      `errcode=${data.errcode ?? "-"} errmsg="${data.errmsg ?? ""}" endpoint="${url}"`
    );

    return {
      ok: false,
      res,
      data,
      attempt,
      reason: `http_${res.status}`,
    };
  }

  if (data.errcode && data.errcode !== 0) {
    warn(
      `get_token rejected by PBX: authMode="${attempt.mode}" ` +
      `errcode=${data.errcode} errmsg="${data.errmsg ?? ""}" endpoint="${url}"`
    );

    return {
      ok: false,
      res,
      data,
      attempt,
      reason: `pbx_err_${data.errcode}`,
    };
  }

  const accessToken = data.access_token || data.data?.access_token;
  const refreshToken = data.refresh_token || data.data?.refresh_token;
  const expireSec = data.expire_time || data.data?.expire_time || 1800;

  if (!accessToken) {
    warn("get_token returned no access_token; raw keys=", Object.keys(data || {}));
    return {
      ok: false,
      res,
      data,
      attempt,
      reason: "no_access_token",
    };
  }

  state.accessToken = accessToken;
  state.refreshToken = refreshToken || null;
  state.expireAt = Date.now() + expireSec * 1000;
  state.lastAuthModeUsed = attempt.mode;

  log(
    `get_token OK — access_token=${maskSecret(accessToken)} ttl=${expireSec}s authMode="${attempt.mode}"`
  );

  scheduleRefresh(expireSec * 1000);

  return {
    ok: true,
    accessToken,
    authModeUsed: attempt.mode,
  };
}

async function fetchToken() {
  const { base, baseSource } = cfg();

  if (!base) {
    throw new Error("missing_yeastar_base_url");
  }

  const attempts = buildFallbackAttempts();
  if (!attempts.length) {
    throw new Error("missing_yeastar_auth_credentials");
  }

  const url = buildTokenUrl(base);
  let lastFailure = null;

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    const result = await executeGetTokenAttempt(url, base, baseSource, attempt);

    if (result.ok) {
      return result.accessToken;
    }

    lastFailure = result;

    const shouldTryNext =
      i < attempts.length - 1 &&
      (
        (attempt.mode === "client_credentials" && isParamError40002(result.data)) ||
        result.reason === "http_401" ||
        result.reason === "http_400"
      );

    if (shouldTryNext) {
      warn(
        `get_token fallback: switching from authMode="${attempt.mode}" to authMode="${attempts[i + 1].mode}"`
      );
      continue;
    }

    break;
  }

  const code = lastFailure?.data?.errcode ?? "?";
  const msg = lastFailure?.data?.errmsg || "";
  throw new Error(`get_token_errcode_${code}_${msg || "UNKNOWN"}`);
}

async function refreshAccessToken() {
  const { base, baseSource } = cfg();

  if (!state.refreshToken) {
    return fetchToken();
  }

  try {
    const url = `${base}/openapi/v1.0/refresh_token`;
    log(
      `refresh_token →`,
      url,
      `(base="${base}" source=${baseSource})`,
      "refresh_token=" + maskSecret(state.refreshToken)
    );

    const res = await httpJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: state.refreshToken }),
    });

    if (!res.ok) throw new Error(`refresh_http_${res.status}`);

    const data = await res.json();

    if (data.errcode && data.errcode !== 0) {
      throw new Error(`refresh_errcode_${data.errcode}`);
    }

    const accessToken = data.access_token || data.data?.access_token;
    const refreshToken = data.refresh_token || data.data?.refresh_token || state.refreshToken;
    const expireSec = data.expire_time || data.data?.expire_time || 1800;

    state.accessToken = accessToken;
    state.refreshToken = refreshToken;
    state.expireAt = Date.now() + expireSec * 1000;

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
  }, delay);

  state.refreshTimer.unref?.();
}

function buildWsUrl(token) {
  const { base } = cfg();
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
    try {
      msg = JSON.parse(data.toString());
    } catch {
      warn("non-JSON ws message ignored");
      return;
    }

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
  });

  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping();
      } catch {
        // noop
      }
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

  const timer = setTimeout(async () => {
    if (state.stopped) return;

    try {
      if (Date.now() > state.expireAt - TOKEN_REFRESH_MARGIN_MS) {
        await refreshAccessToken();
      }
      connectWs();
    } catch (e) {
      warn("reconnect failed:", e.message);
      scheduleReconnect();
    }
  }, delay);

  timer.unref?.();
}

async function handleIncomingEvent(msg) {
  if (msg.errcode !== undefined && msg.type === undefined) {
    if (msg.errcode === 0) {
      log("PBX subscription ACK");
    } else {
      warn("PBX ACK error:", msg);
    }
    return;
  }

  const topic = msg.type;
  const payload = msg.msg || msg.data || msg;

  let mapped = { ...payload };

  if (topic === 30012 || /call/i.test(payload.event_name || "")) {
    const st = (payload.call_status || payload.status || "").toString().toLowerCase();

    if (/ringing/.test(st)) mapped.event = "ExtensionRing";
    else if (/answer|talking/.test(st)) mapped.event = "ExtensionAnswer";
    else if (/hangup|end|released/.test(st)) mapped.event = "ExtensionHangup";

    mapped.uuid = payload.call_id || payload.uuid || payload.linkedid;
    mapped.extension = payload.extension || payload.callee_num || payload.member_num;
    mapped.caller = payload.caller_num || payload.from_num;
    mapped.direction = payload.direction || (payload.call_type === "1" ? "outbound" : "inbound");
    mapped.duration = payload.talk_duration || payload.duration || 0;
  } else if (topic === 30013 || /extension.*status/i.test(payload.event_name || "")) {
    mapped.event = "ExtensionStatus";
    mapped.extension = payload.extension || payload.number;
    mapped.status = (payload.presence_status || payload.status || "").toString().toLowerCase();
  }

  await handleNormalizedEvent(mapped, state.io, "yeastar-openapi");
}

export async function startYeastarOpenApi(io) {
  const {
    base,
    baseSource,
    authMode,
    authFields,
    authMissing,
  } = cfg();

  if (!base) {
    log("⏭️  Yeastar Open API DISABLED — YEASTAR_BASE_URL غير مضبوط");
    return;
  }

  if (authMissing.length) {
    log(
      `⏭️  Yeastar Open API DISABLED — authMode="${authMode}" ` +
      `لكن الحقول الناقصة: [${authMissing.join(", ")}] (المتوقّع: [${authFields.join(", ")}])`
    );
    return;
  }

  state.io = io;
  state.stopped = false;

  log(
    `starting OpenAPI integration: base="${base}" (source=${baseSource}) ` +
    `authMode="${authMode}" fields=[${authFields.join(", ")}]`
  );

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

  if (state.refreshTimer) {
    clearTimeout(state.refreshTimer);
  }

  try {
    state.ws?.close();
  } catch {
    // noop
  }

  state.ws = null;
}

export function getYeastarApiStatus() {
  const c = cfg();

  return {
    configured: Boolean(c.base && c.authMissing.length === 0),
    authMode: c.authMode || "none",
    authFields: c.authFields || [],
    authMissing: c.authMissing || [],
    authModeUsed: state.lastAuthModeUsed || null,
    baseUrl: c.base || null,
    baseUrlSource: c.baseSource || "none",
    hasToken: Boolean(state.accessToken),
    expiresIn: state.expireAt ? Math.max(0, Math.round((state.expireAt - Date.now()) / 1000)) : 0,
    wsState: state.ws ? state.ws.readyState : -1,
    topics: c.topics,
    lastConnectedAt: state.lastConnectedAt || null,
    lastEventAt: state.lastEventAt || null,
    lastError: state.lastError || null,
    disabled: String(process.env.YEASTAR_OPENAPI_DISABLED || "").toLowerCase() === "true",
  };
}