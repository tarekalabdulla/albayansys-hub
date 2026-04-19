// إدارة المستخدمين — للأدمن فقط
import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { uploadAvatar, deleteUploadedFile } from "../middleware/upload.js";

const router = Router();

// كل المسارات تتطلب admin
router.use(authRequired, requireRole("admin"));

const SELECT_FIELDS = `
  id, identifier, role, display_name, email, ext, department, phone,
  bio, job_title, avatar_url, is_active, created_at, updated_at
`;

// قائمة المستخدمين
router.get("/", async (_req, res) => {
  const { rows } = await query(
    `SELECT ${SELECT_FIELDS} FROM users ORDER BY created_at DESC`
  );
  res.json({ users: rows });
});

// مستخدم واحد
router.get("/:id", async (req, res) => {
  const { rows } = await query(
    `SELECT ${SELECT_FIELDS} FROM users WHERE id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not_found" });
  res.json({ user: rows[0] });
});

// إنشاء
const createSchema = z.object({
  identifier:   z.string().trim().min(2).max(64).toLowerCase(),
  password:     z.string().min(6).max(128),
  role:         z.enum(["admin", "supervisor", "agent"]),
  display_name: z.string().trim().min(1).max(128),
  email:        z.string().trim().email().max(255).optional().or(z.literal("")),
  ext:          z.string().trim().max(16).optional().or(z.literal("")),
  department:   z.string().trim().max(128).optional().or(z.literal("")),
  phone:        z.string().trim().max(32).optional().or(z.literal("")),
  job_title:    z.string().trim().max(128).optional().or(z.literal("")),
  is_active:    z.boolean().optional().default(true),
});

router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  }
  const d = parsed.data;
  const password_hash = await bcrypt.hash(d.password, 10);
  try {
    const { rows } = await query(
      `INSERT INTO users
        (identifier, password_hash, role, display_name, email, ext, department, phone, job_title, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${SELECT_FIELDS}`,
      [
        d.identifier, password_hash, d.role, d.display_name,
        d.email || null, d.ext || null, d.department || null,
        d.phone || null, d.job_title || null, d.is_active,
      ]
    );
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "identifier_taken" });
    }
    throw err;
  }
});

// تحديث
const updateSchema = z.object({
  password:     z.string().min(6).max(128).optional(),
  role:         z.enum(["admin", "supervisor", "agent"]).optional(),
  display_name: z.string().trim().min(1).max(128).optional(),
  email:        z.string().trim().email().max(255).optional().or(z.literal("")),
  ext:          z.string().trim().max(16).optional().or(z.literal("")),
  department:   z.string().trim().max(128).optional().or(z.literal("")),
  phone:        z.string().trim().max(32).optional().or(z.literal("")),
  bio:          z.string().trim().max(1000).optional().or(z.literal("")),
  job_title:    z.string().trim().max(128).optional().or(z.literal("")),
  is_active:    z.boolean().optional(),
});

router.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  // منع الأدمن من إنزال نفسه أو تعطيل نفسه (آخر أدمن)
  if (req.params.id === req.user.sub) {
    if (parsed.data.role && parsed.data.role !== "admin") {
      return res.status(400).json({ error: "cannot_demote_self" });
    }
    if (parsed.data.is_active === false) {
      return res.status(400).json({ error: "cannot_disable_self" });
    }
  }

  const fields = [];
  const values = [];
  let i = 1;

  for (const [key, val] of Object.entries(parsed.data)) {
    if (val === undefined) continue;
    if (key === "password") {
      const hash = await bcrypt.hash(val, 10);
      fields.push(`password_hash = $${i++}`);
      values.push(hash);
    } else {
      fields.push(`${key} = $${i++}`);
      values.push(val === "" && key !== "display_name" ? null : val);
    }
  }
  if (!fields.length) return res.status(400).json({ error: "no_fields" });

  values.push(req.params.id);
  try {
    const { rows } = await query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${i}
       RETURNING ${SELECT_FIELDS}`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found" });
    res.json({ user: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "duplicate_value" });
    }
    throw err;
  }
});

// حذف
router.delete("/:id", async (req, res) => {
  if (req.params.id === req.user.sub) {
    return res.status(400).json({ error: "cannot_delete_self" });
  }
  // اجلب الـ avatar أولاً لحذف ملفه من القرص
  const { rows: prev } = await query("SELECT avatar_url FROM users WHERE id = $1", [req.params.id]);
  if (!prev[0]) return res.status(404).json({ error: "not_found" });

  const { rowCount } = await query("DELETE FROM users WHERE id = $1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "not_found" });

  if (prev[0].avatar_url) deleteUploadedFile(prev[0].avatar_url);
  res.json({ ok: true });
});

// رفع صورة شخصية لمستخدم محدد (أدمن)
router.post(
  "/:id/avatar",
  (req, res, next) => {
    uploadAvatar.single("avatar")(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "file_too_large" });
      if (err.message === "invalid_file_type") return res.status(415).json({ error: "invalid_file_type" });
      return res.status(400).json({ error: "upload_failed" });
    });
  },
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "no_file" });
    const publicUrl = `/uploads/avatars/${req.file.filename}`;

    const { rows: prev } = await query("SELECT avatar_url FROM users WHERE id = $1", [req.params.id]);
    if (!prev[0]) {
      // المستخدم غير موجود — احذف الملف الجديد لتجنّب اليتامى
      deleteUploadedFile(publicUrl);
      return res.status(404).json({ error: "not_found" });
    }
    const prevUrl = prev[0].avatar_url;

    const { rows } = await query(
      `UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING ${SELECT_FIELDS}`,
      [publicUrl, req.params.id]
    );
    if (prevUrl && prevUrl !== publicUrl) deleteUploadedFile(prevUrl);
    res.json({ user: rows[0] });
  }
);

// حذف صورة شخصية لمستخدم محدد (أدمن)
router.delete("/:id/avatar", async (req, res) => {
  const { rows: prev } = await query("SELECT avatar_url FROM users WHERE id = $1", [req.params.id]);
  if (!prev[0]) return res.status(404).json({ error: "not_found" });
  const prevUrl = prev[0].avatar_url;
  const { rows } = await query(
    `UPDATE users SET avatar_url = NULL WHERE id = $1 RETURNING ${SELECT_FIELDS}`,
    [req.params.id]
  );
  if (prevUrl) deleteUploadedFile(prevUrl);
  res.json({ user: rows[0] });
});

export default router;
