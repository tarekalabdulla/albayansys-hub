// معالج Webhook لأحداث Yeastar P-Series
// - يتحقق من توقيع HMAC-SHA256 (header: X-Signature أو X-Yeastar-Signature)
// - يطبّع الحدث ويخزّنه (calls_live / calls_cdr / ext_status)
// - يبثّ على Socket.io لتحديث Dashboard فوراً
import crypto from "node:crypto";
import { query } from "../db/pool.js";
import { decryptSecret } from "./crypto.js";

// نسمح بصيغ توقيع متعددة لأن Yeastar يختلف بين الإصدارات
function verifySignature(rawBody, headers, secret) {
  if (!secret) return { ok: true, reason: "no_secret_configured" }; // لو لم يُعدّ سر، نقبل (يفضّل تفعيله)
  const sigHeader =
    headers["x-signature"] ||
    headers["x-yeastar-signature"] ||
    headers["x-hub-signature-256"] ||
    "";
  if (!sigHeader) return { ok: false, reason: "missing_signature" };
  // قد يأتي بصيغة "sha256=hex"
  const provided = sigHeader.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "length_mismatch" };
  const eq = crypto.timingSafeEqual(a, b);
  return eq ? { ok: true } : { ok: false, reason: "signature_mismatch" };
}

async function getWebhookSecret() {
  const { rows } = await query(`SELECT webhook_secret_enc FROM pbx_settings WHERE id = 1`);
  if (!rows[0]?.webhook_secret_enc) return null;
  try { return decryptSecret(rows[0].webhook_secret_enc); }
  catch { return null; }
}

function nowIso() { return new Date().toISOString(); }

