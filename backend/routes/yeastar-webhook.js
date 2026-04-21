// ============================================================================
// /api/yeastar/webhook/call-event — endpoint جديد production-grade
// ----------------------------------------------------------------------------
// مزايا فوق الموجود في routes/webhooks-yeastar.js:
//   1) URL token validation (path :token يجب أن يساوي YEASTAR_WEBHOOK_TOKEN)
//   2) HMAC signature (X-Yeastar-Signature) — اختياري إذا لم يُضبط secret
//   3) رد 200 سريع جداً، ثم معالجة async (لا يعطّل إعادة المحاولة من PBX)
//   4) idempotency عبر pbx_events.unique_key
//   5) يدعم أحداث 30008/30009/30011/30012/30013/30014/30025/30026/30029/30033...
//
// ⚠️ لا يحلّ محل /api/webhooks/yeastar الحالي — كلاهما يعمل بالتوازي.
// ============================================================================
import { Router } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { processPbxEvent } from "../services/pbxEventProcessor.js";

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
// Raw body capture (للتحقق من HMAC)
// ----------------------------------------------------------------------------
const rawJson = (req, _res, next) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    req.rawBody = Buffer.concat(chunks);
    try { req.body = req.rawBody.length ? JSON.parse(req.rawBody.toString("utf8")) : {}; }
    catch { req.body = {}; }
    next();
  });
  req.on("error", next);
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function verifyHmac(rawBody, sigHeader) {
  const secret = process.env.YEASTAR_WEBHOOK_SECRET;
  if (!secret) return true; // اختياري
  if (!sigHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = sigHeader.replace(/^sha256=/i, "").trim();
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

// ----------------------------------------------------------------------------
// Normalize Yeastar OpenAPI event → NormalizedPbxEvent
// ----------------------------------------------------------------------------
function normalizeYeastarEvent(body) {
  // أشكال شائعة:
  //   { type: 30012, sn:"...", msg: { ... } }
  //   { event_id: 30012, data: {...} }
  //   { event_name: "CallEnd", payload: {...} }
  const eventId   = parseInt(body.type || body.event_id || body.eventId || 0, 10) || null;
  const eventName = body.event_name || body.eventName || "";
  const payload   = body.msg || body.data || body.payload || body;

  return {
    eventId,
    eventName,
    source: "webhook",
    linkedId:     payload.linkedid || payload.linked_id || payload.call_id || "",
    callId:       payload.call_id || payload.uniqueid || payload.uuid || "",
    ext:          (payload.extension || payload.callee_num || payload.member_num || payload.ext || "").toString(),
    remoteNumber: (payload.caller_num || payload.from_num || payload.peer_num || payload.remote_number || "").toString(),
    fromNum:      (payload.caller_num || payload.from_num || "").toString(),
    toNum:        (payload.callee_num || payload.to_num || "").toString(),
    direction:    payload.direction || (payload.call_type === "1" ? "outgoing" : payload.call_type === "2" ? "incoming" : null),
    callType:     payload.call_type,
    trunk:        payload.trunk_name || payload.trunk || null,
    queue:        payload.queue_name || payload.queue || null,
    duration:     parseInt(payload.duration || payload.call_duration || 0, 10),
    talkDuration: parseInt(payload.talk_duration || payload.billsec || 0, 10),
    status:       payload.call_status || payload.status || null,
    failureReason:payload.hangup_cause || payload.failure_reason || null,
    transferFrom: payload.transfer_from || payload.transferer || null,
    transferTo:   payload.transfer_to || payload.transferee || null,
    forwardedTo:  payload.forwarded_to || payload.forward_to || null,
    recordingFile:payload.recording_file || payload.file_name || null,
    recordingUrl: payload.recording_url || payload.download_url || null,
    payload:      body,
    timestamp:    parseInt(payload.timestamp || payload.event_time || Date.now(), 10),
  };
}

// ----------------------------------------------------------------------------
// المعالج الرئيسي — رد سريع 200 ثم async processing
// ----------------------------------------------------------------------------
function handleEvent(req, res) {
  const io = req.app.get("io");
  const expectedToken = process.env.YEASTAR_WEBHOOK_TOKEN || "";
  const providedToken = req.params.token || "";

  // 1) URL token validation
  if (expectedToken) {
    if (!providedToken || providedToken !== expectedToken) {
      console.warn("[yeastar-webhook-v2] invalid token from", req.ip);
      return res.status(401).json({ error: "invalid_token" });
    }
  }

  // 2) HMAC (اختياري)
  const sig = req.headers["x-yeastar-signature"] || req.headers["x-signature"] || "";
  if (!verifyHmac(req.rawBody || Buffer.from(""), sig)) {
    console.warn("[yeastar-webhook-v2] invalid HMAC from", req.ip);
    return res.status(401).json({ error: "invalid_signature" });
  }

  // 3) رد 200 فوراً
  res.status(200).json({ ok: true, received: true });

  // 4) معالجة async (لا تأثير على رد PBX)
  setImmediate(async () => {
    try {
      const normalized = normalizeYeastarEvent(req.body || {});
      await processPbxEvent(normalized, io);
    } catch (e) {
      console.error("[yeastar-webhook-v2] async processing failed:", e.message);
    }
  });
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------
router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    tokenRequired: Boolean(process.env.YEASTAR_WEBHOOK_TOKEN),
    hmacRequired:  Boolean(process.env.YEASTAR_WEBHOOK_SECRET),
  });
});

// /api/yeastar/webhook/call-event           (token من header/HMAC فقط)
// /api/yeastar/webhook/call-event/:token    (token في URL)
router.post("/webhook/call-event",         limiter, rawJson, handleEvent);
router.post("/webhook/call-event/:token",  limiter, rawJson, handleEvent);

export default router;
