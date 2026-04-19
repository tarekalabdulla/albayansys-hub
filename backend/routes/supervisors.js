// إدارة المشرفين — admin فقط للكتابة، supervisor/admin للقراءة
import { Router } from "express";
import { z } from "zod";
import { query, pool } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(authRequired);

// ============ GET كل المشرفين مع موظفيهم ============
router.get("/", async (_req, res) => {
  try {
    const { rows: sups } = await query(
      `SELECT id, name, email, ext, role, user_id, created_at, updated_at
       FROM supervisors ORDER BY created_at DESC`
    );
    const { rows: links } = await query(
      `SELECT supervisor_id, agent_id FROM supervisor_agents`
    );
    const map = new Map();
    for (const s of sups) map.set(s.id, { ...s, agentIds: [] });
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
    const { rows: links } = await query(
      `SELECT agent_id FROM supervisor_agents WHERE supervisor_id = $1`,
      [req.params.id]
    );
    res.json({ supervisor: { ...rows[0], agentIds: links.map((l) => l.agent_id) } });
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
  agentIds: z.array(z.string()).default([]),
});

// ============ POST إنشاء ============
router.post("/", requireRole("admin"), async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }
  const { name, email, ext, role, agentIds } = parsed.data;
  const id = parsed.data.id || `S-${Date.now()}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO supervisors (id, name, email, ext, role) VALUES ($1, $2, $3, $4, $5)`,
      [id, name, email, ext, role]
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
    console.error("[supervisors:create]", e);
    res.status(500).json({ error: "server_error", message: e.message });
  } finally {
    client.release();
  }
});

// ============ PUT تحديث ============
router.put("/:id", requireRole("admin"), async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }
  const { name, email, ext, role, agentIds } = parsed.data;
  const id = req.params.id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      `UPDATE supervisors SET name=$1, email=$2, ext=$3, role=$4 WHERE id=$5`,
      [name, email, ext, role, id]
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

export default router;
