import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(authRequired);

// GET /api/agents — قائمة جميع الموظفين
router.get("/", async (_req, res) => {
  const { rows } = await query(
    `SELECT id, name, ext, avatar, status,
            EXTRACT(EPOCH FROM status_since) * 1000 AS "statusSince",
            answered, missed, avg_duration AS "avgDuration", supervisor
     FROM agents ORDER BY name`
  );
  res.json({ agents: rows });
});

// GET /api/agents/:id
router.get("/:id", async (req, res) => {
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

// PATCH /api/agents/:id/status — تحديث حالة الموظف (admin/supervisor)
const statusSchema = z.object({
  status: z.enum(["online", "in_call", "idle", "break", "offline"]),
});
router.patch("/:id/status", requireRole("admin", "supervisor"), async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const { rows } = await query(
    `UPDATE agents SET status = $1, status_since = NOW() WHERE id = $2
     RETURNING id, name, status, EXTRACT(EPOCH FROM status_since) * 1000 AS "statusSince"`,
    [parsed.data.status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not_found" });

  // بثّ التحديث عبر Socket.io
  const io = req.app.get("io");
  io?.emit("agent:update", rows[0]);

  res.json({ agent: rows[0] });
});

export default router;
