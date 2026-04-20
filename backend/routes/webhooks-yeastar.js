// ============================================================
// Webhook receiver — Yeastar P-Series PBX
// ------------------------------------------------------------
// يستقبل أحداث المكالمات (ring / answer / hangup / agent_status)
// ويُحدّث جداول agents/calls/alerts ثم يبثّ التحديثات عبر Socket.io
//
// أمان:
//   1) IP allowlist عبر YEASTAR_ALLOWED_IPS=ip1,ip2 (اختياري لكن مُوصى به)
//   2) HMAC SHA-256 على body عبر header X-Yeastar-Signature
//      السرّ في YEASTAR_WEBHOOK_SECRET
//
// Idempotency: نسجّل كل event في webhook_events، ونتحقق من call_uuid
// قبل إنشاء سجل calls جديد.
//
// لا يتطلب JWT — هذا endpoint عام يُستدعى من PBX، الأمان عبر HMAC+IP.
// ============================================================
import { Router } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { query } from "../db/pool.js";

const router = Router();

// ------------------------------------------------------------
// Rate limiting — 100 req/sec لكل IP (ad-hoc؛ in-memory)
// يحمي من DoS عبر إغراق endpoint بطلبات مزيّفة.
// ملاحظة: in-memory store غير مثالي للنشر متعدد العمليات
// (يحتاج Redis لاحقاً) لكنه كافٍ لـ pm2 single-instance الحالي.
// ------------------------------------------------------------
const yeastarLimiter = rateLimit({
  windowMs: 1000,                 // نافذة 1 ثانية
  max: 100,                       // 100 طلب/ثانية/IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const xff = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
    return xff || req.ip || "unknown";
  },
  handler: (req, res) => {
    console.warn(`[webhook] rate_limited ip=${req.ip}`);
    res.status(429).json({ error: "rate_limited", retry_after_ms: 1000 });
  },
});

// ------------------------------------------------------------
// HMAC failure tracker — تنبيه عند >10 فشل/دقيقة من نفس IP
// in-memory sliding window؛ يُنظَّف تلقائياً.
// ------------------------------------------------------------
const HMAC_FAIL_WINDOW_MS = 60_000;
const HMAC_FAIL_THRESHOLD = 10;
const ALERT_COOLDOWN_MS = 5 * 60_000; // لا تنبيه مكرر لنفس IP خلال 5 دقائق
const hmacFailures = new Map();   // ip -> number[] (timestamps)
const lastAlertAt = new Map();    // ip -> timestamp

async function trackHmacFailure(ip, io) {
  const now = Date.now();
  const arr = (hmacFailures.get(ip) || []).filter((t) => now - t < HMAC_FAIL_WINDOW_MS);
  arr.push(now);
  hmacFailures.set(ip, arr);

  if (arr.length < HMAC_FAIL_THRESHOLD) return;

  // cooldown لتفادي إغراق التنبيهات
  const lastAt = lastAlertAt.get(ip) || 0;
  if (now - lastAt < ALERT_COOLDOWN_MS) return;
  lastAlertAt.set(ip, now);

  try {
    const { rows } = await query(
      `INSERT INTO alerts (level, title, message)
       VALUES ('danger', $1, $2)
       RETURNING id, level, title, message,
                 EXTRACT(EPOCH FROM created_at) * 1000 AS time`,
      [
        "محاولة وصول مشبوهة لـ Webhook",
        `فشل التحقق من توقيع HMAC ${arr.length} مرات خلال آخر دقيقة من IP=${ip}. تحقق من صحة YEASTAR_WEBHOOK_SECRET أو احظر الـ IP.`,
      ]
    );
    io?.emit("alert", rows[0]);
    console.warn(`[webhook] 🚨 HMAC abuse alert raised for ip=${ip} (count=${arr.length})`);
  } catch (e) {
    console.error("[webhook] failed to raise alert:", e.message);
  }
}

// تنظيف دوري للذاكرة (كل 5 دقائق)
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hmacFailures.entries()) {
    const fresh = arr.filter((t) => now - t < HMAC_FAIL_WINDOW_MS);
    if (fresh.length === 0) hmacFailures.delete(ip);
    else hmacFailures.set(ip, fresh);
  }
  for (const [ip, t] of lastAlertAt.entries()) {
    if (now - t > ALERT_COOLDOWN_MS) lastAlertAt.delete(ip);
  }
}, 5 * 60_000).unref();

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
const ALLOWED_IPS = (process.env.YEASTAR_ALLOWED_IPS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function getClientIp(req) {
  // يدعم خلف Nginx (X-Forwarded-For)
  const xff = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
  return xff || req.ip || req.connection?.remoteAddress || "";
}

function verifyHmac(rawBody, signatureHeader) {
  const secret = process.env.YEASTAR_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: "no_secret_configured" };
  if (!signatureHeader) return { ok: false, reason: "missing_signature" };

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // قبول صيغ شائعة: "sha256=xxxx" أو "xxxx"
  const provided = signatureHeader.replace(/^sha256=/i, "").trim();
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    if (a.length !== b.length) return { ok: false, reason: "length_mismatch" };
    return { ok: crypto.timingSafeEqual(a, b), reason: "hmac" };
  } catch {
    return { ok: false, reason: "invalid_hex" };
  }
}

