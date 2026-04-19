import { Router } from "express";
import { spawn } from "child_process";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { pool } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authRequired, requireRole("admin"));

// تخزين مؤقّت لملفات الاستعادة (.sql / .dump) — حد 200MB
const RESTORE_TMP_DIR = path.join(os.tmpdir(), "hulul-restore");
fs.mkdirSync(RESTORE_TMP_DIR, { recursive: true });

const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, RESTORE_TMP_DIR),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || "").toLowerCase();
      const safeExt = ext === ".dump" ? ".dump" : ".sql";
      const rand = crypto.randomBytes(8).toString("hex");
      cb(null, `restore-${Date.now()}-${rand}${safeExt}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    if (ext !== ".sql" && ext !== ".dump") {
      return cb(new Error("نوع ملف غير مدعوم — استخدم .sql أو .dump فقط"));
    }
    cb(null, true);
  },
});

// GET /api/admin/backup — تنزيل SQL dump كامل لقاعدة البيانات
// يستخدم pg_dump المثبّت على الخادم. يدعم plain أو custom format.
router.get("/backup", async (req, res) => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return res.status(500).json({ error: "DATABASE_URL غير مضبوط" });
  }

  const fmt = req.query.format === "custom" ? "custom" : "plain";
  const ext = fmt === "custom" ? "dump" : "sql";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `hulul-backup-${ts}.${ext}`;
  const mime = fmt === "custom" ? "application/octet-stream" : "application/sql";

  // pg_dump args: تضمين البيانات، مع DROP لاستعادة نظيفة، بدون owner/privileges
  const args = [
    "--dbname", dbUrl,
    "--no-owner",
    "--no-privileges",
    "--clean",
    "--if-exists",
    fmt === "custom" ? "--format=custom" : "--format=plain",
  ];

  const child = spawn("pg_dump", args, { env: process.env });

  let started = false;
  let stderr = "";

  child.stderr.on("data", (d) => { stderr += d.toString(); });

  child.stdout.on("data", (chunk) => {
    if (!started) {
      started = true;
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
    }
    res.write(chunk);
  });

  child.on("error", (err) => {
    if (!started) {
      return res.status(500).json({ error: "pg_dump غير متوفر على الخادم", detail: err.message });
    }
    res.end();
  });

  child.on("close", (code) => {
    if (code === 0) {
      if (!started) {
        // لم يخرج شيء؟ (نادر) — أرسل ملفاً فارغاً
        res.setHeader("Content-Type", mime);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      }
      res.end();
    } else {
      if (!started) {
        return res.status(500).json({ error: "فشل pg_dump", code, detail: stderr.slice(0, 500) });
      }
      // إذا بدأ البث ثم فشل: أنهِ الاستجابة (لا يمكن إرسال JSON بعدها)
      res.end();
    }
  });
});


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
