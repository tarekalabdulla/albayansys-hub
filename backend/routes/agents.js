import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(authRequired);

// GET /api/agents — قائمة جميع الموظفين (مع دور المستخدم المرتبط)
router.get("/", async (_req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.name, a.ext, a.avatar, a.status,
            EXTRACT(EPOCH FROM a.status_since) * 1000 AS "statusSince",
            a.answered, a.missed, a.avg_duration AS "avgDuration", a.supervisor,
            COALESCE(u.role::text, 'agent') AS role
     FROM agents a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.name`
  );
  res.json({ agents: rows });
});

// GET /api/agents/:id
router.get("/:id", async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.name, a.ext, a.avatar, a.status,
            EXTRACT(EPOCH FROM a.status_since) * 1000 AS "statusSince",
            a.answered, a.missed, a.avg_duration AS "avgDuration", a.supervisor,
            COALESCE(u.role::text, 'agent') AS role
     FROM agents a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.id = $1`,
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
