// سجل المكالمات (CDR) من Yeastar P-Series Open API
// GET    /api/cdr            — قائمة CDR مع فلاتر (page, page_size, start, end, search)
// GET    /api/cdr/recording  — تنزيل/بث ملف التسجيل (?call_id=... أو ?recording_file=...)
import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth.js";
import { getYeastarToken, yeastarFetch } from "../lib/yeastar.js";
import { query } from "../db/pool.js";

const router = Router();
router.use(authRequired);

// أداة: جلب extensions المسموحة للمستخدم (admin → null = الكل)
async function allowedExtensions(user) {
  if (user.role === "admin") return null;
  if (user.role === "supervisor") {
    const { rows } = await query(
      `SELECT a.ext FROM supervisors s
       JOIN supervisor_agents sa ON sa.supervisor_id = s.id
       JOIN agents a ON a.id = sa.agent_id
       WHERE s.user_id = $1 AND a.ext IS NOT NULL`,
      [user.sub]
    );
    return rows.map((r) => r.ext);
  }
  // agent
  const { rows } = await query(
    `SELECT a.ext FROM agents a WHERE a.user_id = $1 AND a.ext IS NOT NULL
     UNION
     SELECT u.ext FROM users u WHERE u.id = $1 AND u.ext IS NOT NULL`,
    [user.sub]
  );
  return rows.map((r) => r.ext).filter(Boolean);
}

const listSchema = z.object({
  page:        z.coerce.number().int().min(1).max(1000).optional().default(1),
  page_size:   z.coerce.number().int().min(1).max(200).optional().default(50),
  start_time:  z.string().trim().max(40).optional(),  // ISO أو "YYYY-MM-DD HH:mm:ss"
  end_time:    z.string().trim().max(40).optional(),
  search:      z.string().trim().max(64).optional(),  // رقم/تحويلة
  call_status: z.enum(["ANSWERED", "NO ANSWER", "BUSY", "FAILED", "VOICEMAIL"]).optional(),
});

function normalizeRow(r) {
  // مرونة لاسم الحقول حسب موديل P-Series
  const id = r.id || r.call_id || r.uuid || r.uniqueid || r.linkedid || String(r.time || Math.random());
  const startedAt = r.time || r.start_time || r.timestamp || r.call_time || null;
  const fromNum   = r.src || r.caller_number || r.from || r.src_num || "";
  const fromName  = r.caller_name || r.src_name || "";
  const toNum     = r.dst || r.callee_number || r.to || r.dst_num || "";
  const toName    = r.callee_name || r.dst_name || "";
  const ext       = r.ext || r.extension || r.dst_ext || r.src_ext || "";
  const duration  = Number(r.duration || r.billsec || r.talk_duration || 0);
  const status    = r.status || r.disposition || r.call_status || "";
  const direction = r.type || r.call_type || r.direction || "";
  const recFile   = r.recording_file || r.recording || r.record_file || r.recording_filename || null;
  const hasRec    = !!recFile || r.has_recording === 1 || r.has_recording === true;

  return {
    id: String(id),
    startedAt,
    from: { number: fromNum, name: fromName },
    to:   { number: toNum, name: toName },
    extension: ext,
    duration,
    status,
    direction,
    hasRecording: hasRec,
    recordingFile: recFile,
    // رابط داخلي آمن لتنزيل التسجيل عبر بروكسي السيرفر (لا يكشف توكن السنترال)
    recordingUrl: hasRec
      ? `/api/cdr/recording?${recFile ? `recording_file=${encodeURIComponent(recFile)}` : `call_id=${encodeURIComponent(id)}`}`
      : null,
    raw: undefined, // لا نُرجع البيانات الخام للمستخدم
  };
}

// GET /api/cdr
router.get("/", async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  }
  const p = parsed.data;
  try {
    // مرجع Yeastar P-Series: GET /openapi/v1.0/cdr/list
    const data = await yeastarFetch("/openapi/v1.0/cdr/list", {
      query: {
        page: p.page,
        page_size: p.page_size,
        start_time: p.start_time,
        end_time: p.end_time,
        sort_by: "time",
        order_by: "desc",
        search_value: p.search,
        call_status: p.call_status,
      },
    });
    const list = data?.data || data?.cdr_list || data?.list || [];
    const total = data?.total_number ?? data?.total ?? list.length;
    res.json({
      page: p.page,
      pageSize: p.page_size,
      total,
      items: list.map(normalizeRow),
    });
  } catch (err) {
    console.error("[cdr/list]", err.message);
    res.status(502).json({ error: "yeastar_unreachable", message: err.message });
  }
});

// GET /api/cdr/recording — بث ملف التسجيل عبر السيرفر (بروكسي)
const recSchema = z.object({
  call_id:        z.string().trim().min(1).max(128).optional(),
  recording_file: z.string().trim().min(1).max(512).optional(),
}).refine((d) => d.call_id || d.recording_file, "call_id أو recording_file مطلوب");

router.get("/recording", async (req, res) => {
  const parsed = recSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const { call_id, recording_file } = parsed.data;

  try {
    const { token, baseUrl } = await getYeastarToken();
    const u = new URL(`${baseUrl}/openapi/v1.0/cdr/recording/download`);
    u.searchParams.set("access_token", token);
    if (call_id) u.searchParams.set("call_id", call_id);
    if (recording_file) u.searchParams.set("recording_file", recording_file);

    const r = await fetch(u.toString());
    if (!r.ok || !r.body) {
      const txt = await r.text().catch(() => "");
      return res.status(502).json({ error: "recording_unavailable", status: r.status, message: txt.slice(0, 300) });
    }
    res.setHeader("Content-Type", r.headers.get("content-type") || "audio/wav");
    const cd = r.headers.get("content-disposition");
    if (cd) res.setHeader("Content-Disposition", cd);
    const len = r.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    // Stream
    const reader = r.body.getReader();
    res.on("close", () => { try { reader.cancel(); } catch {} });
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error("[cdr/recording]", err.message);
    if (!res.headersSent) res.status(502).json({ error: "yeastar_unreachable", message: err.message });
  }
});

export default router;
