import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authRequired);

// ============================================================
// GET /api/users  — قائمة المستخدمين (admin فقط)
// ============================================================
router.get("/", requireRole("admin"), async (_req, res) => {
  const { rows } = await query(
    `SELECT id, identifier, email, display_name AS name, role, is_active AS active,
            phone, department, ext, created_at
       FROM users
   ORDER BY created_at DESC`
  );
  res.json({ users: rows });
});

// ============================================================
// POST /api/users — إنشاء مستخدم (admin)
// ============================================================
const createSchema = z.object({
  name: z.string().trim().min(1).max(128),
  email: z.string().trim().email().max(255),
  identifier: z.string().trim().min(2).max(64).optional(),
  password: z.string().min(6).max(128),
  role: z.enum(["admin", "supervisor", "agent"]),
  active: z.boolean().default(true),
  phone: z.string().trim().max(32).optional(),
  department: z.string().trim().max(128).optional(),
  ext: z.string().trim().max(16).optional(),
});

router.post("/", requireRole("admin"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  }
  const d = parsed.data;
  const identifier = (d.identifier || d.email).toLowerCase().trim();
  const hash = await bcrypt.hash(d.password, 10);

  try {
    const { rows } = await query(
      `INSERT INTO users (identifier, password_hash, display_name, email, role, is_active, phone, department, ext)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, identifier, email, display_name AS name, role, is_active AS active, phone, department, ext, created_at`,
      [identifier, hash, d.name, d.email, d.role, d.active, d.phone || null, d.department || null, d.ext || null]
    );
    res.status(201).json({ user: rows[0] });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "duplicate", detail: "identifier or email" });
    throw e;
  }
});

// ============================================================
// PATCH /api/users/:id — تحديث (admin) أو الذات
// ============================================================
const updateSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  email: z.string().trim().email().max(255).optional(),
  role: z.enum(["admin", "supervisor", "agent"]).optional(),
  active: z.boolean().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  department: z.string().trim().max(128).nullable().optional(),
  ext: z.string().trim().max(16).nullable().optional(),
  bio: z.string().trim().max(1024).nullable().optional(),
  password: z.string().min(6).max(128).optional(),
});

router.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const isSelf = req.user.sub === req.params.id;
  const isAdmin = req.user.role === "admin";
  if (!isSelf && !isAdmin) return res.status(403).json({ error: "forbidden" });

  // غير المدير لا يستطيع تغيير الدور أو حالة التفعيل
  if (!isAdmin) {
    delete parsed.data.role;
    delete parsed.data.active;
  }

  const fields = [];
  const values = [];
  let i = 1;
  const map = {
    name: "display_name",
    email: "email",
    role: "role",
    active: "is_active",
    phone: "phone",
    department: "department",
    ext: "ext",
    bio: "bio",
  };
  for (const [k, col] of Object.entries(map)) {
    if (parsed.data[k] !== undefined) {
      fields.push(`${col} = $${i++}`);
      values.push(parsed.data[k]);
    }
  }
  if (parsed.data.password) {
    const hash = await bcrypt.hash(parsed.data.password, 10);
    fields.push(`password_hash = $${i++}`);
    values.push(hash);
  }
  if (fields.length === 0) return res.status(400).json({ error: "no_changes" });

  values.push(req.params.id);
  try {
    const { rows } = await query(
      `UPDATE users SET ${fields.join(", ")}
         WHERE id = $${i}
       RETURNING id, identifier, email, display_name AS name, role, is_active AS active, phone, department, ext, bio`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found" });
    res.json({ user: rows[0] });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "duplicate" });
    throw e;
  }
});

// ============================================================
// DELETE /api/users/:id (admin)
// ============================================================
router.delete("/:id", requireRole("admin"), async (req, res) => {
  if (req.user.sub === req.params.id) {
    return res.status(400).json({ error: "cannot_delete_self" });
  }
  const { rowCount } = await query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

// ============================================================
// PATCH /api/users/me/password — تغيير كلمة المرور للمستخدم الحالي
// ============================================================
const pwdSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6).max(128),
});

router.patch("/me/password", async (req, res) => {
  const parsed = pwdSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const { rows } = await query(
    `SELECT password_hash FROM users WHERE id = $1`,
    [req.user.sub]
  );
  if (!rows[0]) return res.status(404).json({ error: "not_found" });

  const ok = await bcrypt.compare(parsed.data.oldPassword, rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: "wrong_old_password" });

  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, req.user.sub]);
  res.json({ ok: true });
});

export default router;
