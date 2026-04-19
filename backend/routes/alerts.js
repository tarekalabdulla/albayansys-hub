import { Router } from "express";
import { query } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authRequired);

router.get("/", async (_req, res) => {
  const { rows } = await query(
    `SELECT id, level, title, message, agent_id AS "agentId", is_read AS "isRead",
            EXTRACT(EPOCH FROM created_at) * 1000 AS time
     FROM alerts ORDER BY created_at DESC LIMIT 50`
  );
  res.json({ alerts: rows });
});

router.patch("/:id/read", async (req, res) => {
  await query("UPDATE alerts SET is_read = TRUE WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

router.delete("/:id", requireRole("admin", "supervisor"), async (req, res) => {
  await query("DELETE FROM alerts WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