function detectEventType(body) {
  // أنواع شائعة في Yeastar P-Series Open API
  const t = (body?.type || body?.event || body?.event_type || "").toString().toLowerCase();
  if (t.includes("cdr")) return "cdr";
  if (t.includes("queue")) return "queue";
  if (t.includes("extension") || t.includes("presence") || t.includes("ext_status")) return "ext_status";
  if (t.includes("call") || t.includes("channel")) return "call_status";
  // fallback من شكل الحقول
  if (body?.cdr || body?.recording_file) return "cdr";
  if (body?.extension && body?.status && !body?.call_id) return "ext_status";
  if (body?.queue || body?.queue_name) return "queue";
  return "call_status";
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function normalizeCall(b) {
  return {
    id:            String(pick(b, ["call_id", "id", "uuid", "uniqueid", "linkedid"]) || `evt-${Date.now()}`),
    extension:     pick(b, ["extension", "ext", "agent_ext", "src_ext", "dst_ext"]),
    agent_name:    pick(b, ["agent_name", "ext_name", "extension_name", "src_name", "dst_name"]),
    caller_number: pick(b, ["caller_number", "src", "from", "src_num"]),
    callee_number: pick(b, ["callee_number", "dst", "to", "dst_num"]),
    direction:     pick(b, ["direction", "type", "call_type"]),
    status:        pick(b, ["status", "call_status", "state", "disposition"]),
    queue_name:    pick(b, ["queue", "queue_name"]),
  };
}

function normalizeCdr(b) {
  const base = normalizeCall(b);
  return {
    ...base,
    duration:        Number(pick(b, ["duration", "talk_duration"]) || 0),
    billsec:         Number(pick(b, ["billsec", "bill_seconds"]) || 0),
    recording_file:  pick(b, ["recording_file", "recording", "record_file"]),
    started_at:      pick(b, ["start_time", "started_at", "time", "call_time"]),
    ended_at:        pick(b, ["end_time", "ended_at", "hangup_time"]),
  };
}

function normalizeExt(b) {
  return {
    extension:    pick(b, ["extension", "ext"]),
    agent_name:   pick(b, ["agent_name", "ext_name", "extension_name"]),
    status:       pick(b, ["status", "presence", "state"]),
    device_state: pick(b, ["device_state", "sip_status"]),
  };
}

async function upsertLiveCall(c) {
  if (!c.id) return;
  await query(
    `INSERT INTO calls_live (id, extension, agent_name, caller_number, callee_number, direction, status, queue_name, answered_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $7 = 'answered' THEN NOW() ELSE NULL END, NOW())
     ON CONFLICT (id) DO UPDATE SET
       extension     = COALESCE(EXCLUDED.extension, calls_live.extension),
       agent_name    = COALESCE(EXCLUDED.agent_name, calls_live.agent_name),
       caller_number = COALESCE(EXCLUDED.caller_number, calls_live.caller_number),
       callee_number = COALESCE(EXCLUDED.callee_number, calls_live.callee_number),
       direction     = COALESCE(EXCLUDED.direction, calls_live.direction),
       status        = COALESCE(EXCLUDED.status, calls_live.status),
       queue_name    = COALESCE(EXCLUDED.queue_name, calls_live.queue_name),
       answered_at   = CASE WHEN EXCLUDED.status = 'answered' AND calls_live.answered_at IS NULL
                            THEN NOW() ELSE calls_live.answered_at END,
       updated_at    = NOW()`,
    [c.id, c.extension, c.agent_name, c.caller_number, c.callee_number, c.direction, c.status, c.queue_name],
  );
}

async function deleteLiveCall(id) {
  await query(`DELETE FROM calls_live WHERE id = $1`, [id]);
}

async function insertCdr(c, raw) {
  await query(
    `INSERT INTO calls_cdr (id, extension, agent_name, caller_number, callee_number, direction, status, duration, billsec, queue_name, recording_file, started_at, ended_at, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
             COALESCE($12::timestamptz, NOW()),
             COALESCE($13::timestamptz, NOW()),
             $14::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       status         = EXCLUDED.status,
       duration       = EXCLUDED.duration,
       billsec        = EXCLUDED.billsec,
       recording_file = COALESCE(EXCLUDED.recording_file, calls_cdr.recording_file),
       ended_at       = EXCLUDED.ended_at,
       raw            = EXCLUDED.raw`,
    [
      c.id, c.extension, c.agent_name, c.caller_number, c.callee_number,
      c.direction, c.status, c.duration, c.billsec, c.queue_name,
      c.recording_file, c.started_at, c.ended_at, JSON.stringify(raw),
    ],
  );
}

async function upsertExtStatus(e) {
  if (!e.extension) return;
  await query(
    `INSERT INTO ext_status (extension, agent_name, status, device_state, updated_at)
     VALUES ($1,$2,$3,$4, NOW())
     ON CONFLICT (extension) DO UPDATE SET
       agent_name   = COALESCE(EXCLUDED.agent_name, ext_status.agent_name),
       status       = EXCLUDED.status,
       device_state = COALESCE(EXCLUDED.device_state, ext_status.device_state),
       updated_at   = NOW()`,
    [e.extension, e.agent_name, e.status, e.device_state],
  );
}

// المعالج الرئيسي — يُستدعى من routes/pbx.js
export async function handleYeastarWebhook(req, res) {
  const io = req.app.get("io");
  const raw = req.rawBody || (typeof req.body === "string" ? Buffer.from(req.body) : Buffer.from(JSON.stringify(req.body || {})));
  const secret = await getWebhookSecret();

  const sigCheck = verifySignature(raw, req.headers, secret);
  if (!sigCheck.ok) {
    console.warn(`[webhook] رفض: ${sigCheck.reason}`);
    return res.status(401).json({ error: "invalid_signature", reason: sigCheck.reason });
  }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "invalid_json" }); }

  // قد يأتي مصفوفة أحداث أو حدث واحد
  const events = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : [body];

  for (const ev of events) {
    try {
      const type = detectEventType(ev);
      if (type === "ext_status") {
        const e = normalizeExt(ev);
        await upsertExtStatus(e);
        io?.emit("ext:status", { ...e, ts: nowIso() });
      } else if (type === "cdr") {
        const c = normalizeCdr(ev);
        await insertCdr(c, ev);
        await deleteLiveCall(c.id); // المكالمة انتهت
        io?.emit("cdr:new", { ...c, ts: nowIso() });
        io?.emit("call:status", { id: c.id, status: "ended", extension: c.extension, ts: nowIso() });
      } else if (type === "queue") {
        const c = normalizeCall(ev);
        io?.emit("queue:event", {
          action: pick(ev, ["action", "queue_event"]),
          queue: c.queue_name,
          extension: c.extension,
          caller_number: c.caller_number,
          waited: Number(pick(ev, ["wait_time", "waited"]) || 0),
          ts: nowIso(),
        });
      } else { // call_status
        const c = normalizeCall(ev);
        await upsertLiveCall(c);
        io?.emit("call:status", { ...c, ts: nowIso() });
      }
    } catch (e) {
      console.error("[webhook] خطأ في معالجة حدث:", e.message);
    }
  }

  await query(`UPDATE pbx_settings SET last_event_at = NOW() WHERE id = 1`).catch(() => {});
  res.json({ ok: true, processed: events.length });
}
