import express, { Router } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { processPbxEvent } from "../services/pbxEventProcessor.js";
import { recordWebhookEvent, recordWebhookRejection } from "./webhooks-yeastar.js";
import { getEffectiveConfigSync } from "../services/runtimeConfig.js";

const router = Router();

// ----------------------------------------------------------------------------
// Rate limit: 200/sec/IP — أعلى من webhook القديم لأن PBX قد يرسل دفعات
// ----------------------------------------------------------------------------
const limiter = rateLimit({
  windowMs: 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const xff = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
    return xff || req.ip || "unknown";
  },
  handler: (_req, res) => res.status(429).json({ error: "rate_limited" }),
});

// ----------------------------------------------------------------------------
// Raw body capture — صحيح مع express.json() العام
// ----------------------------------------------------------------------------
const rawJson = express.raw({
  type: "application/json",
  limit: "1mb",
});

function parseRawJsonBody(req, _res, next) {
  try {
    req.rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    req.body = req.rawBody.length ? JSON.parse(req.rawBody.toString("utf8")) : {};
    next();
  } catch {
    req.rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    req.body = {};
    next();
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function safeEqualText(a, b) {
  const aa = Buffer.from(String(a || "").trim());
  const bb = Buffer.from(String(b || "").trim());

  if (!aa.length || !bb.length || aa.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(aa, bb);
}

function normalizeSignatureHeader(value) {
  return String(value || "")
    .trim()
    .replace(/^sha256=/i, "")
    .replace(/^hmac-sha256=/i, "")
    .replace(/^base64=/i, "")
    .replace(/^"|"$/g, "")
    .trim();
}

function safeCompareText(a, b) {
  const aa = Buffer.from(String(a || "").trim());
  const bb = Buffer.from(String(b || "").trim());

  if (!aa.length || !bb.length || aa.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(aa, bb);
}

function normalizeWebhookSignature(value) {
  return String(value || "")
    .trim()
    .replace(/^sha256=/i, "")
    .replace(/^hmac-sha256=/i, "")
    .replace(/^base64=/i, "")
    .replace(/^"|"$/g, "")
    .trim();
}

function verifyHmac(rawBody, sigHeader) {
  try {
    const runtimeCfg = getEffectiveConfigSync();
    const secret = String(runtimeCfg.webhookSecret || process.env.YEASTAR_WEBHOOK_SECRET || "").trim();

    // إذا لم يوجد secret لا نفرض HMAC.
    if (!secret) return true;

    const originalHeader = String(sigHeader || "").trim();

    if (!originalHeader) {
      console.warn("[yeastar-webhook-v2] missing HMAC signature header");
      return false;
    }

    const bodyBuffer = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(rawBody ? String(rawBody) : "", "utf8");

    const digest = crypto
      .createHmac("sha256", secret)
      .update(bodyBuffer)
      .digest();

    // Yeastar الرسمي يستخدم Base64 في X-Signature.
    const expectedBase64 = digest.toString("base64");

    // نبقي hex حتى تبقى اختبارات النظام الداخلية القديمة تعمل.
    const expectedHex = digest.toString("hex");

    const expectedBase64Url = expectedBase64
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    const normalize = (v) =>
      String(v || "")
        .trim()
        .replace(/^sha256=/i, "")
        .replace(/^hmac-sha256=/i, "")
        .replace(/^base64=/i, "")
        .replace(/^"|"$/g, "")
        .trim();

    const received = normalize(originalHeader);

    const candidates = [
      expectedBase64,
      expectedHex,
      expectedBase64Url,
      normalize(expectedBase64),
      normalize(expectedHex),
      normalize(expectedBase64Url),
    ];

    const ok = candidates.some((expected) => {
      const a = Buffer.from(String(received));
      const b = Buffer.from(String(expected));
      return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
    });

    if (!ok) {
      console.warn(
        `[yeastar-webhook-v2] HMAC mismatch details: header_len=${received.length} base64_len=${expectedBase64.length} hex_len=${expectedHex.length} raw_len=${bodyBuffer.length}`
      );
    }

    return ok;
  } catch (e) {
    console.warn("[yeastar-webhook-v2] HMAC verify exception:", e?.message || e);
    return false;
  }
}

// ----------------------------------------------------------------------------
// Normalize Yeastar OpenAPI event → NormalizedPbxEvent
// ----------------------------------------------------------------------------
function cleanPbxNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const n = raw.replace(/[^0-9+]/g, "").replace(/^\+/, "");
  if (!n || /^0+$/.test(n)) return "";
  return n;
}

function shortExt(value) {
  const n = String(value ?? "").replace(/[^0-9]/g, "");
  if (n.length >= 2 && n.length <= 5 && !/^0+$/.test(n)) return n;
  return "";
}

function normalizeYeastarEvent(body) {
  const payload = body?.msg || body?.data || body?.payload || body || {};

  const members = Array.isArray(payload.members) ? payload.members : [];
  const firstMember = members[0] || {};
  const firstExt = firstMember.extension || firstMember.ext || {};

  const memberStatusRaw = String(
    firstExt.member_status ||
    firstMember.member_status ||
    payload.member_status ||
    payload.call_status ||
    payload.status ||
    ""
  ).trim();

  const memberStatus = memberStatusRaw.toUpperCase();
  const hasMembersShape = members.length > 0 || Boolean(firstExt.number || firstExt.channel_id);

  let eventId = parseInt(body.type || body.event_id || body.eventId || payload.type || payload.event_id || 0, 10) || null;
  let eventName = body.event_name || body.eventName || payload.event_name || payload.eventName || "";

  // إذا وصل شكل members/call_id بدون event_id فهو غالبًا CallStateChanged.
  if (!eventId && hasMembersShape) {
    eventId = 30011;
    eventName = "CallStateChanged";
  }

  // إذا وصل شكل CDR/CallEndDetails بدون event_id وفيه uid/call_from/call_to فهو 30012.
  if (!eventId && (payload.uid || payload.call_from || payload.call_to || payload.call_duration || payload.recording)) {
    eventId = 30012;
    eventName = "CallEndDetailsNotification";
  }

  const statusMap = {
    ALERT: "ringing",
    RING: "ringing",
    RINGING: "ringing",
    DIALING: "ringing",
    PROGRESS: "ringing",

    ANSWER: "answered",
    ANSWERED: "answered",
    CONNECTED: "answered",
    UP: "answered",
    TALKING: "talking",

    BYE: "hangup",
    HANGUP: "hangup",
    RELEASED: "released",
    TERMINATED: "terminated",
    END: "end",
    ENDED: "end",

    BUSY: "busy",
    NOANSWER: "no_answer",
    "NO ANSWER": "no_answer",
    CANCEL: "cancelled",
    CANCELLED: "cancelled",
    FAILED: "failed",
  };

  const normalizedStatus =
    statusMap[memberStatus] ||
    payload.call_status ||
    payload.status ||
    memberStatusRaw ||
    null;

  const rawDirection = String(payload.direction || payload.call_type || payload.type || "").toLowerCase();

  let direction = "unknown";
  if (/outbound|outgoing|^out$/.test(rawDirection) || payload.call_type === "1") {
    direction = "outgoing";
  } else if (/inbound|incoming|^in$/.test(rawDirection) || payload.call_type === "2") {
    direction = "incoming";
  } else if (/internal/.test(rawDirection)) {
    direction = "internal";
  }

  const callFrom = cleanPbxNumber(payload.call_from_number || payload.call_from || payload.caller_num || payload.from_num);
  const callTo   = cleanPbxNumber(payload.call_to_number   || payload.call_to   || payload.callee_num || payload.to_num);

  const extFrom = shortExt(payload.call_from || payload.call_from_number || payload.caller_num || payload.from_num);
  const extTo   = shortExt(payload.call_to   || payload.call_to_number   || payload.callee_num || payload.to_num);

  let extNumber = String(
    firstExt.number ||
    firstExt.ext ||
    firstMember.number ||
    payload.extension ||
    payload.ext ||
    payload.member_num ||
    ""
  ).trim();

  if (!extNumber) {
    if (direction === "outgoing") extNumber = extFrom || extTo;
    else if (direction === "incoming") extNumber = extTo || extFrom;
    else extNumber = extFrom || extTo;
  }

  let remoteNumber = "";
  if (direction === "outgoing") {
    remoteNumber = callTo || callFrom;
  } else if (direction === "incoming") {
    remoteNumber = callFrom || callTo;
  } else {
    remoteNumber =
      cleanPbxNumber(payload.remote_number || payload.peer_num || payload.number || payload.did_number || payload.dod_number) ||
      callFrom ||
      callTo;
  }

  // لا تجعل التحويلة نفسها رقمًا خارجيًا.
  if (remoteNumber && extNumber && remoteNumber === extNumber) {
    remoteNumber = "";
  }

  const callId = String(
    payload.call_id ||
    payload.uniqueid ||
    payload.uuid ||
    payload.linkedid ||
    payload.linked_id ||
    body.call_id ||
    ""
  ).trim();

  return {
    eventId,
    eventName,
    source: "webhook",
    linkedId: payload.linkedid || payload.linked_id || callId || "",
    callId,
    ext: extNumber,
    remoteNumber,
    fromNum: callFrom || "",
    toNum: callTo || "",
    direction,
    callType: payload.call_type || payload.type || null,
    trunk: payload.trunk_name || payload.src_trunk_name || payload.dst_trunk_name || payload.trunk || null,
    queue: payload.queue_name || payload.queue || null,
    duration: parseInt(payload.duration || payload.call_duration || 0, 10),
    talkDuration: parseInt(payload.talk_duration || payload.billsec || 0, 10),
    status: normalizedStatus,
    failureReason: payload.hangup_cause || payload.failure_reason || payload.reason || null,
    transferFrom: payload.transfer_from || payload.transferer || null,
    transferTo: payload.transfer_to || payload.transferee || null,
    forwardedTo: payload.forwarded_to || payload.forward_to || null,
    recordingFile: payload.recording_file || payload.recording || payload.file_name || null,
    recordingUrl: payload.recording_url || payload.download_url || null,
    payload: {
      ...body,
      status: normalizedStatus,
      call_status: normalizedStatus,
      member_status: memberStatusRaw,
      _member_status: memberStatusRaw,
      _normalized_direction: direction,
      _normalized_remote_number: remoteNumber,
      _normalized_ext: extNumber,
    },
    timestamp: parseInt(payload.timestamp || payload.event_time || Date.now(), 10),
  };
}

// ----------------------------------------------------------------------------
// المعالج الرئيسي — رد سريع 200 ثم async processing
// ----------------------------------------------------------------------------
function handleEvent(req, res) {
  const io = req.app.get("io");
  const cfg = getEffectiveConfigSync();

  // 0) toggle
  if (cfg.enableWebhook === false) {
    recordWebhookRejection("webhook_disabled");
    return res.status(503).json({ error: "webhook_disabled" });
  }

  // 0.5) IP allowlist (حيّ من DB ∪ .env)
  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    "";

  const allowed = Array.isArray(cfg.allowedIps) ? cfg.allowedIps : [];
  if (allowed.length && !allowed.includes(ip)) {
    recordWebhookRejection(`ip_not_allowed:${ip}`);
    return res.status(403).json({ error: "ip_not_allowed" });
  }

  const expectedToken = process.env.YEASTAR_WEBHOOK_TOKEN || "";
  const providedToken = req.params.token || "";

  // 1) URL token validation
  if (expectedToken) {
    if (!providedToken || providedToken !== expectedToken) {
      console.warn("[yeastar-webhook-v2] invalid token from", ip);
      recordWebhookRejection("invalid_token");
      return res.status(401).json({ error: "invalid_token" });
    }
  }

  // 2) HMAC (اختياري إذا secret غير مضبوط)
  const sig = req.headers["x-yeastar-signature"] || req.headers["x-signature"] || req.headers["x-signature-256"] || "";
  if (!verifyHmac(req.rawBody || Buffer.from(""), sig)) {
    console.warn("[yeastar-webhook-v2] invalid HMAC from", ip);
    recordWebhookRejection("invalid_signature");
    return res.status(401).json({ error: "invalid_signature" });
  }

  // 3) حدّث telemetry مباشرة قبل الرد
  recordWebhookEvent(ip, req.body || {});

  // 4) رد سريع جدًا
  res.status(200).json({ ok: true, received: true });

  // 5) معالجة async
  setImmediate(async () => {
    try {
      const normalized = normalizeYeastarEvent(req.body || {});
      await processPbxEvent(normalized, io);
    } catch (e) {
      console.error("[yeastar-webhook-v2] async processing failed:", e.message);
      recordWebhookRejection(`processing_failed:${e.message}`);
    }
  });
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------
router.get("/health", (_req, res) => {
  const cfg = getEffectiveConfigSync();
  res.json({
    ok: true,
    enabled: cfg.enableWebhook !== false,
    tokenRequired: Boolean(process.env.YEASTAR_WEBHOOK_TOKEN),
    hmacRequired: Boolean(cfg.webhookSecret),
    allowedIps: Array.isArray(cfg.allowedIps) ? cfg.allowedIps.length : 0,
  });
});

// /api/yeastar/webhook/call-event
// /api/yeastar/webhook/call-event/:token
router.post("/webhook/call-event", limiter, rawJson, parseRawJsonBody, handleEvent);
router.post("/webhook/call-event/:token", limiter, rawJson, parseRawJsonBody, handleEvent);

export default router;