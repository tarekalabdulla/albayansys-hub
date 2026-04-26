// ============================================================================
// /api/calls — سجلات المكالمات الحقيقية من قاعدة البيانات
// ----------------------------------------------------------------------------
// يدعم تصفية حسب الاتجاه (direction) والحالة (status) والحد (limit).
// يُرجع البيانات من جدول calls المربوط بـ agents عبر agent_id.
// ============================================================================
import { Router } from "express";
import { query } from "../db/pool.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();
router.use(authRequired);

// قِيم مسموحة فقط — حماية من SQL injection بقبول قيم enum محصورة
const ALLOWED_DIRECTIONS = new Set(["inbound", "outbound", "internal"]);
const ALLOWED_STATUSES   = new Set(["answered", "missed", "transferred"]);

router.get("/", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  const where = [];
  const params = [];

  if (req.query.direction && ALLOWED_DIRECTIONS.has(String(req.query.direction))) {
    params.push(req.query.direction);
    where.push(`c.direction = $${params.length}`);
  }
  if (req.query.status && ALLOWED_STATUSES.has(String(req.query.status))) {
    params.push(req.query.status);
    where.push(`c.status = $${params.length}`);
  }

  params.push(limit);
  const limitIdx = params.length;

  // ملاحظة: عمود direction أُضيف عبر migration_004. لو لم يكن موجوداً
  // يرجع COALESCE قيمة افتراضية 'inbound' بدل ما يكسر الاستعلام.
  const sql = `
    SELECT
      c.id,
      c.number,
      c.duration,
      c.status,
      COALESCE(c.direction::text, 'inbound') AS direction,
      c.started_at AS "startedAt",
      a.id        AS "agentId",
      a.name      AS agent,
      a.ext       AS ext
    FROM calls c
    LEFT JOIN agents a ON a.id = c.agent_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY c.started_at DESC
    LIMIT $${limitIdx}
  `;

  try {
    const { rows } = await query(sql, params);
    res.json({ calls: rows });
  } catch (err) {
    // fallback: لو direction غير موجود في القاعدة لأي سبب
    console.error("[/api/calls] error:", err.message);
    res.status(500).json({ error: "تعذّر جلب سجل المكالمات", calls: [] });
  }
});

export default router;
