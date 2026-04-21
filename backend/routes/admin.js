// ============================================================
// Admin tools: Backup / Restore / Reset
// كل المسارات تتطلب صلاحية admin
// ============================================================
import { Router } from "express";
import { z } from "zod";
import { query, pool } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authRequired);
router.use(requireRole("admin"));

// قائمة الجداول التي تُصدَّر/تُستعاد بالترتيب الآمن (الأبناء بعد الآباء)
const TABLES_EXPORT_ORDER = [
  "users",
  "supervisors",
  "agents",
  "supervisor_agents",
  "calls",
  "recordings",
  "alerts",
  "mails",
  "ai_recommendations",
  "sentiment_daily",
  "system_settings",
];

// ترتيب التفريغ والاستعادة عكسي: نحذف الأبناء أولاً
const TABLES_RESET_ORDER = [
  "supervisor_agents",
  "recordings",
  "calls",
  "alerts",
  "mails",
  "ai_recommendations",
  "sentiment_daily",
  "agents",
  "supervisors",
];

// ============================================================
// GET /api/admin/backup — تنزيل نسخة احتياطية كاملة JSON
// ============================================================
router.get("/backup", async (_req, res) => {
  try {
    const data = {};
    for (const t of TABLES_EXPORT_ORDER) {
      try {
        const { rows } = await query(`SELECT * FROM ${t}`);
        data[t] = rows;
      } catch (e) {
        // إذا لم يكن الجدول موجوداً نتجاوزه (بيئات قديمة)
        if (e.code === "42P01") { data[t] = []; continue; }
        throw e;
      }
    }
    const payload = {
      app: "hulul-albayan",
      version: 1,
      exportedAt: new Date().toISOString(),
      counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
      data,
    };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="hulul-albayan-backup-${Date.now()}.json"`
    );
    res.send(JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error("[admin.backup]", e);
    res.status(500).json({ error: "backup_failed", message: e.message });
  }
});

// ============================================================
// POST /api/admin/restore — استعادة من نسخة JSON
// body: { backup: <json>, mode: "merge" | "replace" }
// merge   → INSERT ... ON CONFLICT DO NOTHING (لا يحذف شيء)
// replace → يحذف بيانات الجداول أولاً ثم يُدخل (يحتفظ بحساب admin)
// ============================================================
const restoreSchema = z.object({
  backup: z.object({
    app: z.string().optional(),
    data: z.record(z.array(z.record(z.any()))),
  }),
  mode: z.enum(["merge", "replace"]).default("merge"),
});

router.post("/restore", async (req, res) => {
  const parsed = restoreSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  }
  const { backup, mode } = parsed.data;
  const data = backup.data;
  const adminId = req.user.sub;

  const client = await pool.connect();
  const report = { mode, restored: {}, skipped: {}, errors: [] };

  try {
    await client.query("BEGIN");

    if (mode === "replace") {
      // امسح الأبناء أولاً
      for (const t of TABLES_RESET_ORDER) {
        try { await client.query(`DELETE FROM ${t}`); } catch (e) {
          if (e.code !== "42P01") throw e;
        }
      }
      // امسح المستخدمين عدا admin الحالي
      await client.query(`DELETE FROM users WHERE id <> $1`, [adminId]);
      // امسح الإعدادات (سنُعيد إدخالها)
      try { await client.query(`DELETE FROM system_settings`); } catch (e) {
        if (e.code !== "42P01") throw e;
      }
    }

    // أدخل بالترتيب الصحيح
    for (const t of TABLES_EXPORT_ORDER) {
      const rows = data[t];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      let restored = 0, skipped = 0;
      for (const row of rows) {
        // لا تُعِد إدخال admin الحالي لتجنّب تعارض id
        if (t === "users" && row.id === adminId) { skipped++; continue; }

        const cols = Object.keys(row);
        if (cols.length === 0) { skipped++; continue; }
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
        const values = cols.map((c) => {
          const v = row[c];
          // jsonb columns تأتي ككائنات → نحوّلها لنص لتجنب 'object Object'
          if (v !== null && typeof v === "object" && !(v instanceof Date)) {
            return JSON.stringify(v);
          }
          return v;
        });
        const colList = cols.map((c) => `"${c}"`).join(",");
        const sql = `INSERT INTO ${t} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
        try {
          const r = await client.query(sql, values);
          if (r.rowCount === 1) restored++; else skipped++;
        } catch (e) {
          skipped++;
          if (report.errors.length < 50) {
            report.errors.push({ table: t, code: e.code, message: e.message });
          }
        }
      }
      report.restored[t] = restored;
      report.skipped[t] = skipped;
    }

    await client.query("COMMIT");
    res.json({ ok: true, ...report });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[admin.restore]", e);
    res.status(500).json({ error: "restore_failed", message: e.message });
  } finally {
    client.release();
  }
});

// ============================================================
// POST /api/admin/reset — تصفير النظام
// body: { scope?: "data" | "all", confirm: "RESET" }
// scope=data (افتراضي): يمسح المكالمات/التسجيلات/الإحصائيات/التنبيهات/البريد
//                        ويبقي على المستخدمين والمشرفين والموظفين والإعدادات
// scope=all: يمسح كل شيء عدا حساب admin الحالي والإعدادات
// ============================================================
const resetSchema = z.object({
  scope: z.enum(["data", "all"]).default("data"),
  confirm: z.literal("RESET"),
});

router.post("/reset", async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  }
  const { scope } = parsed.data;
  const adminId = req.user.sub;

  const client = await pool.connect();
  const report = { scope, deleted: {} };
  try {
    await client.query("BEGIN");

    const dataTables = [
      "recordings", "calls", "alerts", "mails",
      "ai_recommendations", "sentiment_daily",
    ];
    for (const t of dataTables) {
      try {
        const r = await client.query(`DELETE FROM ${t}`);
        report.deleted[t] = r.rowCount;
      } catch (e) {
        if (e.code !== "42P01") throw e;
      }
    }

    if (scope === "all") {
      try { const r = await client.query(`DELETE FROM supervisor_agents`); report.deleted.supervisor_agents = r.rowCount; } catch (e) { if (e.code !== "42P01") throw e; }
      try { const r = await client.query(`DELETE FROM agents`);             report.deleted.agents = r.rowCount; } catch (e) { if (e.code !== "42P01") throw e; }
      try { const r = await client.query(`DELETE FROM supervisors`);        report.deleted.supervisors = r.rowCount; } catch (e) { if (e.code !== "42P01") throw e; }
      const r = await client.query(`DELETE FROM users WHERE id <> $1`, [adminId]);
      report.deleted.users = r.rowCount;
    }

    await client.query("COMMIT");
    res.json({ ok: true, ...report });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[admin.reset]", e);
    res.status(500).json({ error: "reset_failed", message: e.message });
  } finally {
    client.release();
  }
});

export default router;
