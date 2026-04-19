import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { query } from "../db/pool.js";
import { signToken, authRequired } from "../middleware/auth.js";

const router = Router();

const loginSchema = z.object({
  identifier: z.string().min(2).max(64),
  password: z.string().min(4).max(128),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input" });
  }
  const { identifier, password } = parsed.data;

  const { rows } = await query(
    "SELECT id, identifier, password_hash, role, display_name, is_active FROM users WHERE identifier = $1",
    [identifier.toLowerCase().trim()]
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });

  const token = signToken({ sub: user.id, identifier: user.identifier, role: user.role });
  res.json({
    token,
    user: {
      id: user.id,
      identifier: user.identifier,
      role: user.role,
      display_name: user.display_name,
    },
  });
});

router.get("/me", authRequired, async (req, res) => {
  const { rows } = await query(
    "SELECT id, identifier, role, display_name FROM users WHERE id = $1",
    [req.user.sub]
  );
  if (!rows[0]) return res.status(404).json({ error: "not_found" });
  res.json({ user: rows[0] });
});

router.post("/logout", authRequired, (_req, res) => {
  // JWT stateless — العميل يحذف التوكن
  res.json({ ok: true });
});

export default router;
