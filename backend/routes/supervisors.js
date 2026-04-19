// إدارة المشرفين — admin فقط للكتابة، supervisor يرى نفسه فقط، admin يرى الكل
import { Router } from "express";
import { z } from "zod";
import { query, pool } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(authRequired);

// أداة مساعدة: جلب id المشرف المرتبط بالمستخدم الحالي
async function getMySupervisorId(userId) {
  const { rows } = await query(
    `SELECT id FROM supervisors WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0]?.id || null;
}

// ============ GET كل المشرفين مع موظفيهم ============
// admin: الكل، supervisor: نفسه فقط، agent: ممنوع
router.get("/", async (req, res) => {
  try {
    if (req.user.role === "agent") {
      return res.status(403).json({ error: "forbidden" });
    }

    let supsQuery = `SELECT id, name, email, ext, role, user_id, created_at, updated_at
                     FROM supervisors`;
    const params = [];
    if (req.user.role === "supervisor") {
      supsQuery += ` WHERE user_id = $1`;
      params.push(req.user.sub);
    }
    supsQuery += ` ORDER BY created_at DESC`;

    const { rows: sups } = await query(supsQuery, params);
    if (!sups.length) return res.json({ supervisors: [] });

    const ids = sups.map((s) => s.id);
    const { rows: links } = await query(
      `SELECT supervisor_id, agent_id FROM supervisor_agents WHERE supervisor_id = ANY($1::varchar[])`,
      [ids]
    );
    const map = new Map();
    for (const s of sups) map.set(s.id, { ...s, userId: s.user_id, agentIds: [] });
    for (const l of links) {
      const s = map.get(l.supervisor_id);
      if (s) s.agentIds.push(l.agent_id);
    }
    res.json({ supervisors: Array.from(map.values()) });
  } catch (e) {
    console.error("[supervisors:list]", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ============ GET مشرف واحد ============
router.get("/:id", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, email, ext, role, user_id FROM supervisors WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found" });

    // المشرف يرى نفسه فقط
    if (req.user.role === "supervisor" && rows[0].user_id !== req.user.sub) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (req.user.role === "agent") return res.status(403).json({ error: "forbidden" });

    const { rows: links } = await query(
      `SELECT agent_id FROM supervisor_agents WHERE supervisor_id = $1`,
      [req.params.id]
    );
    res.json({
      supervisor: {
        ...rows[0],
        userId: rows[0].user_id,
        agentIds: links.map((l) => l.agent_id),
      },
    });
  } catch (e) {
    console.error("[supervisors:get]", e);
    res.status(500).json({ error: "server_error" });
  }
});

const upsertSchema = z.object({
  id:       z.string().trim().min(1).max(32).optional(),
  name:     z.string().trim().min(1).max(128),
  email:    z.string().trim().email().max(255),
  ext:      z.string().trim().min(1).max(16),
  role:     z.string().trim().max(32).default("مشرف"),
  userId:   z.string().uuid().nullable().optional(),
  agentIds: z.array(z.string()).default([]),
});

// ============ POST إنشاء (admin فقط) ============
router.post("/", requireRole("admin"), async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }
  const { name, email, ext, role, agentIds, userId } = parsed.data;
  const id = parsed.data.id || `S-${Date.now()}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO supervisors (id, name, email, ext, role, user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, name, email, ext, role, userId || null]
    );
    if (agentIds.length) {
      const values = agentIds.map((_, i) => `($1, $${i + 2})`).join(", ");
      await client.query(
        `INSERT INTO supervisor_agents (supervisor_id, agent_id) VALUES ${values}`,
        [id, ...agentIds]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true, id });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.code === "23505") {
      return res.status(409).json({ error: "user_already_linked", message: "هذا المستخدم مرتبط بمشرف آخر" });
    }
    console.error("[supervisors:create]", e);
    res.status(500).json({ error: "server_error", message: e.message });
  } finally {
    client.release();
  }
});

// ============ PUT تحديث (admin فقط) ============
router.put("/:id", requireRole("admin"), async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }
  const { name, email, ext, role, agentIds, userId } = parsed.data;
  const id = req.params.id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      `UPDATE supervisors SET name=$1, email=$2, ext=$3, role=$4, user_id=$5 WHERE id=$6`,
      [name, email, ext, role, userId || null, id]
    );
    if (upd.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    await client.query(`DELETE FROM supervisor_agents WHERE supervisor_id = $1`, [id]);
    if (agentIds.length) {
      const values = agentIds.map((_, i) => `($1, $${i + 2})`).join(", ");
      await client.query(
        `INSERT INTO supervisor_agents (supervisor_id, agent_id) VALUES ${values}`,
        [id, ...agentIds]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.code === "23505") {
      return res.status(409).json({ error: "user_already_linked", message: "هذا المستخدم مرتبط بمشرف آخر" });
    }
    console.error("[supervisors:update]", e);
    res.status(500).json({ error: "server_error", message: e.message });
  } finally {
    client.release();
  }
});

// ============ DELETE ============
router.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    const { rowCount } = await query(`DELETE FROM supervisors WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("[supervisors:delete]", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ============ GET /me/team — فريق المشرف الحالي ============
router.get("/me/team", async (req, res) => {
  try {
    if (req.user.role === "admin") {
      // الأدمن يرى الكل
      const { rows } = await query(`SELECT id FROM agents ORDER BY name`);
      return res.json({ agentIds: rows.map((r) => r.id) });
    }
    const supId = await getMySupervisorId(req.user.sub);
    if (!supId) return res.json({ agentIds: [] });
    const { rows } = await query(
      `SELECT agent_id FROM supervisor_agents WHERE supervisor_id = $1`,
      [supId]
    );
    res.json({ agentIds: rows.map((r) => r.agent_id) });
  } catch (e) {
    console.error("[supervisors:me:team]", e);
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
