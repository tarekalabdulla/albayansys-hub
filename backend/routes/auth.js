import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { query } from "../db/pool.js";
import { signToken, authRequired } from "../middleware/auth.js";
import { uploadAvatar, deleteUploadedFile } from "../middleware/upload.js";

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
    `SELECT id, identifier, role, display_name, email, ext, department, phone, bio, job_title, avatar_url
     FROM users WHERE id = $1`,
    [req.user.sub]
  );
  if (!rows[0]) return res.status(404).json({ error: "not_found" });
  res.json({ user: rows[0] });
});

router.post("/logout", authRequired, (_req, res) => {
  // JWT stateless — العميل يحذف التوكن
  res.json({ ok: true });
});

// ============================================================
// تحديث الملف الشخصي
// ============================================================
const updateProfileSchema = z.object({
  display_name: z.string().trim().min(1).max(128).optional(),
  email:        z.string().trim().email().max(255).optional().or(z.literal("")),
  ext:          z.string().trim().max(16).optional().or(z.literal("")),
  department:   z.string().trim().max(128).optional().or(z.literal("")),
  phone:        z.string().trim().max(32).optional().or(z.literal("")),
  bio:          z.string().trim().max(1000).optional().or(z.literal("")),
  job_title:    z.string().trim().max(128).optional().or(z.literal("")),
});

const ALLOWED_FIELDS = ["display_name", "email", "ext", "department", "phone", "bio", "job_title"];

router.patch("/me", authRequired, async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const fields = [];
  const values = [];
  let i = 1;
  for (const key of ALLOWED_FIELDS) {
    if (parsed.data[key] !== undefined) {
      fields.push(`${key} = $${i++}`);
      // فرّغ السلسلة الفارغة إلى NULL لحقول غير display_name
      values.push(parsed.data[key] === "" && key !== "display_name" ? null : parsed.data[key]);
    }
  }
  if (!fields.length) return res.status(400).json({ error: "no_fields" });

  values.push(req.user.sub);
  try {
    const { rows } = await query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${i}
       RETURNING id, identifier, role, display_name, email, ext, department, phone, bio, job_title, avatar_url`,
      values
    );
    res.json({ user: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "email_taken" });
    }
    throw err;
  }
});

// ============================================================
// تغيير كلمة السر
// ============================================================
const changePwdSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: z.string().min(8).max(128),
});

router.post("/change-password", authRequired, async (req, res) => {
  const parsed = changePwdSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const { current_password, new_password } = parsed.data;
  const { rows } = await query(
    "SELECT id, password_hash FROM users WHERE id = $1",
    [req.user.sub]
  );
  const user = rows[0];
  if (!user) return res.status(404).json({ error: "not_found" });

  const ok = await bcrypt.compare(current_password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "wrong_current_password" });

  const newHash = await bcrypt.hash(new_password, 10);
  await query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, user.id]);
  res.json({ ok: true });
});

// ============================================================
// رفع الصورة الشخصية (avatar)
// ============================================================
router.post(
  "/avatar",
  authRequired,
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

    // اجلب القديمة لتنظيفها
    const { rows: prevRows } = await query("SELECT avatar_url FROM users WHERE id = $1", [req.user.sub]);
    const prevUrl = prevRows[0]?.avatar_url;

    const { rows } = await query(
      `UPDATE users SET avatar_url = $1 WHERE id = $2
       RETURNING id, identifier, role, display_name, email, ext, department, phone, bio, job_title, avatar_url`,
      [publicUrl, req.user.sub]
    );
    if (prevUrl && prevUrl !== publicUrl) deleteUploadedFile(prevUrl);
    res.json({ user: rows[0] });
  }
);

// حذف الصورة الشخصية
router.delete("/avatar", authRequired, async (req, res) => {
  const { rows: prevRows } = await query("SELECT avatar_url FROM users WHERE id = $1", [req.user.sub]);
  const prevUrl = prevRows[0]?.avatar_url;
  const { rows } = await query(
    `UPDATE users SET avatar_url = NULL WHERE id = $1
     RETURNING id, identifier, role, display_name, email, ext, department, phone, bio, job_title, avatar_url`,
    [req.user.sub]
  );
  if (prevUrl) deleteUploadedFile(prevUrl);
  res.json({ user: rows[0] });
});

export default router;
