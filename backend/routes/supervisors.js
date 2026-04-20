import { Router } from "express";
import { z } from "zod";
import { query, pool } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authRequired);

// ============================================================
// GET /api/supervisors — قائمة المشرفين مع agentIds
// ============================================================
router.get("/", async (_req, res) => {
  const { rows } = await query(`
    SELECT s.id, s.name, s.email, s.ext, s.role,
           COALESCE(
             (SELECT json_agg(sa.agent_id ORDER BY sa.agent_id)
                FROM supervisor_agents sa
               WHERE sa.supervisor_id = s.id),
             '[]'::json
           ) AS "agentIds"
      FROM supervisors s
  ORDER BY s.created_at DESC, s.id
  `);
  res.json({ supervisors: rows });
});

// ============================================================
// GET /api/supervisors/:id
// ============================================================
router.get("/:id", async (req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.name, s.email, s.ext, s.role,
            COALESCE(
              (SELECT json_agg(sa.agent_id) FROM supervisor_agents sa WHERE sa.supervisor_id = s.id),
              '[]'::json
            ) AS "agentIds"
       FROM supervisors s WHERE s.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not_found" });
  res.json({ supervisor: rows[0] });
});

// ============================================================
// POST /api/supervisors  (admin)
// ============================================================
const supSchema = z.object({
  id: z.string().trim().min(1).max(32).optional(),
  name: z.string().trim().min(1).max(128),
  email: z.string().trim().email().max(255),
  ext: z.string().trim().min(1).max(16),
  role: z.enum(["مشرف", "مشرف أول", "مدير قسم"]),
  agentIds: z.array(z.string().max(32)).default([]),
});

router.post("/", requireRole("admin"), async (req, res) => {
  const parsed = supSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const d = parsed.data;
  const id = d.id || `S-${Date.now()}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO supervisors (id, name, email, ext, role) VALUES ($1,$2,$3,$4,$5)`,
      [id, d.name, d.email, d.ext, d.role]
    );
    if (d.agentIds.length) {
      const values = d.agentIds.map((_, i) => `($1, $${i + 2})`).join(",");
      await client.query(
        `INSERT INTO supervisor_agents (supervisor_id, agent_id) VALUES ${values}
         ON CONFLICT DO NOTHING`,
        [id, ...d.agentIds]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ supervisor: { id, ...d } });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.code === "23505") return res.status(409).json({ error: "duplicate" });
    throw e;
  } finally {
    client.release();
  }
});

// ============================================================
// PATCH /api/supervisors/:id  (admin)
// ============================================================
router.patch("/:id", requireRole("admin"), async (req, res) => {
  const parsed = supSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const d = parsed.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const fields = [];
    const values = [];
    let i = 1;
    for (const k of ["name", "email", "ext", "role"]) {
      if (d[k] !== undefined) { fields.push(`${k} = $${i++}`); values.push(d[k]); }
    }
    if (fields.length) {
      values.push(req.params.id);
      const { rowCount } = await client.query(
        `UPDATE supervisors SET ${fields.join(", ")} WHERE id = $${i}`,
        values
      );
      if (!rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "not_found" });
      }
    }

    if (d.agentIds) {
      await client.query(`DELETE FROM supervisor_agents WHERE supervisor_id = $1`, [req.params.id]);
      if (d.agentIds.length) {
        const v = d.agentIds.map((_, i) => `($1, $${i + 2})`).join(",");
        await client.query(
          `INSERT INTO supervisor_agents (supervisor_id, agent_id) VALUES ${v} ON CONFLICT DO NOTHING`,
          [req.params.id, ...d.agentIds]
        );
      }
    }

    await client.query("COMMIT");
    const { rows } = await query(
      `SELECT s.id, s.name, s.email, s.ext, s.role,
              COALESCE((SELECT json_agg(sa.agent_id) FROM supervisor_agents sa WHERE sa.supervisor_id = s.id),'[]'::json) AS "agentIds"
         FROM supervisors s WHERE s.id = $1`,
      [req.params.id]
    );
    res.json({ supervisor: rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

// ============================================================
// DELETE /api/supervisors/:id  (admin)
// ============================================================
router.delete("/:id", requireRole("admin"), async (req, res) => {
  const { rowCount } = await query(`DELETE FROM supervisors WHERE id = $1`, [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

export default router;