// ------------------------------------------------------------
// Middleware: التقاط raw body للتحقق من HMAC
// ------------------------------------------------------------
// مهم: هذا الـ router يُسجَّل قبل express.json() العام،
// أو نستخدم express.raw هنا فقط لمسار الـ webhook.
const rawJson = (req, _res, next) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    req.rawBody = Buffer.concat(chunks);
    try {
      req.body = req.rawBody.length ? JSON.parse(req.rawBody.toString("utf8")) : {};
    } catch {
      req.body = {};
    }
    next();
  });
  req.on("error", next);
};

// ------------------------------------------------------------
// Normalizer — يحوّل أشكال Yeastar المختلفة إلى shape موحّد
// ------------------------------------------------------------
// Yeastar P-Series يرسل أحداثاً بأسماء متعددة حسب النسخة:
//   - "ExtensionRing", "ExtensionAnswer", "ExtensionHangup"
//   - أو "call.ring", "call.answer", "call.hangup"
// نتعامل مع الاثنين.
function normalizeEvent(body) {
  const t = (body.event || body.type || body.action || "").toString().toLowerCase();

  let kind = null;
  if (/(ring|incoming)/.test(t)) kind = "ring";
  else if (/answer/.test(t)) kind = "answer";
  else if (/(hangup|end|terminate)/.test(t)) kind = "hangup";
  else if (/(extension|agent).*status/.test(t)) kind = "agent_status";

  const ext = (body.extension || body.ext || body.agent_ext || body.callee || "").toString();
  const peer = (body.caller || body.from || body.peer || body.number || "").toString();
  const callUuid = (body.uuid || body.call_id || body.uniqueid || body.linkedid || "").toString();
  const direction = (body.direction || "inbound").toString().toLowerCase();
  const status = (body.status || body.state || "").toString().toLowerCase();
  const duration = parseInt(body.duration || body.billsec || 0, 10) || 0;

  return { kind, ext, peer, callUuid, direction, status, duration, eventType: t };
}

// ------------------------------------------------------------
// تحديثات قاعدة البيانات
// ------------------------------------------------------------
async function findAgentByExt(ext) {
  if (!ext) return null;
  const { rows } = await query(`SELECT id, name, ext FROM agents WHERE ext = $1 LIMIT 1`, [ext]);
  return rows[0] || null;
}

async function setAgentStatus(agentId, status) {
  const { rows } = await query(
    `UPDATE agents SET status = $1, status_since = NOW()
     WHERE id = $2
     RETURNING id, name, ext, avatar, status,
               EXTRACT(EPOCH FROM status_since) * 1000 AS "statusSince",
               answered, missed, avg_duration AS "avgDuration", supervisor`,
    [status, agentId]
  );
  return rows[0] || null;
}

async function recordCallStart({ callUuid, agentId, number, direction, raw }) {
  // id قصير اختصار من call_uuid أو timestamp
  const id = (callUuid || `C-${Date.now()}`).slice(0, 32);
  await query(
    `INSERT INTO calls (id, call_uuid, agent_id, number, duration, status, direction, started_at, raw)
     VALUES ($1, $2, $3, $4, 0, 'answered', $5, NOW(), $6)
     ON CONFLICT (call_uuid) DO NOTHING`,
    [id, callUuid || null, agentId, number || "unknown", direction, raw]
  );
}

async function recordCallEnd({ callUuid, duration, status, raw }) {
  if (!callUuid) return;
  await query(
    `UPDATE calls
     SET duration = $2, status = $3, ended_at = NOW(), raw = COALESCE(raw, '{}'::jsonb) || $4::jsonb
     WHERE call_uuid = $1`,
    [callUuid, duration, status, raw]
  );
}

async function bumpAgentCounters(agentId, status, duration) {
  // status: 'answered' | 'missed'
  if (status === "answered") {
    await query(
      `UPDATE agents
       SET answered = answered + 1,
           avg_duration = CASE
             WHEN answered = 0 THEN $2
             ELSE ((avg_duration * answered) + $2) / (answered + 1)
           END
       WHERE id = $1`,
      [agentId, duration]
    );
  } else if (status === "missed") {
    await query(`UPDATE agents SET missed = missed + 1 WHERE id = $1`, [agentId]);
  }
}

async function logEvent({ eventType, callUuid, payload, ip, sigOk, processed, error }) {
  try {
    await query(
      `INSERT INTO webhook_events (source, event_type, call_uuid, payload, ip, signature_ok, processed, error)
       VALUES ('yeastar', $1, $2, $3, $4, $5, $6, $7)`,
      [eventType || "unknown", callUuid || null, payload, ip, sigOk, processed, error || null]
    );
  } catch (e) {
    console.error("[webhook] logEvent fail:", e.message);
  }
}

