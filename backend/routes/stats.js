import { Router } from "express";
import { query } from "../db/pool.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();
router.use(authRequired);

// GET /api/stats/overview — كل أرقام لوحة التحكم
router.get("/overview", async (_req, res) => {
  try {
    // إجماليات الموظفين
    const agentsAgg = await query(`
      SELECT
        COUNT(*)::int                                       AS total,
        COUNT(*) FILTER (WHERE status = 'in_call')::int     AS in_call,
        COALESCE(SUM(answered), 0)::int                     AS answered,
        COALESCE(SUM(missed), 0)::int                       AS missed,
        COALESCE(AVG(NULLIF(avg_duration, 0)), 0)::int      AS avg_duration
      FROM agents
    `);

    // توزيع الحالات
    const statusRows = await query(`
      SELECT status, COUNT(*)::int AS count
      FROM agents GROUP BY status
    `);
    const statusCounts = { online: 0, in_call: 0, idle: 0, break: 0, offline: 0 };
    statusRows.rows.forEach((r) => { statusCounts[r.status] = r.count; });

    // اتجاه آخر 7 أيام (مجابة/فائتة) — يدمج calls + calls_cdr
    const trend = await query(`
      WITH days AS (
        SELECT generate_series(
          (CURRENT_DATE - INTERVAL '6 days')::date,
          CURRENT_DATE::date,
          '1 day'
        )::date AS d
      ),
      agg AS (
        SELECT
          DATE(started_at) AS d,
          COUNT(*) FILTER (WHERE status IN ('answered','ANSWERED','answer'))::int AS answered,
          COUNT(*) FILTER (WHERE status IN ('missed','MISSED','no answer','NO ANSWER'))::int AS missed
        FROM (
          SELECT started_at, status FROM calls
          UNION ALL
          SELECT started_at, status FROM calls_cdr
        ) u
        WHERE started_at >= CURRENT_DATE - INTERVAL '6 days'
        GROUP BY DATE(started_at)
      )
      SELECT days.d AS date,
             COALESCE(agg.answered, 0) AS answered,
             COALESCE(agg.missed, 0) AS missed
      FROM days LEFT JOIN agg ON agg.d = days.d
      ORDER BY days.d
    `);

    // توزيع ساعات اليوم (8ص → 5م)
    const hourly = await query(`
      WITH hours AS (
        SELECT generate_series(8, 17) AS h
      ),
      agg AS (
        SELECT EXTRACT(HOUR FROM started_at)::int AS h, COUNT(*)::int AS c
        FROM (
          SELECT started_at FROM calls WHERE started_at::date = CURRENT_DATE
          UNION ALL
          SELECT started_at FROM calls_cdr WHERE started_at::date = CURRENT_DATE
        ) u
        GROUP BY EXTRACT(HOUR FROM started_at)
      )
      SELECT hours.h AS hour, COALESCE(agg.c, 0)::int AS count
      FROM hours LEFT JOIN agg ON agg.h = hours.h
      ORDER BY hours.h
    `);

    // أداء المشرفين
    const supervisors = await query(`
      SELECT supervisor AS name,
             COUNT(*)::int AS team,
             COALESCE(SUM(answered), 0)::int AS answered,
             CASE
               WHEN SUM(answered) + SUM(missed) = 0 THEN 0
               ELSE ROUND(SUM(answered)::numeric * 100 / NULLIF(SUM(answered) + SUM(missed), 0))::int
             END AS sla
      FROM agents
      WHERE supervisor IS NOT NULL AND supervisor <> ''
      GROUP BY supervisor
      ORDER BY answered DESC
    `);

    // SLA الإجمالي
    const t = agentsAgg.rows[0];
    const totalCalls = (t.answered || 0) + (t.missed || 0);
    const sla = totalCalls === 0 ? 0 : Math.round((t.answered * 100) / totalCalls);

    res.json({
      totals: {
        agents: t.total,
        inCall: t.in_call,
        answered: t.answered,
        missed: t.missed,
        avgDuration: t.avg_duration,
        sla,
      },
      statusCounts,
      trend: trend.rows,
      hourly: hourly.rows,
      supervisors: supervisors.rows,
    });
  } catch (e) {
    console.error("[stats/overview]", e);
    res.status(500).json({ error: "stats_failed", message: e.message });
  }
});

// GET /api/stats/recent-calls — آخر المكالمات للوحة الجانبية
router.get("/recent-calls", async (_req, res) => {
  try {
    const limit = 10;
    const { rows } = await query(`
      SELECT id, agent_name AS agent, caller_number AS number,
             duration, status,
             TO_CHAR(started_at AT TIME ZONE 'Asia/Riyadh', 'HH24:MI') AS time
      FROM calls_cdr
      ORDER BY started_at DESC
      LIMIT $1
    `, [limit]);
    res.json({ calls: rows });
  } catch (e) {
    res.json({ calls: [] });
  }
});

// GET /api/stats/activities — آخر التنبيهات / الأنشطة
router.get("/activities", async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, level AS type, title AS action, message,
             created_at AS time
      FROM alerts
      ORDER BY created_at DESC
      LIMIT 10
    `);
    res.json({ activities: rows });
  } catch (e) {
    res.json({ activities: [] });
  }
});

export default router;
