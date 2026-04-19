import { Router } from "express";
import { pool } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authRequired, requireRole("admin"));

// POST /api/admin/reset-all
// تصفير شامل: المكالمات + CDR + التنبيهات + البريد + المشرفين + إحصائيات الموظفين
// لا يحذف: المستخدمين، الموظفين أنفسهم، إعدادات السنترال
router.post("/reset-all", async (req, res) => {
  const scopes = Array.isArray(req.body?.scopes) && req.body.scopes.length
    ? req.body.scopes
    : ["calls", "alerts", "mail", "supervisors", "stats"];

  const summary = {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (scopes.includes("calls")) {
      const r1 = await client.query(`DELETE FROM calls`);
      summary.calls = r1.rowCount;
      try {
        const r2 = await client.query(`DELETE FROM yeastar_cdr`);
        summary.yeastar_cdr = r2.rowCount;
      } catch { /* الجدول قد لا يكون موجوداً */ }
    }

    if (scopes.includes("alerts")) {
      try {
        const r = await client.query(`DELETE FROM alerts`);
        summary.alerts = r.rowCount;
      } catch { /* ignore */ }
    }

    if (scopes.includes("mail")) {
      try {
        const r1 = await client.query(`DELETE FROM mail_states`);
        const r2 = await client.query(`DELETE FROM mail_messages`);
        summary.mail_states = r1.rowCount;
        summary.mail_messages = r2.rowCount;
      } catch { /* ignore */ }
    }

    if (scopes.includes("supervisors")) {
      try {
        const r1 = await client.query(`DELETE FROM supervisor_agents`);
        const r2 = await client.query(`DELETE FROM supervisors`);
        summary.supervisor_agents = r1.rowCount;
        summary.supervisors = r2.rowCount;
      } catch { /* ignore */ }
    }

    if (scopes.includes("stats")) {
      // تصفير عدّادات الموظفين (لا نحذف الموظفين)
      try {
        const r = await client.query(`
          UPDATE agents SET
            answered_today = 0,
            missed_today = 0,
            avg_duration = 0,
            sla = 0,
            status = 'offline'
        `);
        summary.agents_reset = r.rowCount;
      } catch { /* ignore — قد لا تكون كل الأعمدة موجودة */ }
    }

    await client.query("COMMIT");
    res.json({ ok: true, summary });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

export default router;
