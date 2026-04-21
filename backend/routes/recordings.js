import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { query } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authRequired);

// ============================================================
// إعداد multer لرفع ملفات الصوت إلى backend/uploads/recordings/
// ============================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const AUDIO_DIR  = path.join(__dirname, "..", "uploads", "recordings");
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav",
  "audio/ogg", "audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a",
]);
const ALLOWED_EXT = new Set([".mp3", ".wav", ".ogg", ".webm", ".m4a", ".mp4"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AUDIO_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || ".mp3").toLowerCase();
    const safe = ALLOWED_EXT.has(ext) ? ext : ".mp3";
    cb(null, `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (ALLOWED_MIME.has(file.mimetype) || ALLOWED_EXT.has(ext)) cb(null, true);
    else cb(new Error("نوع ملف غير مدعوم — استخدم mp3 / wav / m4a / ogg"));
  },
});

function publicAudioUrl(req, filename) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host  = req.headers["x-forwarded-host"]  || req.get("host");
  return `${proto}://${host}/uploads/recordings/${filename}`;
}

function audioFilenameFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/uploads\/recordings\/([^/?#]+)$/);
  return m ? m[1] : null;
}

// ============================================================
// GET /api/recordings — قائمة (يمكن فلترة بالفئة)
// ============================================================
router.get("/", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const { rows } = await query(
    `SELECT id, agent_id AS "agentId", agent_name AS "agentName", agent_avatar AS "agentAvatar",
            customer_number AS "customerNumber", duration, audio_url AS "audioUrl",
            quality_score AS "qualityScore", sentiment, category, tags,
            metrics, transcript, summary,
            TO_CHAR(recorded_at, 'YYYY-MM-DD') AS date,
            TO_CHAR(recorded_at, 'HH24:MI')    AS time,
            recorded_at AS "recordedAt"
     FROM recordings
     ORDER BY recorded_at DESC
     LIMIT $1`,
    [limit]
  );
  res.json({ recordings: rows });
});

// ============================================================
// GET /api/recordings/:id
// ============================================================
router.get("/:id", async (req, res) => {
  const { rows } = await query(
    `SELECT id, agent_id AS "agentId", agent_name AS "agentName", agent_avatar AS "agentAvatar",
            customer_number AS "customerNumber", duration, audio_url AS "audioUrl",
            quality_score AS "qualityScore", sentiment, category, tags,
            metrics, transcript, summary,
            TO_CHAR(recorded_at, 'YYYY-MM-DD') AS date,
            TO_CHAR(recorded_at, 'HH24:MI')    AS time
     FROM recordings WHERE id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not_found" });
  res.json({ recording: rows[0] });
});

// ============================================================
// POST /api/recordings — إنشاء تسجيل واحد (admin/supervisor)
// ============================================================
const createSchema = z.object({
  id: z.string().trim().min(1).max(32).optional(),
  agentId: z.string().trim().max(32).nullable().optional(),
  agentName: z.string().trim().min(1).max(128),
  agentAvatar: z.string().trim().max(8).optional(),
  customerNumber: z.string().trim().min(1).max(32),
  duration: z.coerce.number().int().min(0).default(0),
  audioUrl: z.string().trim().url().max(2000).nullable().optional().or(z.literal("")),
  qualityScore: z.coerce.number().int().min(0).max(100).default(0),
  sentiment: z.enum(["positive", "neutral", "negative"]).default("neutral"),
  category: z.string().trim().max(32).optional(),
  tags: z.array(z.string()).optional(),
  metrics: z.array(z.any()).optional(),
  transcript: z.array(z.any()).optional(),
  summary: z.string().trim().max(4000).optional(),
  recordedAt: z.string().trim().optional(),
});

async function insertRecording(d) {
  const id = d.id || `REC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const recordedAt = d.recordedAt ? new Date(d.recordedAt) : new Date();
  const avatar = d.agentAvatar
    || d.agentName.split(" ").map(p => p[0]).filter(Boolean).join("").slice(0, 2);
  await query(
    `INSERT INTO recordings (id, agent_id, agent_name, agent_avatar, customer_number, duration,
                             audio_url, quality_score, sentiment, category, tags, metrics, transcript, summary, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      id,
      d.agentId || null,
      d.agentName,
      avatar,
      d.customerNumber,
      d.duration || 0,
      d.audioUrl || null,
      d.qualityScore || 0,
      d.sentiment || "neutral",
      d.category || null,
      d.tags || [],
      JSON.stringify(d.metrics || []),
      JSON.stringify(d.transcript || []),
      d.summary || null,
      recordedAt,
    ]
  );
  return id;
}

router.post("/", requireRole("admin", "supervisor"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  }
  try {
    const id = await insertRecording(parsed.data);
    res.status(201).json({ id });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "duplicate" });
    console.error("[recordings.create]", e);
    res.status(500).json({ error: "server_error", message: e.message });
  }
});

// ============================================================
// POST /api/recordings/bulk — استيراد دفعة من CSV (admin/supervisor)
// ============================================================
const bulkSchema = z.object({
  rows: z.array(z.record(z.any())).min(1).max(2000),
});

router.post("/bulk", requireRole("admin", "supervisor"), async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const results = { created: 0, skipped: 0, errors: [] };
  for (let i = 0; i < parsed.data.rows.length; i++) {
    const raw = parsed.data.rows[i];
    const candidate = {
      id: raw.id || raw.ID || undefined,
      agentId: raw.agentId || raw.agent_id || null,
      agentName: raw.agentName || raw.agent_name || raw["الموظف"],
      customerNumber: raw.customerNumber || raw.customer_number || raw["رقم العميل"],
      duration: raw.duration ?? raw["المدة"] ?? 0,
      audioUrl: raw.audioUrl || raw.audio_url || undefined,
      qualityScore: raw.qualityScore ?? raw.quality_score ?? raw["الجودة"] ?? 0,
      sentiment: raw.sentiment || "neutral",
      category: raw.category || raw["الفئة"] || undefined,
      tags: typeof raw.tags === "string"
        ? raw.tags.split(/[,;|]/).map(s => s.trim()).filter(Boolean)
        : (raw.tags || []),
      summary: raw.summary || raw["الملخص"] || undefined,
      recordedAt: raw.recordedAt || raw.recorded_at || raw.date || undefined,
    };

    const v = createSchema.safeParse(candidate);
    if (!v.success) {
      results.skipped++;
      results.errors.push({ row: i + 2, reason: "invalid", details: v.error.flatten().fieldErrors });
      continue;
    }
    try {
      await insertRecording(v.data);
      results.created++;
    } catch (e) {
      results.skipped++;
      results.errors.push({ row: i + 2, reason: e.code === "23505" ? "duplicate" : "db_error", message: e.message });
    }
  }
  res.json(results);
});

// ============================================================
// DELETE /api/recordings/:id (admin/supervisor)
// ============================================================
router.delete("/:id", requireRole("admin", "supervisor"), async (req, res) => {
  const { rowCount } = await query(`DELETE FROM recordings WHERE id = $1`, [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

export default router;
