// ============================================================
// Yeastar webhook telemetry + normalization helpers only
// ------------------------------------------------------------
// هذا الملف لم يعد يحتوي routes HTTP.
// دوره الآن:
//   1) حفظ telemetry للـ webhook
//   2) تزويد integrations.js بحالة webhook
//   3) تزويد yeastar-webhook.js بدوال recordWebhookEvent / recordWebhookRejection
//   4) تزويد yeastar-openapi.js بالمعالج الموحّد handleNormalizedEvent
// ============================================================
import { query } from "../db/pool.js";
import { getEffectiveConfigSync } from "../services/runtimeConfig.js";

// ------------------------------------------------------------
// Telemetry — يُستخدم في /api/integrations/status
// ------------------------------------------------------------
const telemetry = {
  lastEventAt: 0,
  lastEventFrom: null,
  lastEventType: null,
  lastErrorAt: 0,
  lastError: null,
  totalEvents: 0,
  totalRejected: 0,
};

export function getWebhookStatus() {
  const cfg = getEffectiveConfigSync();
  return {
    secretConfigured: Boolean(cfg.webhookSecret),
    tokenConfigured: Boolean(process.env.YEASTAR_WEBHOOK_TOKEN),
    allowedIps: Array.isArray(cfg.allowedIps) ? cfg.allowedIps : [],
    enabled: cfg.enableWebhook !== false,
    lastEventAt: telemetry.lastEventAt || null,
    lastEventFrom: telemetry.lastEventFrom,
    lastEventType: telemetry.lastEventType || null,
    lastErrorAt: telemetry.lastErrorAt || null,
    lastError: telemetry.lastError,
    totalEvents: telemetry.totalEvents,
    totalRejected: telemetry.totalRejected,
  };
}

export function recordWebhookEvent(ip, body = null) {
  telemetry.lastEventAt = Date.now();
  telemetry.lastEventFrom = ip || null;
  telemetry.lastEventType =
    body?.event ||
    body?.type ||
    body?.event_name ||
    body?.msg?.event ||
    body?.msg?.event_name ||
    body?.msg?.type ||
    null;
  telemetry.totalEvents += 1;
}

export function recordWebhookRejection(reason) {
  telemetry.lastErrorAt = Date.now();
  telemetry.lastError = reason || "unknown";
  telemetry.totalRejected += 1;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function normalizeEvent(body) {
  const t = (body.event || body.type || body.action || body.event_name || "").toString().toLowerCase();

  let kind = null;
  if (/(ring|incoming)/.test(t)) kind = "ring";
  else if (/answer/.test(t)) kind = "answer";
  else if (/(hangup|end|terminate)/.test(t)) kind = "hangup";
  else if (/(extension|agent).*status/.test(t)) kind = "agent_status";

  const ext = (body.extension || body.ext || body.agent_ext || body.callee || body.callee_num || body.member_num || "").toString();
  const peer = (body.caller || body.from || body.peer || body.number || body.caller_num || body.from_num || body.remote_number || "").toString();
  const callUuid = (body.uuid || body.call_id || body.uniqueid || body.linkedid || body.linked_id || "").toString();
  const direction = (body.direction || "inbound").toString().toLowerCase();
  const status = (body.status || body.state || body.call_status || "").toString().toLowerCase();
  const duration = parseInt(body.duration || body.billsec || body.call_duration || 0, 10) || 0;

  return { kind, ext, peer, callUuid, direction, status, duration, eventType: t };
}

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
// المعالج الموحّد — مشترك بين webhook (HTTP) و Open API (WebSocket)
// ------------------------------------------------------------
export async function handleNormalizedEvent(body, io, source = "yeastar-webhook") {
  const evt = normalizeEvent(body || {});
  const rawPayload = body || {};

  try {
    const agent = await findAgentByExt(evt.ext);

    if (!agent && evt.ext) {
      await logEvent({
        eventType: `${source}:${evt.eventType}`,
        callUuid: evt.callUuid,
        payload: rawPayload,
        ip: source,
        sigOk: true,
        processed: false,
        error: `unknown_extension:${evt.ext}`,
      });
      return { ok: true, ignored: "unknown_extension" };
    }

    switch (evt.kind) {
      case "ring": {
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
          await query(`UPDATE calls SET status = 'answered' WHERE call_uuid = $1`, [evt.callUuid]);
        }
        break;
      }

      case "hangup": {
        const finalStatus = /no.?answer|missed|cancel/.test(evt.status) ? "missed" : "answered";
        if (evt.callUuid) {
          await recordCallEnd({
            callUuid: evt.callUuid,
            duration: evt.duration,
            status: finalStatus,
            raw: rawPayload,
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
          const map = {
            available: "online",
            busy: "in_call",
            away: "break",
            dnd: "break",
            offline: "offline",
          };
          const next = map[evt.status] || "online";
          const updated = await setAgentStatus(agent.id, next);
          if (updated) io?.emit("agent:update", updated);
        }
        break;
      }

      default: {
        await logEvent({
          eventType: `${source}:${evt.eventType}`,
          callUuid: evt.callUuid,
          payload: rawPayload,
          ip: source,
          sigOk: true,
          processed: false,
          error: "unknown_event_kind",
        });
        return { ok: true, ignored: "unknown_event" };
      }
    }

    await logEvent({
      eventType: `${source}:${evt.eventType}`,
      callUuid: evt.callUuid,
      payload: rawPayload,
      ip: source,
      sigOk: true,
      processed: true,
    });

    return { ok: true, kind: evt.kind, agent: agent?.id || null };
  } catch (err) {
    console.error(`[${source}] error:`, err);
    await logEvent({
      eventType: `${source}:${evt.eventType}`,
      callUuid: evt.callUuid,
      payload: rawPayload,
      ip: source,
      sigOk: true,
      processed: false,
      error: err.message,
    });
    throw err;
  }
}