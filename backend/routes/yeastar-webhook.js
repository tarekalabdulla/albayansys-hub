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
function verifyHmac(rawBody, sigHeader) {
  const cfg = getEffectiveConfigSync();
  const secret = cfg.webhookSecret || "";
  if (!secret) return true; // اختياري
  if (!sigHeader) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = String(sigHeader).replace(/^sha256=/i, "").trim();

  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// Normalize Yeastar OpenAPI event → NormalizedPbxEvent
// ----------------------------------------------------------------------------
function normalizeYeastarEvent(body) {
  const eventId = parseInt(body.type || body.event_id || body.eventId || 0, 10) || null;
  const eventName = body.event_name || body.eventName || "";
  const payload = body.msg || body.data || body.payload || body;

  return {
    eventId,
    eventName,
    source: "webhook",
    linkedId: payload.linkedid || payload.linked_id || payload.call_id || "",
    callId: payload.call_id || payload.uniqueid || payload.uuid || "",
    ext: (payload.extension || payload.callee_num || payload.member_num || payload.ext || "").toString(),
    remoteNumber: (payload.caller_num || payload.from_num || payload.peer_num || payload.remote_number || "").toString(),
    fromNum: (payload.caller_num || payload.from_num || "").toString(),
    toNum: (payload.callee_num || payload.to_num || "").toString(),
    direction:
      payload.direction ||
      (payload.call_type === "1" ? "outgoing" : payload.call_type === "2" ? "incoming" : null),
    callType: payload.call_type,
    trunk: payload.trunk_name || payload.trunk || null,
    queue: payload.queue_name || payload.queue || null,
    duration: parseInt(payload.duration || payload.call_duration || 0, 10),
    talkDuration: parseInt(payload.talk_duration || payload.billsec || 0, 10),
    status: payload.call_status || payload.status || null,
    failureReason: payload.hangup_cause || payload.failure_reason || null,
    transferFrom: payload.transfer_from || payload.transferer || null,
    transferTo: payload.transfer_to || payload.transferee || null,
    forwardedTo: payload.forwarded_to || payload.forward_to || null,
    recordingFile: payload.recording_file || payload.file_name || null,
    recordingUrl: payload.recording_url || payload.download_url || null,
    payload: body,
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
  const sig = req.headers["x-yeastar-signature"] || req.headers["x-signature"] || "";
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