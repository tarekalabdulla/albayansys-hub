import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();
router.use(authRequired);

// ============================================================
// GET /api/mails?folder=inbox|sent|trash|starred
// ============================================================
router.get("/", async (req, res) => {
  const folder = String(req.query.folder || "inbox");
  const userId = req.user.sub;

  let sql;
  const params = [userId];

  if (folder === "starred") {
    sql = `SELECT * FROM mails WHERE owner_id = $1 AND is_starred = TRUE AND folder <> 'trash' ORDER BY created_at DESC`;
  } else if (["inbox", "sent", "trash"].includes(folder)) {
    sql = `SELECT * FROM mails WHERE owner_id = $1 AND folder = $2 ORDER BY created_at DESC`;
    params.push(folder);
  } else {
    return res.status(400).json({ error: "invalid_folder" });
  }

  const { rows } = await query(sql, params);
  res.json({ mails: rows.map(rowToMail) });
});

// ============================================================
// GET /api/mails/counts — أعداد لكل مجلد
// ============================================================
router.get("/counts", async (req, res) => {
  const userId = req.user.sub;
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE folder = 'inbox' AND is_read = FALSE)         AS inbox,
       COUNT(*) FILTER (WHERE folder = 'sent')                              AS sent,
       COUNT(*) FILTER (WHERE is_starred = TRUE AND folder <> 'trash')      AS starred,
       COUNT(*) FILTER (WHERE folder = 'trash')                             AS trash
     FROM mails WHERE owner_id = $1`,
    [userId]
  );
  const r = rows[0] || {};
  res.json({
    counts: {
      inbox: Number(r.inbox || 0),
      sent: Number(r.sent || 0),
      starred: Number(r.starred || 0),
      drafts: 0,
      trash: Number(r.trash || 0),
    },
  });
});

// ============================================================
// POST /api/mails — إرسال رسالة (ينشئ صفّين: sent للمرسل + inbox للمستلم)
// ============================================================
const sendSchema = z.object({
  toExt: z.string().trim().min(1).max(16),
  subject: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1),
  priority: z.enum(["high", "normal", "low"]).default("normal"),
});

router.post("/", async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const { toExt, subject, body, priority } = parsed.data;

  // اعثر على المستلم بواسطة ext (في users أو agents)
  const recipientQ = await query(
    `SELECT u.id, u.display_name AS name, u.ext FROM users u WHERE u.ext = $1 LIMIT 1`,
    [toExt]
  );
  let recipient = recipientQ.rows[0] || null;

  // كحل بديل ابحث في agents (لو لم يكن المستلم له user account)
  let recipientName = recipient?.name;
  if (!recipient) {
    const agentQ = await query(
      `SELECT name FROM agents WHERE ext = $1 LIMIT 1`,
      [toExt]
    );
    if (!agentQ.rows[0]) return res.status(404).json({ error: "recipient_not_found" });
    recipientName = agentQ.rows[0].name;
  }

  // معلومات المرسل
  const senderQ = await query(
    `SELECT id, display_name AS name, ext FROM users WHERE id = $1`,
    [req.user.sub]
  );
  const sender = senderQ.rows[0];
  if (!sender) return res.status(401).json({ error: "sender_not_found" });

  const threadId = crypto.randomUUID();

  // صفّ "sent" لدى المرسل
  const sentRow = await query(
    `INSERT INTO mails (owner_id, from_id, to_id, from_name, from_ext, to_name, to_ext,
                        subject, body, priority, folder, is_read, thread_id)
     VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, 'sent', TRUE, $10)
     RETURNING *`,
    [sender.id, recipient?.id || null, sender.name, sender.ext, recipientName, toExt,
     subject, body, priority, threadId]
  );

  // صفّ "inbox" لدى المستلم — فقط إن كان عنده user account
  if (recipient?.id) {
    await query(
      `INSERT INTO mails (owner_id, from_id, to_id, from_name, from_ext, to_name, to_ext,
                          subject, body, priority, folder, is_read, thread_id)
       VALUES ($1, $2, $1, $3, $4, $5, $6, $7, $8, $9, 'inbox', FALSE, $10)`,
      [recipient.id, sender.id, sender.name, sender.ext, recipientName, toExt,
       subject, body, priority, threadId]
    );
  }

  res.status(201).json({ mail: rowToMail(sentRow.rows[0]) });
});

// ============================================================
// PATCH /api/mails/:id — تحديث (read, starred, folder)
// ============================================================
const updateSchema = z.object({
  is_read: z.boolean().optional(),
  is_starred: z.boolean().optional(),
  folder: z.enum(["inbox", "sent", "trash"]).optional(),
});

router.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const fields = [];
  const values = [];
  let i = 1;
  for (const [k, v] of Object.entries(parsed.data)) {
    fields.push(`${k} = $${i++}`);
    values.push(v);
  }
  if (fields.length === 0) return res.status(400).json({ error: "no_changes" });

  values.push(req.params.id, req.user.sub);
  const { rows } = await query(
    `UPDATE mails SET ${fields.join(", ")} WHERE id = $${i++} AND owner_id = $${i} RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: "not_found" });
  res.json({ mail: rowToMail(rows[0]) });
});

// ============================================================
// DELETE /api/mails/:id — حذف نهائي (المالك فقط)
// ============================================================
router.delete("/:id", async (req, res) => {
  const { rowCount } = await query(
    `DELETE FROM mails WHERE id = $1 AND owner_id = $2`,
    [req.params.id, req.user.sub]
  );
  if (!rowCount) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

// ============================================================
// helper: صف DB → شكل الـ Frontend
// ============================================================
function rowToMail(r) {
  const initials = (name) =>
    String(name || "").split(" ").map(p => p[0]).filter(Boolean).join("").slice(0, 2);
  return {
    id: r.id,
    from: { name: r.from_name, ext: r.from_ext || "", avatar: initials(r.from_name) },
    to:   { name: r.to_name,   ext: r.to_ext   || "", avatar: initials(r.to_name) },
    subject: r.subject,
    body: r.body,
    date: r.created_at,
    read: r.is_read,
    starred: r.is_starred,
    priority: r.priority,
    folder: r.folder,
    ownerExt: "",
  };
}

export default router;
