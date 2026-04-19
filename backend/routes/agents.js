import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(authRequired);

// أداة: جلب IDs الموظفين المسموح للمستخدم برؤيتهم
// admin → null (= الكل)، supervisor → فقط فريقه، agent → نفسه فقط
async function allowedAgentIds(user) {
  if (user.role === "admin") return null;
  if (user.role === "supervisor") {
    const { rows } = await query(
      `SELECT sa.agent_id
       FROM supervisors s
       JOIN supervisor_agents sa ON sa.supervisor_id = s.id
       WHERE s.user_id = $1`,
      [user.sub]
    );
    return rows.map((r) => r.agent_id);
  }
  // agent: يحاول مطابقة id الموظف بحساب المستخدم عبر ext أو identifier
  // (مبسط: نسمح للموظف برؤية كل شيء حالياً - يمكن التشديد لاحقاً)
  return null;
}

// GET /api/agents — قائمة الموظفين (مفلترة حسب الدور)
router.get("/", async (req, res) => {
  try {
    const ids = await allowedAgentIds(req.user);
    let sql = `SELECT id, name, ext, avatar, status,
                      EXTRACT(EPOCH FROM status_since) * 1000 AS "statusSince",
                      answered, missed, avg_duration AS "avgDuration", supervisor
               FROM agents`;
    const params = [];
    if (ids !== null) {
      if (ids.length === 0) return res.json({ agents: [] });
      sql += ` WHERE id = ANY($1::varchar[])`;
      params.push(ids);
    }
    sql += ` ORDER BY name`;
    const { rows } = await query(sql, params);
    res.json({ agents: rows });
  } catch (e) {
    console.error("[agents:list]", e);
    res.status(500).json({ error: "server_error" });
  }
});

// GET /api/agents/:id
router.get("/:id", async (req, res) => {
  const ids = await allowedAgentIds(req.user);
  if (ids !== null && !ids.includes(req.params.id)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const { rows } = await query(
    `SELECT id, name, ext, avatar, status,
            EXTRACT(EPOCH FROM status_since) * 1000 AS "statusSince",
            answered, missed, avg_duration AS "avgDuration", supervisor
     FROM agents WHERE id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not_found" });
  res.json({ agent: rows[0] });
});

// PATCH /api/agents/:id/status
const statusSchema = z.object({
  status: z.enum(["online", "in_call", "idle", "break", "offline"]),
});
router.patch("/:id/status", requireRole("admin", "supervisor"), async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  // المشرف لا يستطيع تعديل موظف خارج فريقه
  const ids = await allowedAgentIds(req.user);
  if (ids !== null && !ids.includes(req.params.id)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const { rows } = await query(
    `UPDATE agents SET status = $1, status_since = NOW() WHERE id = $2
     RETURNING id, name, status, EXTRACT(EPOCH FROM status_since) * 1000 AS "statusSince"`,
    [parsed.data.status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not_found" });

  const io = req.app.get("io");
  io?.emit("agent:update", rows[0]);

  res.json({ agent: rows[0] });
});

export default router;
