// ============================================================================
// amiService — Asterisk Manager Interface client (Yeastar P-Series)
// ----------------------------------------------------------------------------
// عميل TCP مع:
//   * login + auto-reconnect مع exponential backoff
//   * heartbeat (ping action كل 20s)
//   * parser لرسائل AMI multi-line
//   * تطبيع أحداث Newchannel/Newstate/Hangup/BridgeEnter/AgentCalled إلى
//     NormalizedPbxEvent ويُمرّرها لـ pbxEventProcessor.
//
// لا يبدأ تلقائياً إلا عند ضبط YEASTAR_AMI_HOST + YEASTAR_AMI_USERNAME +
// YEASTAR_AMI_PASSWORD. مُعطَّل افتراضياً (PBX خلف RAS غير قابل للوصول).
//
// لا يستبدل yeastar-openapi.js — يعمل بجواره كمصدر live إضافي.
// ============================================================================
import net from "net";
import { processPbxEvent } from "./pbxEventProcessor.js";
import { getEffectiveConfigSync, subscribeConfig } from "./runtimeConfig.js";

const RECONNECT_MIN_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
const HEARTBEAT_MS     = 20_000;

let state = {
  socket: null,
  buffer: "",
  loggedIn: false,
  reconnectMs: RECONNECT_MIN_MS,
  hbTimer: null,
  stopped: true,
  io: null,
  actionId: 0,
  lastConnectedAt: 0,
  lastEventAt: 0,
  lastError: null,
};

function log(...a)  { console.log("[ami]", ...a); }
function warn(...a) { console.warn("[ami]", ...a); }

function cfg() {
  // الأولوية: DB (runtimeConfig) ← .env
  const rc = getEffectiveConfigSync();
  return {
    host: rc.amiHost     || process.env.YEASTAR_AMI_HOST     || "",
    port: rc.amiPort     || parseInt(process.env.YEASTAR_AMI_PORT || "5038", 10),
    user: rc.amiUsername || process.env.YEASTAR_AMI_USERNAME || "",
    pass: rc.amiPassword || process.env.YEASTAR_AMI_PASSWORD || "",
    enabled: rc.enableAMI !== false,
  };
}

export function isAmiConfigured() {
  const c = cfg();
  return Boolean(c.host && c.user && c.pass);
}

export function isAmiEnabled() {
  const c = cfg();
  return c.enabled && Boolean(c.host && c.user && c.pass);
}

// ----------------------------------------------------------------------------
// AMI protocol: action serializer + multi-message parser
// ----------------------------------------------------------------------------
function sendAction(action) {
  if (!state.socket || !state.socket.writable) return;
  state.actionId += 1;
  const payload = { ActionID: `lov-${state.actionId}`, ...action };
  const lines = Object.entries(payload).map(([k, v]) => `${k}: ${v}`).join("\r\n");
  state.socket.write(lines + "\r\n\r\n");
}

function parseChunk(chunk) {
  state.buffer += chunk;
  const messages = [];
  let idx;
  while ((idx = state.buffer.indexOf("\r\n\r\n")) !== -1) {
    const raw = state.buffer.slice(0, idx);
    state.buffer = state.buffer.slice(idx + 4);
    const obj = {};
    for (const line of raw.split("\r\n")) {
      const i = line.indexOf(":");
      if (i === -1) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      obj[k] = v;
    }
    if (Object.keys(obj).length) messages.push(obj);
  }
  return messages;
}

// ----------------------------------------------------------------------------
// Event normalizer: AMI Event → NormalizedPbxEvent
// ----------------------------------------------------------------------------
function amiToNormalized(evt) {
  const event = (evt.Event || "").toString();
  const linkedId = evt.Linkedid || evt.LinkedID || evt.UniqueID || evt.Uniqueid || "";
  const uniqueId = evt.Uniqueid || evt.UniqueID || "";

  // اشتقاق eventId افتراضي يقابل أحداث Yeastar OpenAPI
  let eventId = null;
  let kindHint = null;
  switch (event) {
    case "Newchannel":  eventId = 30011; kindHint = "ring"; break;
    case "Newstate":    eventId = 30011; kindHint = (evt.ChannelStateDesc || "").toLowerCase(); break;
    case "DialBegin":   eventId = 30011; kindHint = "ring"; break;
    case "DialEnd":     eventId = 30011; kindHint = (evt.DialStatus || "").toLowerCase(); break;
    case "BridgeEnter": eventId = 30011; kindHint = "answer"; break;
    case "Hangup":      eventId = 30012; kindHint = "hangup"; break;
    case "Cdr":         eventId = 30012; kindHint = "end"; break;
    case "ExtensionStatus": eventId = 30008; kindHint = "ext_state"; break;
    case "AgentCalled": eventId = 30011; kindHint = "ring"; break;
    case "AgentRingNoAnswer": eventId = 30026; kindHint = "ring_timeout"; break;
    case "BlindTransfer":
    case "AttendedTransfer":
      eventId = 30013; kindHint = "transfer"; break;
    default:
      return null; // تجاهل بقية الأحداث
  }

  // استخرج extension و remote number
  const channel = evt.Channel || "";
  const callerIdNum = evt.CallerIDNum || evt.ConnectedLineNum || "";
  const exten = evt.Exten || evt.ConnectedLineNum || "";
  // مثال Channel: SIP/1001-00000003 → ext = 1001
  const extMatch = channel.match(/[A-Z]+\/(\d{2,5})-/);
  const ext = (extMatch?.[1]) || (/^\d{2,5}$/.test(exten) ? exten : "");

  return {
    eventId,
    eventName: event,
    source: "ami",
    linkedId,
    callId: uniqueId,
    ext,
    remoteNumber: callerIdNum,
    fromNum: evt.CallerIDNum || "",
    toNum: evt.Exten || evt.ConnectedLineNum || "",
    direction: ext && callerIdNum && /^\d{2,5}$/.test(callerIdNum) ? "internal" : null,
    trunk: (channel.match(/PJSIP\/(trunk-[^-]+)/) || [])[1] || null,
    duration: parseInt(evt.Duration || 0, 10),
    talkDuration: parseInt(evt.BillableSeconds || evt.Billsec || 0, 10),
    status: kindHint,
    failureReason: kindHint && /no.?answer|busy|cancel|fail/.test(kindHint) ? kindHint : null,
    payload: { ...evt, _amiEvent: event },
    timestamp: Date.now(),
  };
}

