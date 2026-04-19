import { Router } from "express";
import { query } from "../db/pool.js";
import { authRequired } from "../middleware/auth.js";
import { allowedAgentIds } from "./agents.js";

const router = Router();
router.use(authRequired);

router.get("/", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const ids = await allowedAgentIds(req.user);

  let sql = `SELECT c.id, c.number, c.duration, c.status,
                    c.started_at AS "startedAt", a.name AS agent
             FROM calls c LEFT JOIN agents a ON a.id = c.agent_id`;
  const params = [];
  if (ids !== null) {
    if (ids.length === 0) return res.json({ calls: [] });
    sql += ` WHERE c.agent_id = ANY($1::varchar[])`;
    params.push(ids);
  }
  sql += ` ORDER BY c.started_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await query(sql, params);
  res.json({ calls: rows });
});

export default router;
