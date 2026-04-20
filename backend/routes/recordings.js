import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authRequired);

// ============================================================
// GET /api/recordings — قائمة (يمكن فلترة بالفئة)
// ============================================================
router.get("/", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const { rows } = await query(
    `SELECT id, agent_id AS "agentId", agent_name AS "agentName", agent_avatar AS "agentAvatar",
            customer_number AS "customerNumber", duration, audio_url AS "audioUrl",
            quality_score AS "qualityScore", sentiment, category, tags,
            metrics, transcript, summary,
            TO_CHAR(recorded_at, 'YYYY-MM-DD') AS date,
            TO_CHAR(recorded_at, 'HH24:MI')    AS time,
            recorded_at AS "recordedAt"
     FROM recordings
     ORDER BY recorded_at DESC
     LIMIT $1`,
    [limit]
  );
  res.json({ recordings: rows });
});

// ============================================================
// GET /api/recordings/:id
// ============================================================
router.get("/:id", async (req, res) => {
  const { rows } = await query(
    `SELECT id, agent_id AS "agentId", agent_name AS "agentName", agent_avatar AS "agentAvatar",
            customer_number AS "customerNumber", duration, audio_url AS "audioUrl",
            quality_score AS "qualityScore", sentiment, category, tags,
            metrics, transcript, summary,
            TO_CHAR(recorded_at, 'YYYY-MM-DD') AS date,
            TO_CHAR(recorded_at, 'HH24:MI')    AS time
     FROM recordings WHERE id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not_found" });
  res.json({ recording: rows[0] });
});

// ============================================================
// DELETE /api/recordings/:id (admin/supervisor)
// ============================================================
router.delete("/:id", requireRole("admin", "supervisor"), async (req, res) => {
  const { rowCount } = await query(`DELETE FROM recordings WHERE id = $1`, [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

export default router;
