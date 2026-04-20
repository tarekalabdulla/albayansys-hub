import { Router } from "express";
import { query } from "../db/pool.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();
router.use(authRequired);

// ============================================================
// GET /api/ai-analytics/recommendations
// ============================================================
router.get("/recommendations", async (_req, res) => {
  const { rows } = await query(
    `SELECT id, icon, color, title, body, impact
       FROM ai_recommendations
      WHERE is_active = TRUE
   ORDER BY created_at DESC
      LIMIT 8`
  );
  res.json({ recommendations: rows });
});

// ============================================================
// GET /api/ai-analytics/sentiment — يجمّع من جدول recordings
// ============================================================
router.get("/sentiment", async (_req, res) => {
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE sentiment = 'positive')  AS positive,
       COUNT(*) FILTER (WHERE sentiment = 'neutral')   AS neutral,
       COUNT(*) FILTER (WHERE sentiment = 'negative')  AS negative,
       COUNT(*)                                        AS total
     FROM recordings`
  );
  const r = rows[0] || {};
  res.json({
    summary: {
      positive: Number(r.positive || 0),
      neutral:  Number(r.neutral  || 0),
      negative: Number(r.negative || 0),
      total:    Number(r.total    || 0),
    },
  });
});

// ============================================================
// GET /api/ai-analytics/sentiment-trend — آخر 7 أيام
// ============================================================
router.get("/sentiment-trend", async (_req, res) => {
  const { rows } = await query(
    `SELECT day::text, positive, neutral, negative
       FROM sentiment_daily
      WHERE day >= CURRENT_DATE - INTERVAL '6 days'
   ORDER BY day ASC`
  );
  res.json({ trend: rows });
});

// ============================================================
// GET /api/ai-analytics/overview — أرقام عامة لشاشة AI
// ============================================================
router.get("/overview", async (_req, res) => {
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*) FROM calls       WHERE started_at >= NOW() - INTERVAL '24 hours') AS calls_24h,
       (SELECT COUNT(*) FROM recordings  WHERE recorded_at >= NOW() - INTERVAL '24 hours') AS recordings_24h,
       (SELECT COUNT(*) FROM ai_recommendations WHERE is_active = TRUE) AS active_recs`
  );
  const r = rows[0] || {};
  res.json({
    overview: {
      calls24h:      Number(r.calls_24h      || 0),
      recordings24h: Number(r.recordings_24h || 0),
      activeRecs:    Number(r.active_recs    || 0),
    },
  });
});

export default router;
