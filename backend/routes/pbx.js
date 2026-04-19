// إعدادات السنترال Yeastar P-Series (Open API) + Webhook للأحداث الحية
import { Router } from "express";
import express from "express";
import { z } from "zod";
import https from "node:https";
import crypto from "node:crypto";
import { query } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { handleYeastarWebhook } from "../lib/yeastarWebhook.js";

const router = Router();

// ============ Webhook عام (بدون auth — مؤمَّن بـ HMAC) ============
// نستخدم raw body parser لحفظ نفس البايتات للتحقق من التوقيع
router.post(
  "/webhook",
  express.raw({ type: "*/*", limit: "1mb" }),
  (req, _res, next) => {
    req.rawBody = req.body; // Buffer
    try { req.body = JSON.parse(req.body.toString("utf8") || "{}"); }
    catch { req.body = {}; }
    next();
  },
  handleYeastarWebhook,
);

// ============ كل ما تحت يحتاج admin ============
router.use(authRequired, requireRole("admin"));

const SAFE_FIELDS = `
  id, enabled, host, port, use_tls, api_username, webhook_url,
  last_test_at, last_test_ok, last_test_msg, last_event_at, updated_at, updated_by
`;

// رجّع الإعدادات بدون السر — مع علامة has_secret / has_webhook_secret
async function loadSafe() {
  const { rows } = await query(
    `SELECT ${SAFE_FIELDS},
            (api_secret_enc IS NOT NULL) AS has_secret,
            (webhook_secret_enc IS NOT NULL) AS has_webhook_secret
     FROM pbx_settings WHERE id = 1`
  );
  return rows[0] || null;
}

// GET /api/pbx — اقرأ الإعدادات الحالية
router.get("/", async (_req, res) => {
  const data = await loadSafe();
  res.json({ settings: data });
});

// PUT /api/pbx — حدّث الإعدادات
const updateSchema = z.object({
  enabled:      z.boolean().optional(),
  host:         z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.\-_]+$/, "host غير صالح").optional().or(z.literal("")),
  port:         z.coerce.number().int().min(1).max(65535).optional(),
  use_tls:      z.boolean().optional(),
  api_username: z.string().trim().max(128).optional().or(z.literal("")),
  api_secret:   z.string().min(1).max(256).optional(), // فقط لو يريد التغيير
  clear_secret: z.boolean().optional(),                 // لمسح السر
  webhook_url:  z.string().trim().max(2048).url().refine((u) => u.startsWith("https://"), "https فقط").optional().or(z.literal("")),
});

router.put("/", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  }
  const d = parsed.data;
  const fields = [];
  const values = [];
  let i = 1;

  const set = (col, val) => { fields.push(`${col} = $${i++}`); values.push(val); };

  if (d.enabled !== undefined)      set("enabled", d.enabled);
  if (d.host !== undefined)         set("host", d.host || null);
  if (d.port !== undefined)         set("port", d.port);
  if (d.use_tls !== undefined)      set("use_tls", d.use_tls);
  if (d.api_username !== undefined) set("api_username", d.api_username || null);
  if (d.webhook_url !== undefined)  set("webhook_url", d.webhook_url || null);

  if (d.clear_secret) {
    set("api_secret_enc", null);
  } else if (d.api_secret) {
    try {
      set("api_secret_enc", encryptSecret(d.api_secret));
    } catch (e) {
      return res.status(500).json({ error: "encryption_unavailable", message: e.message });
    }
  }

  // updated_by
  set("updated_by", req.user.sub);

  if (fields.length === 1) { // فقط updated_by
    return res.status(400).json({ error: "no_fields" });
  }

  await query(`UPDATE pbx_settings SET ${fields.join(", ")} WHERE id = 1`, values);
  const data = await loadSafe();
  res.json({ settings: data });
});

// POST /api/pbx/test — اختبار اتصال فعلي مع Yeastar P-Series Open API
// المرجع: POST /openapi/v1.0/get_token  body: { username, password }
const testSchema = z.object({
  // إذا أرسل المستخدم بيانات مؤقتة (لم تُحفظ بعد)، استخدمها بدلاً من DB
  host:         z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.\-_]+$/).optional(),
  port:         z.coerce.number().int().min(1).max(65535).optional(),
  use_tls:      z.boolean().optional(),
  api_username: z.string().trim().max(128).optional(),
  api_secret:   z.string().min(1).max(256).optional(),
});

router.post("/test", async (req, res) => {
  const parsed = testSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  // ادمج المُرسل مع المخزّن
  const { rows } = await query(
    `SELECT host, port, use_tls, api_username, api_secret_enc FROM pbx_settings WHERE id = 1`
  );
  const stored = rows[0] || {};
  const host    = parsed.data.host         ?? stored.host;
  const port    = parsed.data.port         ?? stored.port ?? 8088;
  const useTls  = parsed.data.use_tls      ?? stored.use_tls ?? true;
  const user    = parsed.data.api_username ?? stored.api_username;
  const secret  = parsed.data.api_secret   ?? decryptSecret(stored.api_secret_enc);

  if (!host || !user || !secret) {
    return res.status(400).json({ ok: false, error: "missing_credentials", message: "host/api_username/api_secret مطلوبة" });
  }

  const proto = useTls ? "https" : "http";
  const url = `${proto}://${host}:${port}/openapi/v1.0/get_token`;
  const body = JSON.stringify({ username: user, password: secret });

  // اسمح بشهادة self-signed لأن أجهزة PBX عادة تستخدم شهادة محلية
  const agent = useTls ? new https.Agent({ rejectUnauthorized: false }) : undefined;

  const start = Date.now();
  let ok = false;
  let msg = "";
  let status = 0;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      // @ts-ignore — agent يُمرَّر عبر undici
      dispatcher: undefined,
      // node-fetch / undici لا يقبل agent — نعتمد على عدم تحقق TLS عبر env
      // (ضع NODE_TLS_REJECT_UNAUTHORIZED=0 لو احتجت)
    }).catch((e) => { throw e; });

    status = r.status;
    const data = await r.json().catch(() => ({}));
    if (r.ok && (data?.errcode === 0 || data?.access_token || data?.data?.access_token)) {
      ok = true;
      msg = "تم الاتصال بنجاح وأُصدر التوكن";
    } else {
      msg = data?.errmsg || data?.message || `HTTP ${status}`;
    }
  } catch (err) {
    msg = err?.message || "فشل الاتصال";
  }

  const elapsed = Date.now() - start;

  // حدّث آخر اختبار (لو الإعدادات محفوظة)
  await query(
    `UPDATE pbx_settings SET last_test_at = NOW(), last_test_ok = $1, last_test_msg = $2 WHERE id = 1`,
    [ok, msg.slice(0, 500)]
  );

  res.status(ok ? 200 : 502).json({ ok, status, message: msg, elapsed_ms: elapsed });
});

export default router;
