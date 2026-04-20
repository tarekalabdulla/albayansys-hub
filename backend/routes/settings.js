import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authRequired);

// أسرار حساسة لا تُرسل للعميل أبداً
const SECRET_KEYS = new Set([
  "pbx_p_series.apiSecret",
  "pbx_s_series.amiSecret",
  "google_ai.apiKey",
  "webhook.secret",
]);

function stripSecrets(key, value) {
  if (!value || typeof value !== "object") return value;
  const out = { ...value };
  for (const sk of SECRET_KEYS) {
    const [k, field] = sk.split(".");
    if (k === key && field in out) {
      out[`${field}IsSet`] = !!out[field];
      delete out[field];
    }
  }
  return out;
}

// GET /api/settings — كل الإعدادات (بدون أسرار)
router.get("/", requireRole("admin"), async (_req, res) => {
  const { rows } = await query(`SELECT key, value FROM system_settings`);
  const obj = {};
  for (const r of rows) obj[r.key] = stripSecrets(r.key, r.value);
  res.json({ settings: obj });
});

// GET /api/settings/:key
router.get("/:key", requireRole("admin"), async (req, res) => {
  const { rows } = await query(`SELECT value FROM system_settings WHERE key = $1`, [req.params.key]);
  if (!rows[0]) return res.status(404).json({ error: "not_found" });
  res.json({ value: stripSecrets(req.params.key, rows[0].value) });
});

// PUT /api/settings/:key — حفظ كائن JSON كامل
const valueSchema = z.record(z.any());

router.put("/:key", requireRole("admin"), async (req, res) => {
  const parsed = valueSchema.safeParse(req.body?.value ?? req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  // ادمج مع القيمة الحالية بحيث لا تُمسح الأسرار غير المُرسَلة
  const { rows: existing } = await query(`SELECT value FROM system_settings WHERE key = $1`, [req.params.key]);
  const merged = { ...(existing[0]?.value || {}), ...parsed.data };

  const { rows } = await query(
    `INSERT INTO system_settings (key, value, updated_by)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by
     RETURNING value`,
    [req.params.key, JSON.stringify(merged), req.user.sub]
  );
  res.json({ value: stripSecrets(req.params.key, rows[0].value) });
});

export default router;
