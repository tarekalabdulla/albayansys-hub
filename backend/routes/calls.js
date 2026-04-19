import { Router } from "express";
import { query } from "../db/pool.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();
router.use(authRequired);

router.get("/", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const { rows } = await query(
    `SELECT c.id, c.number, c.duration, c.status,
            c.started_at AS "startedAt", a.name AS agent
     FROM calls c LEFT JOIN agents a ON a.id = c.agent_id
     ORDER BY c.started_at DESC LIMIT $1`,
    [limit]
  );
  res.json({ calls: rows });
});

export default router;