// ------------------------------------------------------------
// المعالج الرئيسي
// ------------------------------------------------------------
async function handleYeastarEvent(req, res) {
  const ip = getClientIp(req);
  const io = req.app.get("io");

  // 1) IP allowlist
  if (ALLOWED_IPS.length && !ALLOWED_IPS.includes(ip)) {
    await logEvent({
      eventType: "ip_rejected", payload: { ip }, ip,
      sigOk: false, processed: false, error: "ip_not_allowed",
    });
    return res.status(403).json({ error: "ip_not_allowed" });
  }

  // 2) HMAC
  const sig = req.headers["x-yeastar-signature"] || req.headers["x-signature"] || "";
  const { ok: sigOk, reason } = verifyHmac(req.rawBody || Buffer.from(""), sig);
  if (!sigOk) {
    await logEvent({
      eventType: "sig_rejected", payload: req.body || {}, ip,
      sigOk: false, processed: false, error: `hmac_${reason}`,
    });
    // تتبّع الإخفاقات وأنشئ تنبيه عند تجاوز العتبة (10 فشل/دقيقة)
    trackHmacFailure(ip, io).catch((e) => console.error("[webhook] trackHmacFailure:", e.message));
    return res.status(401).json({ error: "invalid_signature", reason });
  }

  // 3) معالجة الحدث
  const evt = normalizeEvent(req.body || {});
  const rawPayload = req.body || {};

  try {
    const agent = await findAgentByExt(evt.ext);

    // إذا لم يكن هناك موظف بهذا الامتداد → سجّل وتجاهل (بحسب اختيار المستخدم)
    if (!agent && evt.ext) {
      await logEvent({
        eventType: evt.eventType, callUuid: evt.callUuid, payload: rawPayload, ip,
        sigOk: true, processed: false, error: `unknown_extension:${evt.ext}`,
      });
      return res.json({ ok: true, ignored: "unknown_extension" });
    }

    switch (evt.kind) {
      case "ring": {
        // المكالمة وصلت — اجعل الموظف in_call مؤقتاً عند الرد
        // بعض PBX يرسل ring قبل answer؛ نسجّل بداية المكالمة بحالة missed افتراضياً
        if (agent) {
          const updated = await setAgentStatus(agent.id, "in_call");
          if (updated) io?.emit("agent:update", updated);
        }
        if (evt.callUuid) {
          await recordCallStart({
            callUuid: evt.callUuid,
            agentId: agent?.id || null,
            number: evt.peer,
            direction: evt.direction,
            raw: rawPayload,
          });
        }
        break;
      }

      case "answer": {
        if (agent) {
          const updated = await setAgentStatus(agent.id, "in_call");
          if (updated) io?.emit("agent:update", updated);
        }
        if (evt.callUuid) {
          await query(
            `UPDATE calls SET status = 'answered' WHERE call_uuid = $1`,
            [evt.callUuid]
          );
        }
        break;
      }

      case "hangup": {
        const finalStatus = /no.?answer|missed|cancel/.test(evt.status) ? "missed" : "answered";
        if (evt.callUuid) {
          await recordCallEnd({
            callUuid: evt.callUuid, duration: evt.duration, status: finalStatus, raw: rawPayload,
          });
        }
        if (agent) {
          await bumpAgentCounters(agent.id, finalStatus, evt.duration);
          const updated = await setAgentStatus(agent.id, "online");
          if (updated) io?.emit("agent:update", updated);
        }
        break;
      }

      case "agent_status": {
        if (agent) {
          const map = { available: "online", busy: "in_call", away: "break", dnd: "break", offline: "offline" };
          const next = map[evt.status] || "online";
          const updated = await setAgentStatus(agent.id, next);
          if (updated) io?.emit("agent:update", updated);
        }
        break;
      }

      default:
        await logEvent({
          eventType: evt.eventType, callUuid: evt.callUuid, payload: rawPayload, ip,
          sigOk: true, processed: false, error: "unknown_event_kind",
        });
        return res.json({ ok: true, ignored: "unknown_event" });
    }

    await logEvent({
      eventType: evt.eventType, callUuid: evt.callUuid, payload: rawPayload, ip,
      sigOk: true, processed: true,
    });

    res.json({ ok: true, kind: evt.kind, agent: agent?.id || null });
  } catch (err) {
    console.error("[webhook/yeastar] error:", err);
    await logEvent({
      eventType: evt.eventType, callUuid: evt.callUuid, payload: rawPayload, ip,
      sigOk: true, processed: false, error: err.message,
    });
    res.status(500).json({ error: "processing_failed" });
  }
}

// ------------------------------------------------------------
// Routes
// ------------------------------------------------------------

// نقطة الفحص (للتأكد من أن endpoint يعمل بدون توقيع)
router.get("/yeastar/health", (_req, res) => {
  res.json({
    ok: true,
    secured: Boolean(process.env.YEASTAR_WEBHOOK_SECRET),
    allowedIps: ALLOWED_IPS.length || 0,
  });
});

// المسار الرئيسي — rate limit ثم raw body ثم المعالجة (HMAC + IP)
router.post("/yeastar", yeastarLimiter, rawJson, handleYeastarEvent);

export default router;
