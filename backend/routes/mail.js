import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();
router.use(authRequired);

// ============================================
// GET /api/mail?folder=inbox|sent|starred|trash
// ============================================
router.get("/", async (req, res) => {
  const folder = String(req.query.folder || "inbox");
  const userId = req.user.sub;

  let where = "";
  if (folder === "starred") {
    where = `s.user_id = $1 AND s.starred = TRUE AND s.folder <> 'trash'`;
  } else {
    where = `s.user_id = $1 AND s.folder = $2`;
  }

  const params = folder === "starred" ? [userId] : [userId, folder];

  const { rows } = await query(
    `SELECT
       m.id, m.subject, m.body, m.priority, m.created_at AS date,
       s.is_read AS read, s.starred, s.folder,
       fu.id AS from_id, fu.identifier AS from_ext,
         COALESCE(fu.display_name, fu.identifier) AS from_name,
         COALESCE(fu.avatar_url, '') AS from_avatar,
       tu.id AS to_id, tu.identifier AS to_ext,
         COALESCE(tu.display_name, tu.identifier) AS to_name,
         COALESCE(tu.avatar_url, '') AS to_avatar
     FROM mail_states s
     JOIN mail_messages m ON m.id = s.message_id
     JOIN users fu ON fu.id = m.from_user_id
     JOIN users tu ON tu.id = m.to_user_id
     WHERE ${where}
     ORDER BY m.created_at DESC
     LIMIT 200`,
    params
  );
  res.json({ items: rows });
});

// ============================================
// GET /api/mail/counts — عدّاد المجلدات
// ============================================
router.get("/counts", async (req, res) => {
  const userId = req.user.sub;
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE folder='inbox' AND is_read=FALSE)::int AS inbox,
       COUNT(*) FILTER (WHERE folder='sent')::int                    AS sent,
       COUNT(*) FILTER (WHERE folder='trash')::int                   AS trash,
       COUNT(*) FILTER (WHERE starred=TRUE AND folder<>'trash')::int AS starred
     FROM mail_states WHERE user_id = $1`,
    [userId]
  );
  res.json(rows[0] || { inbox: 0, sent: 0, trash: 0, starred: 0 });
});

// ============================================
// GET /api/mail/recipients — قائمة المستخدمين المتاحين كمستلمين
// ============================================
router.get("/recipients", async (req, res) => {
  const userId = req.user.sub;
  const { rows } = await query(
    `SELECT id, identifier AS ext, COALESCE(display_name, identifier) AS name,
            COALESCE(avatar_url, '') AS avatar
     FROM users WHERE is_active = TRUE AND id <> $1
     ORDER BY display_name NULLS LAST, identifier
     LIMIT 500`,
    [userId]
  );
  res.json({ items: rows });
});

// ============================================
// POST /api/mail — إرسال رسالة جديدة
// ============================================
const sendSchema = z.object({
  to_user_id: z.string().uuid(),
  subject:    z.string().trim().min(1).max(255),
  body:       z.string().trim().min(1).max(20000),
  priority:   z.enum(["high", "normal", "low"]).default("normal"),
});

router.post("/", async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const { to_user_id, subject, body, priority } = parsed.data;
  const fromId = req.user.sub;

  const { rows: msgRows } = await query(
    `INSERT INTO mail_messages (from_user_id, to_user_id, subject, body, priority)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [fromId, to_user_id, subject, body, priority]
  );
  const msgId = msgRows[0].id;

  // حالة المرسل (sent + read)
  await query(
    `INSERT INTO mail_states (message_id, user_id, folder, is_read) VALUES ($1, $2, 'sent', TRUE)`,
    [msgId, fromId]
  );
  // حالة المستقبل (inbox + غير مقروء)
  if (to_user_id !== fromId) {
    await query(
      `INSERT INTO mail_states (message_id, user_id, folder, is_read) VALUES ($1, $2, 'inbox', FALSE)`,
      [msgId, to_user_id]
    );
  }

  res.json({ ok: true, id: msgId });
});

// ============================================
// PATCH /api/mail/:id — تحديث read/starred/folder
// ============================================
const patchSchema = z.object({
  is_read: z.boolean().optional(),
  starred: z.boolean().optional(),
  folder:  z.enum(["inbox", "sent", "trash"]).optional(),
});

router.patch("/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const { id } = req.params;
  const userId = req.user.sub;

  const fields = [];
  const values = [];
  let i = 1;
  for (const [k, v] of Object.entries(parsed.data)) {
    fields.push(`${k} = $${i++}`);
    values.push(v);
  }
  if (!fields.length) return res.status(400).json({ error: "no_fields" });
  fields.push(`updated_at = NOW()`);

  values.push(id, userId);
  const { rowCount } = await query(
    `UPDATE mail_states SET ${fields.join(", ")}
     WHERE message_id = $${i++} AND user_id = $${i}`,
    values
  );
  if (!rowCount) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

// ============================================
// DELETE /api/mail/:id — نقل إلى trash (أو حذف نهائي إن كانت بالفعل في trash)
// ============================================
router.delete("/:id", async (req, res) => {
  const userId = req.user.sub;
  const { id } = req.params;
  const { rows } = await query(
    `SELECT folder FROM mail_states WHERE message_id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!rows[0]) return res.status(404).json({ error: "not_found" });
  if (rows[0].folder === "trash") {
    await query(`DELETE FROM mail_states WHERE message_id = $1 AND user_id = $2`, [id, userId]);
  } else {
    await query(
      `UPDATE mail_states SET folder='trash', updated_at=NOW() WHERE message_id=$1 AND user_id=$2`,
      [id, userId]
    );
  }
  res.json({ ok: true });
});

export default router;
