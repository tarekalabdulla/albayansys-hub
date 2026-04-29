// ============================================================================
// /api/pbx/* — Live monitoring + history endpoints (محمي بـ JWT)
// ----------------------------------------------------------------------------
// GET /api/pbx/live          — المكالمات الجارية الآن (ended_at IS NULL)
// GET /api/pbx/calls         — سجل CDR موسّع (آخر N مكالمة)
// GET /api/pbx/calls/:id     — تفاصيل مكالمة + ربط العميل/المطالبة
// GET /api/pbx/status        — حالة كل خدمات التكامل
// ============================================================================
import { Router } from "express";
import { query } from "../db/pool.js";
import { authRequired } from "../middleware/auth.js";
import { getServiceStatus as ysStatus } from "../services/yeastarService.js";
import { getAmiStatus } from "../services/amiService.js";
import { getYeastarApiStatus } from "../realtime/yeastar-openapi.js";

const router = Router();
router.use(authRequired);

// ----------------------------------------------------------------------------
// المكالمات الجارية الآن (للبث الحي / live monitor)
// ----------------------------------------------------------------------------
router.get("/live", async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         l.id,
         l.call_unique_key AS "callKey",
         l.ext,
         l.agent_id AS "agentId",
         a.name AS "agentName",
         l.remote_number AS "remote",
         l.direction,
         l.status_last AS "status",
         l.answered,
         l.started_at AS "startedAt",
         l.answered_at AS "answeredAt",
         l.last_seen_at AS "lastSeenAt",
         EXTRACT(EPOCH FROM (NOW() - l.started_at))::int AS "elapsedSec",
         l.transfer_to AS "transferTo",
         l.forwarded_to AS "forwardedTo",
         l.customer_id AS "customerId",
         l.customer_name AS "customerName",
         l.claim_number AS "claimNumber",
         l.trunk_name AS "trunk",
         l.queue_name AS "queue"
       FROM pbx_call_logs l
       LEFT JOIN agents a ON a.id = l.agent_id
       WHERE l.ended_at IS NULL
         AND l.status_last IN ('ringing', 'answered', 'busy')
       ORDER BY l.started_at DESC
       LIMIT 200`
    );

    res.set("Cache-Control", "no-store");
    res.json({ live: rows, count: rows.length });
  } catch (e) {
    console.error("[pbx/live]", e);
    res.status(500).json({ error: "fetch_failed", message: e.message });
  }
});

// ----------------------------------------------------------------------------
// سجل CDR الموسّع
// ----------------------------------------------------------------------------
router.get("/calls", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const direction = req.query.direction;
  const ext = req.query.ext;

  const where = ["1=1"];
  const params = [];
  if (direction) { params.push(direction); where.push(`l.direction = $${params.length}`); }
  if (ext)       { params.push(ext);       where.push(`l.ext = $${params.length}`); }
  params.push(limit);

  try {
    const { rows } = await query(
      `SELECT
         l.id, l.call_unique_key AS "callKey",
         l.ext, a.name AS "agentName",
         l.remote_number AS "remote",
         l.direction, l.status_last AS "status",
         l.answered, l.failure_reason AS "failureReason",
         l.started_at AS "startedAt",
         l.answered_at AS "answeredAt",
         l.ended_at AS "endedAt",
         l.duration_seconds AS "duration",
         l.talk_seconds AS "talkSeconds",
         l.transfer_from AS "transferFrom", l.transfer_to AS "transferTo",
         l.forwarded_to AS "forwardedTo",
         l.trunk_name AS "trunk", l.queue_name AS "queue",
         l.recording_url AS "recordingUrl",
         l.customer_id AS "customerId", l.customer_name AS "customerName",
         l.claim_id AS "claimId", l.claim_number AS "claimNumber"
       FROM pbx_call_logs l
       LEFT JOIN agents a ON a.id = l.agent_id
       WHERE ${where.join(" AND ")}
       ORDER BY l.started_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json({ calls: rows });
  } catch (e) {
    console.error("[pbx/calls]", e);
    res.status(500).json({ error: "fetch_failed" });
  }
});

// ----------------------------------------------------------------------------
// تفاصيل مكالمة + سجل أحداثها الخام
// ----------------------------------------------------------------------------
router.get("/calls/:id", async (req, res) => {
  try {
    const { rows: callRows } = await query(
      `SELECT l.*, a.name AS agent_name
       FROM pbx_call_logs l
       LEFT JOIN agents a ON a.id = l.agent_id
       WHERE l.id = $1`,
      [req.params.id]
    );
    if (callRows.length === 0) return res.status(404).json({ error: "not_found" });
    const call = callRows[0];

    const { rows: events } = await query(
      `SELECT id, event_id, event_name, source, received_at,
              processing_status, error_message, payload_json
       FROM pbx_events
       WHERE linked_id = $1 OR call_id = $1
       ORDER BY received_at ASC LIMIT 200`,
      [call.linkedid || call.uniqueid || call.call_unique_key]
    );

    res.json({ call, events });
  } catch (e) {
    console.error("[pbx/calls/:id]", e);
    res.status(500).json({ error: "fetch_failed" });
  }
});

// ----------------------------------------------------------------------------
// حالة التكامل الكلية
// ----------------------------------------------------------------------------
router.get("/status", (_req, res) => {
  res.json({
    yeastarApi: ysStatus(),
    yeastarOpenApiWs: getYeastarApiStatus(),
    ami: getAmiStatus(),
    time: new Date().toISOString(),
  });
});

export default router;