// ----------------------------------------------------------------------------
// Connection lifecycle
// ----------------------------------------------------------------------------
function connect() {
  if (state.stopped) return;
  const c = cfg();
  log(`connecting to ${c.host}:${c.port}...`);

  const socket = new net.Socket();
  state.socket = socket;
  state.buffer = "";
  state.loggedIn = false;

  socket.setKeepAlive(true, 10_000);
  socket.setTimeout(0);

  socket.connect(c.port, c.host, () => {
    log("TCP connected, sending Login...");
    state.lastConnectedAt = Date.now();
    state.lastError = null;
    sendAction({ Action: "Login", Username: c.user, Secret: c.pass, Events: "on" });
  });

  socket.on("data", (data) => {
    const messages = parseChunk(data.toString("utf8"));
    for (const msg of messages) {
      handleAmiMessage(msg).catch((e) => warn("handle:", e.message));
    }
  });

  socket.on("error", (e) => { state.lastError = e.message; warn("socket error:", e.message); });

  socket.on("close", () => {
    warn("socket closed");
    cleanup();
    scheduleReconnect();
  });
}

function cleanup() {
  if (state.hbTimer) { clearInterval(state.hbTimer); state.hbTimer = null; }
  state.loggedIn = false;
  state.socket = null;
}

function scheduleReconnect() {
  if (state.stopped) return;
  const delay = state.reconnectMs;
  state.reconnectMs = Math.min(state.reconnectMs * 2, RECONNECT_MAX_MS);
  log(`reconnect in ${Math.round(delay / 1000)}s`);
  setTimeout(connect, delay).unref();
}

function startHeartbeat() {
  if (state.hbTimer) clearInterval(state.hbTimer);
  state.hbTimer = setInterval(() => {
    if (state.socket?.writable && state.loggedIn) {
      sendAction({ Action: "Ping" });
    }
  }, HEARTBEAT_MS);
  state.hbTimer.unref?.();
}

async function handleAmiMessage(msg) {
  // Login response
  if (msg.Response && !state.loggedIn) {
    if (msg.Response === "Success") {
      state.loggedIn = true;
      state.reconnectMs = RECONNECT_MIN_MS;
      log("✅ AMI login OK");
      startHeartbeat();
    } else {
      warn(`login failed: ${msg.Message || "unknown"}`);
      state.socket?.destroy();
    }
    return;
  }

  if (msg.Response === "Pong") return;

  // Event handling
  if (msg.Event) {
    const normalized = amiToNormalized(msg);
    if (!normalized) return;
    state.lastEventAt = Date.now();
    try {
      await processPbxEvent(normalized, state.io);
    } catch (e) {
      warn(`processPbxEvent[${msg.Event}]:`, e.message);
    }
  }
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------
export function startAmiService(io) {
  if (!isAmiConfigured()) {
    log("⏭️  AMI disabled (YEASTAR_AMI_HOST/USERNAME/PASSWORD not set)");
    return;
  }
  state.io = io;
  state.stopped = false;
  state.reconnectMs = RECONNECT_MIN_MS;
  connect();
}

export function stopAmiService() {
  state.stopped = true;
  try { state.socket?.destroy(); } catch {}
  cleanup();
}

export function getAmiStatus() {
  return {
    configured: isAmiConfigured(),
    connected: Boolean(state.socket && !state.socket.destroyed),
    loggedIn: state.loggedIn,
    host: cfg().host || null,
    port: cfg().port,
    lastConnectedAt: state.lastConnectedAt || null,
    lastEventAt:     state.lastEventAt || null,
    lastError:       state.lastError || null,
  };
}
