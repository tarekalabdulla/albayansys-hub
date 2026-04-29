// ============================================================================
// pbxEventProcessor — المعالج الموحّد لكل أحداث Yeastar (webhook + AMI + API)
// ----------------------------------------------------------------------------
// يستقبل أحداثاً مُطبَّعة (NormalizedPbxEvent) ويُحدّث:
//   * pbx_events       (audit log موسّع)
//   * pbx_call_logs    (CDR رسمي)
//   * agents           (الحالة الحيّة)
//   * يبثّ socket.io   (call:live, call:ended, agent:update)
//
// يحترم: idempotency, direction lock, ghost killer, customer linking.
// ============================================================================
import { query } from "../db/pool.js";
import { inferDirection, resolveDirection, isGhostEvent } from "./callDirection.js";
import { findCustomerByPhone, normalizePhone } from "./customerLinker.js";

// خرائط أرقام أحداث Yeastar P-Series
const EVENT_NAMES = {
  30008: "ExtensionCallStateChanged",
  30009: "ExtensionPresenceStateChanged",
  30011: "CallStateChanged",
  30012: "CallEndDetailsNotification",
  30013: "CallTransferReport",
  30014: "CallForwardingReport",
  30025: "AgentAutomaticPause",
  30026: "AgentRingingTimeout",
  30029: "AgentStatusChanged",
  30033: "RecordingDownloadCompleted",
  30034: "SystemEventNotification",
  30035: "SystemEventNotification",
  30036: "SystemEventNotification",
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function buildUniqueKey(source, eventId, linkedId, callId, ts) {
  // مفتاح idempotency: يضمن عدم معالجة نفس الحدث مرتين
  const ident = linkedId || callId || `${ts}`;
  return `${source}:${eventId || "x"}:${ident}:${ts || Date.now()}`.slice(0, 128);
}

async function findAgentByExt(ext) {
  if (!ext) return null;
  const { rows } = await query(`SELECT id, name, ext FROM agents WHERE ext = $1 LIMIT 1`, [ext]);
  return rows[0] || null;
}

async function setAgentStatus(agentId, status) {
  if (!agentId) return null;
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

// ----------------------------------------------------------------------------
// pbx_events insert (audit + idempotency)
// ----------------------------------------------------------------------------
async function logPbxEvent(evt) {
  try {
    const { rows } = await query(
      `INSERT INTO pbx_events
         (event_id, event_name, unique_key, linked_id, call_id, extension,
          remote_number, direction, payload_json, source, processing_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       ON CONFLICT (unique_key) DO NOTHING
       RETURNING id`,
      [
        evt.eventId || null,
        evt.eventName || EVENT_NAMES[evt.eventId] || null,
        evt.uniqueKey,
        evt.linkedId || null,
        evt.callId || null,
        evt.ext || null,
        evt.remoteNumber || null,
        evt.direction || "unknown",
        evt.payload || {},
        evt.source || "webhook",
      ]
    );
    // إذا كان فارغاً → كان موجوداً (duplicate)، أعد ID القديم
    if (rows.length === 0) {
      const { rows: existing } = await query(
        `SELECT id FROM pbx_events WHERE unique_key = $1`,
        [evt.uniqueKey]
      );
      return { id: existing[0]?.id, duplicate: true };
    }
    return { id: rows[0].id, duplicate: false };
  } catch (e) {
    console.error("[pbx-processor] logPbxEvent error:", e.message);
    return { id: null, duplicate: false, error: e.message };
  }
}

async function markEventProcessed(id, status, errorMessage) {
  if (!id) return;
  try {
    await query(
      `UPDATE pbx_events
       SET processing_status = $2, processed_at = NOW(), error_message = $3
       WHERE id = $1`,
      [id, status, errorMessage || null]
    );
  } catch (e) {
    console.error("[pbx-processor] markEventProcessed:", e.message);
  }
}

// ----------------------------------------------------------------------------
// pbx_call_logs upsert (مع direction lock + customer linking)
// ----------------------------------------------------------------------------
async function getCallLog(callUniqueKey) {
  const { rows } = await query(
    `SELECT id, ext, direction, direction_locked, status_last, answered,
            started_at, answered_at, ended_at
     FROM pbx_call_logs WHERE call_unique_key = $1`,
    [callUniqueKey]
  );
  return rows[0] || null;
}

async function upsertCallLog(evt, kind) {
  const callKey = evt.linkedId || evt.callId;
  if (!callKey) return null;

  const existing = await getCallLog(callKey);

  // Ghost Killer
  if (isGhostEvent({ existingLog: existing, eventKind: kind, eventExt: evt.ext })) {
    return { ghost: true, log: existing };
  }

  // Direction lock
  const inferred = inferDirection({
    eventDirection: evt.direction,
    callType: evt.callType,
    fromNum: evt.fromNum,
    toNum: evt.toNum,
    ext: evt.ext,
    trunk: evt.trunk,
    isTransfer: kind === "transfer",
    isForward: kind === "forward",
  });
  const isFinal = kind === "hangup" || kind === "end";
  const trusted = evt.source === "webhook" || evt.source === "openapi-ws" || evt.source === "api";
  const dirRes = resolveDirection(existing, inferred, { final: isFinal, fromTrustedSource: trusted });

  // ربط العميل (مرّة واحدة فقط — عند الإنشاء)
  let linkedCustomer = null;
  if (!existing && evt.remoteNumber) {
    try { linkedCustomer = await findCustomerByPhone(evt.remoteNumber); }
    catch (e) { console.warn("[pbx-processor] linker:", e.message); }
  }

  const agent = await findAgentByExt(evt.ext);
  const remoteNorm = normalizePhone(evt.remoteNumber || "");

  // إنشاء جديد
  if (!existing) {
    const { rows } = await query(
      `INSERT INTO pbx_call_logs (
        call_unique_key, linkedid, uniqueid, ext, agent_id,
        remote_number, remote_number_norm,
        direction, direction_locked, status_last, answered,
        started_at, answered_at, last_seen_at, ended_at,
        duration_seconds, talk_seconds,
        transfer_from, transfer_to, forwarded_to,
        trunk_name, queue_name, recording_file, recording_url,
        customer_id, claim_id, claim_number, customer_name, customer_type,
        source_of_truth, raw_final_payload
      ) VALUES (
        $1,$2,$3,$4,$5, $6,$7, $8,$9,$10,$11,
        NOW(), $12, NOW(), $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22,
        $23, $24, $25, $26, $27, $28, $29
      )
      ON CONFLICT (call_unique_key) DO NOTHING
      RETURNING *`,
      [
        callKey, evt.linkedId || null, evt.callId || null, evt.ext || null, agent?.id || null,
        evt.remoteNumber || null, remoteNorm || null,
        dirRes.direction, dirRes.locked, mapStatusFromKind(kind, evt), kind === "answer",
        kind === "answer" ? new Date() : null,
        isFinal ? new Date() : null,
        Number(evt.duration) || 0,
        Number(evt.talkDuration || evt.billsec) || 0,
        evt.transferFrom || null, evt.transferTo || null, evt.forwardedTo || null,
        evt.trunk || null, evt.queue || null, evt.recordingFile || null, evt.recordingUrl || null,
        linkedCustomer?.customer?.id || null,
        linkedCustomer?.claim?.id || null,
        linkedCustomer?.claim?.claim_number || null,
        linkedCustomer?.customer?.name || null,
        linkedCustomer?.customer?.customer_type || null,
        evt.source || "webhook",
        evt.payload || {},
      ]
    );
    return { ghost: false, created: true, log: rows[0] || null };
  }

  // تحديث موجود
  const updates = [];
  const params = [];
  let i = 1;

  if (dirRes.changed) {
    updates.push(`direction = $${i++}`); params.push(dirRes.direction);
    updates.push(`direction_locked = $${i++}`); params.push(dirRes.locked);
  } else if (dirRes.locked && !existing.direction_locked) {
    updates.push(`direction_locked = $${i++}`); params.push(true);
  }

  updates.push(`status_last = $${i++}`); params.push(mapStatusFromKind(kind, evt));
  updates.push(`last_seen_at = NOW()`);

  if (kind === "answer" && !existing.answered) {
    updates.push(`answered = TRUE`);
    updates.push(`answered_at = NOW()`);
  }

  if (isFinal) {
    updates.push(`ended_at = NOW()`);
    if (evt.duration)     { updates.push(`duration_seconds = $${i++}`); params.push(Number(evt.duration)); }
    if (evt.talkDuration) { updates.push(`talk_seconds = $${i++}`);     params.push(Number(evt.talkDuration)); }
    if (evt.failureReason){ updates.push(`failure_reason = $${i++}`);   params.push(evt.failureReason); }
    if (trusted) {
      updates.push(`source_of_truth = $${i++}`); params.push(evt.source);
      updates.push(`raw_final_payload = $${i++}::jsonb`); params.push(evt.payload || {});
    }
  }

  if (kind === "transfer") {
    if (evt.transferFrom) { updates.push(`transfer_from = $${i++}`); params.push(evt.transferFrom); }
    if (evt.transferTo)   { updates.push(`transfer_to = $${i++}`);   params.push(evt.transferTo); }
  }
  if (kind === "forward" && evt.forwardedTo) {
    updates.push(`forwarded_to = $${i++}`); params.push(evt.forwardedTo);
  }
  if (kind === "recording") {
    if (evt.recordingFile){ updates.push(`recording_file = $${i++}`); params.push(evt.recordingFile); }
    if (evt.recordingUrl) { updates.push(`recording_url = $${i++}`);  params.push(evt.recordingUrl); }
  }

  if (updates.length === 0) return { ghost: false, log: existing };

  params.push(callKey);
  const { rows } = await query(
    `UPDATE pbx_call_logs SET ${updates.join(", ")}
     WHERE call_unique_key = $${i}
     RETURNING *`,
    params
  );
  return { ghost: false, updated: true, log: rows[0] || null };
}

function mapStatusFromKind(kind, evt) {
  if (kind === "ring")   return "ringing";
  if (kind === "answer") return "answered";
  if (kind === "hangup" || kind === "end") {
    const r = (evt.failureReason || evt.status || "").toString().toLowerCase();
    if (/busy/.test(r))             return "busy";
    if (/no.?answer|timeout/.test(r))return "no_answer";
    if (/cancel/.test(r))           return "cancelled";
    if (/fail|error/.test(r))       return "failed";
    return "completed";
  }
  return "ringing";
}

function deriveKindFromEventId(eventId, payload = {}) {
  const p = payload || {};

  const rawEvent = String(
    p._amiEvent ||
    p.Event ||
    p.event ||
    p.eventName ||
    p.type ||
    ""
  ).toLowerCase();

  const state = String(
    p.ChannelStateDesc ||
    p.channel_state_desc ||
    p.status ||
    p.call_status ||
    p.state ||
    ""
  ).toLowerCase();

  // AMI events
  if (rawEvent === "bridgeenter" || rawEvent === "agentconnect") return "answer";
  if (rawEvent === "newchannel") return "ring";
  if (rawEvent === "hangup" || rawEvent === "bridgeleave") return "hangup";

  if (rawEvent === "newstate") {
    if (/up|answer|answered|talking|connected|bridge/.test(state)) return "answer";
    if (/ring|ringing|dial|dialing|pre-ring/.test(state)) return "ring";
    if (/busy/.test(state)) return "answer";
    if (/down|hangup|end|released|terminated/.test(state)) return "hangup";
    return "ring";
  }

  // Yeastar / OpenAPI event ids
  if (Number(eventId) === 30011) {
    if (/bridgeenter|answer|answered|talking|connected|up/.test(rawEvent + " " + state)) return "answer";
    if (/ring|ringing|dial|dialing|newchannel|pre-ring/.test(rawEvent + " " + state)) return "ring";
    return "ring";
  }

  if (Number(eventId) === 30012) return "hangup";
  if (Number(eventId) === 30013) return "transfer";
  if (Number(eventId) === 30014) return "forward";
  if (Number(eventId) === 30033) return "recording";

  if (Number(eventId) === 30008) return "ext_state";
  if (Number(eventId) === 30009 || Number(eventId) === 30029) return "presence";
  if (Number(eventId) === 30025 || Number(eventId) === 30026) return "agent_pause";

  // Generic fallback
  const text = `${rawEvent} ${state}`.toLowerCase();
  if (/bridgeenter|agentconnect|answer|answered|talking|connected|\bup\b/.test(text)) return "answer";
  if (/newchannel|ring|ringing|dial|dialing|pre-ring/.test(text)) return "ring";
  if (/hangup|bridgeleave|end|released|terminated/.test(text)) return "hangup";

  return null;
}

// ----------------------------------------------------------------------------
// المعالج الرئيسي — يُستدعى من webhook/AMI/API بعد التطبيع
// ----------------------------------------------------------------------------
/**
 * @typedef {object} NormalizedPbxEvent
 * @property {number} eventId           - 30011/30012/...
 * @property {string} eventName
 * @property {string} source            - webhook/ami/api/openapi-ws
 * @property {string} linkedId
 * @property {string} callId
 * @property {string} ext
 * @property {string} remoteNumber
 * @property {string} fromNum
 * @property {string} toNum
 * @property {string} direction         - مؤشر مبدئي
 * @property {string} callType
 * @property {string} trunk
 * @property {string} queue
 * @property {number} duration
 * @property {number} talkDuration
 * @property {string} status
 * @property {string} failureReason
 * @property {string} transferFrom
 * @property {string} transferTo
 * @property {string} forwardedTo
 * @property {string} recordingFile
 * @property {string} recordingUrl
 * @property {object} payload           - الحدث الخام
 * @property {number} timestamp
 */

export async function processPbxEvent(evt, io) {
  if (!evt || typeof evt !== "object") return { ok: false, error: "invalid_event" };

  // مفتاح idempotency
  evt.uniqueKey = evt.uniqueKey || buildUniqueKey(
    evt.source || "webhook",
    evt.eventId,
    evt.linkedId,
    evt.callId,
    evt.timestamp || Date.now()
  );

  // 1) سجّل الحدث في pbx_events
  const logged = await logPbxEvent(evt);
  if (logged.duplicate) return { ok: true, duplicate: true };

  try {
    const kind = deriveKindFromEventId(evt.eventId, evt.payload);

    // 2) أحداث presence/ext_state → تحديث agent status فقط
    if (kind === "presence" || kind === "ext_state" || kind === "agent_pause") {
      const agent = await findAgentByExt(evt.ext);
      if (agent) {
        const map = {
          available: "online", idle: "online", online: "online",
          busy: "in_call", talking: "in_call", ringing: "in_call",
          away: "break", dnd: "break", paused: "break",
          offline: "offline", unavailable: "offline",
        };
        const st = (evt.status || evt.payload?.presence_status || "").toString().toLowerCase();
        const next = map[st] || "online";
        const updated = await setAgentStatus(agent.id, next);
        if (updated) io?.emit("agent:update", updated);
      }
      await markEventProcessed(logged.id, "processed");
      return { ok: true, kind };
    }

    // 3) أحداث المكالمات → upsert pbx_call_logs
    if (kind && ["ring","answer","hangup","end","transfer","forward","recording"].includes(kind)) {
      const result = await upsertCallLog(evt, kind);
      if (result?.ghost) {
        await markEventProcessed(logged.id, "ignored", "ghost_event");
        return { ok: true, ghost: true };
      }

      const log = result?.log;
      if (log) {
        const isLive = !log.ended_at;

        // تحديث حالة الوكيل فور وجود مكالمة نشطة
        // مهم: agent_status enum يقبل in_call وليس busy
        if (log.agent_id && isLive && ["ring", "answer", "transfer", "forward"].includes(kind)) {
          const refreshed = await setAgentStatus(log.agent_id, "in_call");
          if (refreshed) io?.emit("agent:update", refreshed);
        }

        // بثّ socket.io
        io?.emit(isLive ? "call:live" : "call:ended", {
          id: log.id,
          callKey: log.call_unique_key,
          ext: log.ext,
          remote: log.remote_number,
          direction: log.direction,
          status: log.status_last,
          answered: log.answered,
          startedAt: log.started_at,
          endedAt: log.ended_at,
          duration: log.duration_seconds,
          customer: log.customer_name,
          claimNumber: log.claim_number,
        });

        // تحديث agent counters عند النهاية
        if (kind === "hangup" || kind === "end") {
          if (log.agent_id) {
            const counterField = log.answered ? "answered" : "missed";
            await query(
              `UPDATE agents SET ${counterField} = ${counterField} + 1 WHERE id = $1`,
              [log.agent_id]
            );
            const refreshed = await setAgentStatus(log.agent_id, "online");
            if (refreshed) io?.emit("agent:update", refreshed);
          }
        }
      }

      await markEventProcessed(logged.id, "processed");
      return { ok: true, kind, log };
    }

    // 4) غير معروف
    await markEventProcessed(logged.id, "ignored", "unknown_event_kind");
    return { ok: true, ignored: true };
  } catch (err) {
    console.error("[pbx-processor]", err);
    await markEventProcessed(logged.id, "failed", err.message);
    throw err;
  }
}
