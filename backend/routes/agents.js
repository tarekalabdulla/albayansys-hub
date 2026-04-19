import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(authRequired);

// أداة: جلب IDs الموظفين المسموح للمستخدم برؤيتهم
// admin → null (= الكل)، supervisor → فقط فريقه، agent → نفسه فقط
export async function allowedAgentIds(user) {
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
  // agent: يرى فقط agent record المربوط بحسابه
  const { rows } = await query(
    `SELECT id FROM agents WHERE user_id = $1`,
    [user.sub]
  );
  return rows.map((r) => r.id);
}

// أداة موحّدة لإرجاع معرّف agent للمستخدم الحالي (للموظف)
export async function getMyAgentId(user) {
  const { rows } = await query(
    `SELECT id FROM agents WHERE user_id = $1 LIMIT 1`,
    [user.sub]
  );
  return rows[0]?.id || null;
}

// جلب extension للمستخدم الحالي (للفلترة في CDR من Yeastar)
export async function getMyExtension(user) {
  const { rows } = await query(
    `SELECT a.ext AS agent_ext, u.ext AS user_ext
     FROM users u LEFT JOIN agents a ON a.user_id = u.id
     WHERE u.id = $1`,
    [user.sub]
  );
  return rows[0]?.agent_ext || rows[0]?.user_ext || null;
}

// GET /api/agents — قائمة الموظفين (مفلترة حسب الدور)
router.get("/", async (req, res) => {
  try {
    const ids = await allowedAgentIds(req.user);
    let sql = `SELECT id, name, ext, avatar, status,
                      EXTRACT(EPOCH FROM status_since) * 1000 AS "statusSince",
                      answered, missed, avg_duration AS "avgDuration", supervisor, user_id AS "userId"
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
            answered, missed, avg_duration AS "avgDuration", supervisor, user_id AS "userId"
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

// PATCH /api/agents/:id/link-user — ربط agent بمستخدم (admin فقط)
const linkSchema = z.object({
  userId: z.string().uuid().nullable(),
});
router.patch("/:id/link-user", requireRole("admin"), async (req, res) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  try {
    const { rowCount } = await query(
      `UPDATE agents SET user_id = $1 WHERE id = $2`,
      [parsed.data.userId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "user_already_linked",
        message: "هذا المستخدم مرتبط بموظف آخر",
      });
    }
    console.error("[agents:link-user]", err);
    res.status(500).json({ error: "server_error" });
  }
});

// GET /api/agents/me/info — agent record الحالي (للموظف عند تسجيل الدخول)
router.get("/me/info", async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, ext, avatar, status, answered, missed,
            avg_duration AS "avgDuration", supervisor
     FROM agents WHERE user_id = $1`,
    [req.user.sub]
  );
  res.json({ agent: rows[0] || null });
});

export default router;
