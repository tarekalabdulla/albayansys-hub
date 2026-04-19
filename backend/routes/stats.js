import { Router } from "express";
import { query } from "../db/pool.js";
import { authRequired } from "../middleware/auth.js";
import { allowedAgentIds } from "./agents.js";

const router = Router();
router.use(authRequired);

// GET /api/stats/overview — كل أرقام لوحة التحكم (مفلتر حسب الدور)
router.get("/overview", async (req, res) => {
  try {
    const ids = await allowedAgentIds(req.user);
    const filterAgent = ids !== null;
    if (filterAgent && ids.length === 0) {
      // ليس لديه ولاية على أي موظف
      return res.json({
        totals: { agents: 0, inCall: 0, answered: 0, missed: 0, avgDuration: 0, sla: 0 },
        statusCounts: { online: 0, in_call: 0, idle: 0, break: 0, offline: 0 },
        trend: [], hourly: [], supervisors: [],
      });
    }
    const agentClause = filterAgent ? ` WHERE id = ANY($1::varchar[])` : "";
    const callsAgentClause = filterAgent ? ` AND agent_id = ANY($1::varchar[])` : "";
    const params = filterAgent ? [ids] : [];

    // إجماليات الموظفين
    const agentsAgg = await query(`
      SELECT
        COUNT(*)::int                                       AS total,
        COUNT(*) FILTER (WHERE status = 'in_call')::int     AS in_call,
        COALESCE(SUM(answered), 0)::int                     AS answered,
        COALESCE(SUM(missed), 0)::int                       AS missed,
        COALESCE(AVG(NULLIF(avg_duration, 0)), 0)::int      AS avg_duration
      FROM agents${agentClause}
    `, params);

    // توزيع الحالات
    const statusRows = await query(`
      SELECT status, COUNT(*)::int AS count
      FROM agents${agentClause}
      GROUP BY status
    `, params);
    const statusCounts = { online: 0, in_call: 0, idle: 0, break: 0, offline: 0 };
    statusRows.rows.forEach((r) => { statusCounts[r.status] = r.count; });

    // اتجاه آخر 7 أيام (calls فقط — calls_cdr لا يحوي agent_id مفهرس)
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
        FROM calls
        WHERE started_at >= CURRENT_DATE - INTERVAL '6 days'${callsAgentClause}
        GROUP BY DATE(started_at)
      )
      SELECT days.d AS date,
             COALESCE(agg.answered, 0) AS answered,
             COALESCE(agg.missed, 0) AS missed
      FROM days LEFT JOIN agg ON agg.d = days.d
      ORDER BY days.d
    `, params);

    // توزيع ساعات اليوم (8ص → 5م)
    const hourly = await query(`
      WITH hours AS (SELECT generate_series(8, 17) AS h),
      agg AS (
        SELECT EXTRACT(HOUR FROM started_at)::int AS h, COUNT(*)::int AS c
        FROM calls
        WHERE started_at::date = CURRENT_DATE${callsAgentClause}
        GROUP BY EXTRACT(HOUR FROM started_at)
      )
      SELECT hours.h AS hour, COALESCE(agg.c, 0)::int AS count
      FROM hours LEFT JOIN agg ON agg.h = hours.h
      ORDER BY hours.h
    `, params);

    // أداء المشرفين (للأدمن فقط)
    let supervisors = { rows: [] };
    if (req.user.role === "admin") {
      supervisors = await query(`
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
    }

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

// GET /api/stats/recent-calls — آخر المكالمات (مفلتر بـ extension للموظف)
router.get("/recent-calls", async (req, res) => {
  try {
    const limit = 10;
    let sql = `SELECT id, agent_name AS agent, caller_number AS number,
                      duration, status,
                      TO_CHAR(started_at AT TIME ZONE 'Asia/Riyadh', 'HH24:MI') AS time
               FROM calls_cdr`;
    const params = [];

    if (req.user.role !== "admin") {
      // اجلب الـ extensions المسموحة
      let extQuery;
      if (req.user.role === "supervisor") {
        extQuery = await query(
          `SELECT a.ext FROM supervisors s
           JOIN supervisor_agents sa ON sa.supervisor_id = s.id
           JOIN agents a ON a.id = sa.agent_id
           WHERE s.user_id = $1 AND a.ext IS NOT NULL`,
          [req.user.sub]
        );
      } else {
        extQuery = await query(
          `SELECT ext FROM agents WHERE user_id = $1 AND ext IS NOT NULL`,
          [req.user.sub]
        );
      }
      const exts = extQuery.rows.map((r) => r.ext);
      if (exts.length === 0) return res.json({ calls: [] });
      sql += ` WHERE extension = ANY($1::varchar[])`;
      params.push(exts);
    }

    sql += ` ORDER BY started_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await query(sql, params);
    res.json({ calls: rows });
  } catch (e) {
    console.error("[stats/recent-calls]", e);
    res.json({ calls: [] });
  }
});

// GET /api/stats/activities
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
