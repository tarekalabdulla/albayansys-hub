// ============================================================================
// /api/yeastar — إعدادات Yeastar PBX + زر Sync الموحّد
// ----------------------------------------------------------------------------
// يوفّر:
//   GET  /api/yeastar/config        — الإعدادات الحالية (بدون أسرار)
//   PUT  /api/yeastar/config        — تحديث (مدير فقط)
//   POST /api/yeastar/sync          — التحديث الشامل (admin only):
//                                     1) تجديد access token
//                                     2) اختبار اتصال webhook (self-call)
//                                     3) سحب آخر 100 مكالمة من Yeastar API
//                                     4) إعادة تحميل حالة التكاملات
//                                     5) تخزين تقرير المزامنة في DB
//   GET  /api/yeastar/sync/history  — آخر 20 مزامنة
//
// أمن:
//   - أسرار (clientSecret/webhookSecret) لا تخرج للواجهة أبداً
//   - التخزين في system_settings تحت المفتاح "yeastar_pbx"
//   - فقط admin يستطيع التعديل والمزامنة
// ============================================================================
import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { getYeastarApiStatus } from "../realtime/yeastar-openapi.js";
import { getAmiStatus } from "../services/amiService.js";
import { getWebhookStatus } from "./webhooks-yeastar.js";
import {
  invalidateConfig,
  sanitizeBaseUrl,
  sanitizeWebhookPath,
} from "../services/runtimeConfig.js";

const router = Router();
router.use(authRequired);

const SETTINGS_KEY = "yeastar_pbx";
const HISTORY_KEY  = "yeastar_sync_history";

// -------------------- Helpers --------------------
const SECRET_FIELDS = new Set(["clientSecret", "webhookSecret", "amiPassword"]);

function stripSecrets(obj) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_FIELDS.has(k)) {
      out[`${k}IsSet`] = Boolean(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function loadConfig() {
  const { rows } = await query(`SELECT value FROM system_settings WHERE key = $1`, [SETTINGS_KEY]);
  return rows[0]?.value || {};
}

async function saveConfig(value, userId) {
  // ادمج مع القيمة الحالية كي لا تُمسح الأسرار غير المُرسَلة
  const current = await loadConfig();
  // إذا أُرسل سرّ فارغ "" فاحتفظ بالقديم
  for (const f of SECRET_FIELDS) {
    if (f in value && (value[f] === "" || value[f] == null)) delete value[f];
  }
  const merged = { ...current, ...value };
  await query(
    `INSERT INTO system_settings (key, value, updated_by)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by`,
    [SETTINGS_KEY, JSON.stringify(merged), userId]
  );
  return merged;
}

async function loadHistory() {
  const { rows } = await query(`SELECT value FROM system_settings WHERE key = $1`, [HISTORY_KEY]);
  return Array.isArray(rows[0]?.value?.items) ? rows[0].value.items : [];
}

async function pushHistory(entry, userId) {
  const items = await loadHistory();
  items.unshift(entry);
  const trimmed = items.slice(0, 20);
  await query(
    `INSERT INTO system_settings (key, value, updated_by)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by`,
    [HISTORY_KEY, JSON.stringify({ items: trimmed }), userId]
  );
}

// -------------------- GET /config --------------------
router.get("/config", requireRole("admin"), async (_req, res) => {
  try {
    const cfg = await loadConfig();
    const lastSync = (await loadHistory())[0] || null;
    res.json({
      config: stripSecrets(cfg),
      env: {
        // مصدر الحقيقة عند البدء — من .env (للعرض فقط)
        baseUrl:  process.env.YEASTAR_BASE_URL || process.env.YEASTAR_API_BASE || null,
        clientIdSet: Boolean(process.env.YEASTAR_CLIENT_ID),
        clientSecretSet: Boolean(process.env.YEASTAR_CLIENT_SECRET),
        webhookTokenSet: Boolean(process.env.YEASTAR_WEBHOOK_TOKEN),
        webhookSecretSet: Boolean(process.env.YEASTAR_WEBHOOK_SECRET),
        webhookPath: process.env.YEASTAR_WEBHOOK_PATH || null,
        allowedIps: (process.env.YEASTAR_ALLOWED_IPS || "")
          .split(",").map((s) => s.trim()).filter(Boolean),
      },
      status: {
        webhook: getWebhookStatus(),
        openapi: getYeastarApiStatus(),
        ami:     getAmiStatus(),
      },
      lastSync,
    });
  } catch (e) {
    console.error("[yeastar/config:get]", e);
    res.status(500).json({ error: "load_failed", message: e.message });
  }
});

// -------------------- PUT /config --------------------
const configSchema = z.object({
  pbxIp:          z.string().trim().max(255).optional(),
  baseUrl:        z.string().trim().max(255).optional(),
  clientId:       z.string().trim().max(255).optional(),
  clientSecret:   z.string().trim().max(512).optional(),
  webhookSecret:  z.string().trim().max(512).optional(),
  webhookPath:    z.string().trim().max(255).optional(),
  allowedIps:     z.array(z.string().trim().max(64)).max(20).optional(),
  enabled:        z.boolean().optional(),
  // Phase 1 additions — toggles لكل قناة + إعدادات AMI
  enableWebhook:  z.boolean().optional(),
  enableOpenAPI:  z.boolean().optional(),
  enableAMI:      z.boolean().optional(),
  amiHost:        z.string().trim().max(255).optional(),
  amiPort:        z.number().int().min(1).max(65535).optional(),
  amiUsername:    z.string().trim().max(128).optional(),
  amiPassword:    z.string().trim().max(512).optional(),
  // داخلياً للحفظ بعد المزامنة (لا يأتي من الواجهة عادة)
  lastSyncAt:     z.string().optional(),
  lastSyncOk:     z.boolean().optional(),
}).strict();

router.put("/config", requireRole("admin"), async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  // ⚠️  fix 2026-04 (B): تعقيم صارم قبل الحفظ في DB
  // - baseUrl يجب أن يكون origin فقط (https://host[:port])
  // - webhookPath يجب أن يكون pathname فقط (يبدأ بـ /)
  // أي قيمة ملوّثة (webhook URL في خانة Base URL، أو origin في خانة webhookPath)
  // تُرفض هنا قبل ضربها في DB.
  const data = { ...parsed.data };
  const warnings = [];

  if (typeof data.baseUrl === "string" && data.baseUrl.trim()) {
    const cleaned = sanitizeBaseUrl(data.baseUrl);
    if (!cleaned) {
      return res.status(400).json({
        error: "invalid_base_url",
        message:
          `قيمة Base URL مرفوضة: تبدو وكأنها webhook URL أو مسار. ` +
          `يجب أن تكون origin فقط (مثل https://pbx.example.com) — بدون /openapi ` +
          `وبدون /api/yeastar وبدون {TOKEN}.`,
        received: data.baseUrl.slice(0, 200),
      });
    }
    if (cleaned !== data.baseUrl.trim().replace(/\/+$/, "")) {
      warnings.push(`baseUrl تم تنظيفه: "${data.baseUrl}" → "${cleaned}"`);
    }
    data.baseUrl = cleaned;
  }

  if (typeof data.webhookPath === "string" && data.webhookPath.trim()) {
    const cleaned = sanitizeWebhookPath(data.webhookPath);
    if (!cleaned) {
      return res.status(400).json({
        error: "invalid_webhook_path",
        message: `Webhook Path يجب أن يبدأ بـ / ويحوي مسار URL آمن (مثل /api/yeastar/webhook/call-event/{TOKEN}).`,
        received: data.webhookPath.slice(0, 200),
      });
    }
    // تحقّق أن المسار مكوّن من أحرف URL آمنة (سمحنا أيضاً بـ {TOKEN} placeholder)
    if (!/^\/[A-Za-z0-9/_\-{}.:%]*$/.test(cleaned)) {
      return res.status(400).json({
        error: "invalid_webhook_path",
        message: `Webhook Path يحتوي أحرفاً غير مسموحة. المسموح: A-Z a-z 0-9 / _ - { } . :`,
        received: cleaned,
      });
    }
    if (cleaned !== data.webhookPath.trim()) {
      warnings.push(`webhookPath تم تنظيفه: "${data.webhookPath}" → "${cleaned}"`);
    }
    data.webhookPath = cleaned;
  }

  if (warnings.length) {
    console.warn("[yeastar/config:put] sanitization warnings:", warnings.join(" | "));
  }

  try {
    const merged = await saveConfig(data, req.user.sub);
    // طبّق الإعدادات الجديدة فوراً على كل الخدمات (Webhook + AMI + ...)
    // subscribeConfig listeners ستتولى إعادة تشغيل AMI تلقائياً.
    await invalidateConfig();
    console.log(
      `[yeastar/config:put] saved by user=${req.user.sub}`,
      `baseUrl="${merged.baseUrl || "(empty)"}"`,
      `webhookPath="${merged.webhookPath || "(empty)"}"`,
    );
    res.json({ ok: true, config: stripSecrets(merged), applied: true, warnings });
  } catch (e) {
    console.error("[yeastar/config:put]", e);
    res.status(500).json({ error: "save_failed", message: e.message });
  }
});

// ============================================================================
// POST /sync — العملية الموحّدة
// ============================================================================
const DEFAULT_WEBHOOK_PATH = "/api/yeastar/webhook/call-event/{TOKEN}";

// ⚠️  fix 2026-04 (B): الفصل التام بين baseUrl (OpenAPI) و webhookPath
//   - baseUrl       = origin فقط؛ يُلحَق به /openapi/v1.0/* داخل الكود فقط
//   - webhookPath   = pathname فقط؛ يُلحَق به origin طلب HTTP المحلي عند self-test
//   - أي تلوّث (مثل لصق webhook URL في خانة Base URL من الواجهة) يُعقَّم هنا
//     كطبقة دفاع أخيرة، حتى لو فلت من PUT /config.
function getEffective(cfg) {
  const rawBase = cfg.baseUrl || process.env.YEASTAR_BASE_URL || process.env.YEASTAR_API_BASE || "";
  const baseUrl = sanitizeBaseUrl(rawBase);
  const baseSource = cfg.baseUrl ? "db" : (rawBase ? "env" : "none");
  if (rawBase && baseUrl !== rawBase.replace(/\/+$/, "")) {
    console.warn(
      `[yeastar/getEffective] baseUrl was sanitized: raw="${rawBase}" → clean="${baseUrl}" (source=${baseSource})`
    );
  }

  const rawWebhookPath = cfg.webhookPath || process.env.YEASTAR_WEBHOOK_PATH || DEFAULT_WEBHOOK_PATH;
  const webhookPath = sanitizeWebhookPath(rawWebhookPath) || DEFAULT_WEBHOOK_PATH;
  const webhookPathSource = cfg.webhookPath ? "db" : (process.env.YEASTAR_WEBHOOK_PATH ? "env" : "default");

  return {
    baseUrl,
    baseSource,
    clientId:      cfg.clientId      || process.env.YEASTAR_CLIENT_ID || "",
    clientSecret:  cfg.clientSecret  || process.env.YEASTAR_CLIENT_SECRET || "",
    webhookToken:  process.env.YEASTAR_WEBHOOK_TOKEN || "",
    webhookSecret: cfg.webhookSecret || process.env.YEASTAR_WEBHOOK_SECRET || "",
    webhookPath,
    webhookPathSource,
  };
}

function maskSecret(s) {
  if (!s || typeof s !== "string") return "(empty)";
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-2)} (len=${s.length})`;
}

// OAuth حصراً — Yeastar P-Series Open API لا يقبل username/password.
// payload: { client_id, client_secret }
// ⚠️  baseUrl هنا يجب أن يكون origin فقط (مُعقَّم سابقاً). المسار ثابت في الكود.
async function fetchAccessToken(baseUrl, clientId, clientSecret, timeoutMs = 15_000) {
  const url = `${baseUrl}/openapi/v1.0/get_token`;
  console.log(
    "[yeastar/sync] get_token →", url,
    `(base="${baseUrl}")`,
    "auth=oauth",
    "client_id=" + maskSecret(clientId),
    "client_secret=" + maskSecret(clientSecret),
    `timeout=${timeoutMs}ms`,
  );
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    const token = data.access_token || data.data?.access_token;
    console.log(
      `[yeastar/sync] get_token response http=${r.status}`,
      `errcode=${data.errcode ?? "-"}`,
      `errmsg="${data.errmsg ?? ""}"`,
      `hasToken=${Boolean(token)}`,
    );
    if (r.ok && token) {
      return { ok: true, token, expiresIn: data.expire_time || data.data?.expire_time || 1800 };
    }
    return { ok: false, error: `errcode=${data.errcode ?? r.status} ${data.errmsg || ""}`.trim() };
  } catch (e) {
    const reason = e.name === "AbortError" ? `timeout_${timeoutMs}ms` : e.message;
    return { ok: false, error: reason };
  } finally {
    clearTimeout(tm);
  }
}

async function fetchRecentCdr(baseUrl, token, limit, timeoutMs = 15_000) {
  // Yeastar P-Series Open API — endpoint استرجاع CDR
  // يستخدم POST /openapi/v1.0/cdr/list مع access_token query
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `${baseUrl}/openapi/v1.0/cdr/list?access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: 1, page_size: Math.min(limit, 100), sort_by: "time", order_by: "desc" }),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || (data.errcode && data.errcode !== 0)) {
      return { ok: false, error: `errcode=${data.errcode ?? r.status} ${data.errmsg || ""}`.trim() };
    }
    const list = data.cdr_list || data.data || data.list || [];
    return { ok: true, list: Array.isArray(list) ? list : [] };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(tm);
  }
}

async function upsertCdrRow(c) {
  // اخترْ مفتاحاً موحّداً للتفرّد
  const callId = (c.call_id || c.uniqueid || c.linkedid || `${c.time}-${c.caller_num}-${c.callee_num}`).toString().slice(0, 128);
  const linkedid = (c.linkedid || c.call_id || "").toString().slice(0, 64);
  const ext = (c.callee_num || c.member_num || c.extension || "").toString().slice(0, 32);
  const remote = (c.caller_num || c.from_num || c.remote_number || "").toString().slice(0, 64);
  const direction = (c.call_type === "1" || /out/i.test(c.direction || "")) ? "outgoing"
                   : (c.call_type === "2" || /in/i.test(c.direction || "")) ? "incoming"
                   : "unknown";
  const status = /answer/i.test(c.status || "") ? "answered"
               : /no.?answer|missed/i.test(c.status || "") ? "no_answer"
               : /busy/i.test(c.status || "") ? "busy"
               : "completed";
  const answered = /answer/i.test(c.status || "") || parseInt(c.talk_duration || c.billsec || 0, 10) > 0;
  const dur = parseInt(c.duration || c.call_duration || 0, 10) || 0;
  const talk = parseInt(c.talk_duration || c.billsec || 0, 10) || 0;
  const startedAt = c.time ? new Date(c.time) : new Date();

  try {
    await query(
      `INSERT INTO pbx_call_logs
        (call_unique_key, linkedid, ext, remote_number, remote_number_norm,
         direction, status_last, answered, started_at, duration_seconds, talk_seconds,
         source_of_truth, raw_final_payload)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, 'api', $11::jsonb)
       ON CONFLICT (call_unique_key) DO UPDATE SET
         status_last = EXCLUDED.status_last,
         answered    = EXCLUDED.answered,
         duration_seconds = GREATEST(pbx_call_logs.duration_seconds, EXCLUDED.duration_seconds),
         talk_seconds     = GREATEST(pbx_call_logs.talk_seconds,    EXCLUDED.talk_seconds),
         raw_final_payload = EXCLUDED.raw_final_payload,
         updated_at  = NOW()`,
      [callId, linkedid || null, ext || null, remote || null, direction, status, answered, startedAt, dur, talk, JSON.stringify(c)]
    );
    return true;
  } catch (e) {
    console.warn("[yeastar/sync] upsertCdrRow failed:", e.message);
    return false;
  }
}

async function selfTestWebhook(baseUrlReq, token, secret, pathTemplate, timeoutMs = 30_000) {
  if (!token) return { ok: false, status: "disabled", error: "YEASTAR_WEBHOOK_TOKEN غير مضبوط" };
  const tpl = (pathTemplate || DEFAULT_WEBHOOK_PATH).trim();
  // استبدل {TOKEN} أو ألحقه إذا لم يكن موجوداً
  const pathWithToken = tpl.includes("{TOKEN}")
    ? tpl.replace("{TOKEN}", encodeURIComponent(token))
    : `${tpl.replace(/\/+$/, "")}/${encodeURIComponent(token)}`;
  const url = `${baseUrlReq}${pathWithToken.startsWith("/") ? "" : "/"}${pathWithToken}`;
  const body = JSON.stringify({
    type: 30012,
    msg: { call_id: `SYNC-${Date.now()}`, caller_num: "0", callee_num: "0", call_status: "test", _self_test: true },
  });
  const headers = { "Content-Type": "application/json" };
  if (secret) {
    headers["X-Yeastar-Signature"] = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  }
  console.log(
    `[yeastar/sync] webhook self-test → ${url}`,
    `secret=${secret ? maskSecret(secret) : "(none)"}`,
    `timeout=${timeoutMs}ms`,
  );
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
    if (r.ok) return { ok: true, status: "endpoint_reachable", url, httpStatus: r.status };
    if (r.status === 401) return { ok: false, status: "invalid_signature", url, httpStatus: 401, error: `HMAC mismatch (HTTP 401) — السرّ المُرسَل لا يطابق إعداد الخادم` };
    if (r.status === 403) return { ok: false, status: "rejected_request", url, httpStatus: 403, error: `IP غير مسموح (HTTP 403)` };
    if (r.status === 503) return { ok: false, status: "rejected_request", url, httpStatus: 503, error: `Webhook معطّل من لوحة التحكم (HTTP 503)` };
    return { ok: false, status: "rejected_request", url, httpStatus: r.status, error: `HTTP ${r.status} (${url})` };
  } catch (e) {
    if (e.name === "AbortError") {
      return { ok: false, status: "no_callback_received", url, error: `timeout_${timeoutMs}ms — لم تُستقبل استجابة من ${url}` };
    }
    return { ok: false, status: "endpoint_unreachable", url, error: `${e.message} (${url})` };
  } finally {
    clearTimeout(tm);
  }
}

router.post("/sync", requireRole("admin"), async (req, res) => {
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const cfg = await loadConfig();
  const eff = getEffective(cfg);

  const report = {
    startedAt,
    finishedAt: null,
    durationMs: 0,
    ok: true,
    by: req.user.identifier || req.user.sub,
    steps: {
      token:    { ok: false, message: "" },
      webhook:  { ok: false, message: "" },
      cdr:      { ok: false, message: "", fetched: 0, upserted: 0 },
      services: { ok: false, message: "" },
    },
  };

  // ---- 1) Token
  if (!eff.baseUrl || !eff.clientId || !eff.clientSecret) {
    report.steps.token = { ok: false, message: "بيانات الاعتماد غير مكتملة (baseUrl/clientId/clientSecret)" };
  } else {
    const t = await fetchAccessToken(eff.baseUrl, eff.clientId, eff.clientSecret);
    report.steps.token = t.ok
      ? { ok: true,  message: `access_token صالح لـ ${t.expiresIn}s`, expiresIn: t.expiresIn }
      : { ok: false, message: t.error || "فشل get_token" };
  }

  // ---- 2) Webhook self-test
  const baseReq = `${req.protocol}://${req.get("host") || `127.0.0.1:${process.env.PORT || 4000}`}`;
  const w = await selfTestWebhook(baseReq, eff.webhookToken, eff.webhookSecret, eff.webhookPath);
  report.steps.webhook = w.ok
    ? { ok: true,  message: `Webhook استقبل الاختبار من ${w.url}` }
    : { ok: false, message: w.error || "فشل اختبار webhook" };

  // ---- 3) CDR pull (يعتمد على نجاح خطوة token)
  if (report.steps.token.ok) {
    // أعد طلب التوكن للحصول على القيمة (لا نخزّنها هنا)
    const t = await fetchAccessToken(eff.baseUrl, eff.clientId, eff.clientSecret);
    if (t.ok) {
      const cdr = await fetchRecentCdr(eff.baseUrl, t.token, 100);
      if (cdr.ok) {
        let upserted = 0;
        for (const row of cdr.list) {
          if (await upsertCdrRow(row)) upserted += 1;
        }
        report.steps.cdr = {
          ok: true,
          message: `تم سحب ${cdr.list.length} وحفظ ${upserted}`,
          fetched: cdr.list.length,
          upserted,
        };
      } else {
        report.steps.cdr = { ok: false, message: cdr.error || "فشل cdr/list", fetched: 0, upserted: 0 };
      }
    } else {
      report.steps.cdr = { ok: false, message: "تعذّر تجديد التوكن للسحب", fetched: 0, upserted: 0 };
    }
  } else {
    report.steps.cdr = { ok: false, message: "تخطّيت — التوكن غير متاح", fetched: 0, upserted: 0 };
  }

  // ---- 4) Services snapshot
  try {
    const wh = getWebhookStatus();
    const oa = getYeastarApiStatus();
    const ami = getAmiStatus();
    const allOff = !wh.tokenConfigured && !oa.configured && !ami.configured;
    report.steps.services = allOff
      ? { ok: false, message: "كل القنوات معطّلة في .env" }
      : { ok: true,  message: `webhook=${wh.totalEvents} ev | openapi=${["CONNECTING","OPEN","CLOSING","CLOSED"][oa.wsState] || "OFF"} | ami=${ami.loggedIn ? "logged_in" : "off"}` };
  } catch (e) {
    report.steps.services = { ok: false, message: e.message };
  }

  // ---- خاتمة
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - t0;
  report.ok = report.steps.token.ok && report.steps.webhook.ok && report.steps.cdr.ok;

  // خزّن التقرير + حدّث lastSyncAt في config
  try {
    await pushHistory(report, req.user.sub);
    await saveConfig({ lastSyncAt: report.finishedAt, lastSyncOk: report.ok }, req.user.sub);
  } catch (e) {
    console.warn("[yeastar/sync] history persist failed:", e.message);
  }

  res.json({ report });
});

// -------------------- POST /sync/test --------------------
// اختبار الاتصال فقط (Token + CDR) دون حفظ — يستقبل بيانات الاعتماد في الـ body
// أو يعود إلى المخزّنة في DB / .env إن لم تُرسَل.
const testSchema = z.object({
  baseUrl:      z.string().trim().max(255).optional(),
  clientId:     z.string().trim().max(255).optional(),
  clientSecret: z.string().trim().max(512).optional(),
}).strict();

router.post("/sync/test", requireRole("admin"), async (req, res) => {
  const parsed = testSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  }
  const t0 = Date.now();
  try {
    const cfg = await loadConfig();
    const eff = getEffective(cfg);
    const baseUrl      = (parsed.data.baseUrl?.trim() || eff.baseUrl || "").replace(/\/+$/, "");
    const clientId     = parsed.data.clientId?.trim()     || eff.clientId;
    const clientSecret = parsed.data.clientSecret?.trim() || eff.clientSecret;

    const result = {
      durationMs: 0,
      baseUrl,
      token: { ok: false, message: "", expiresIn: 0, tokenPreview: "" },
      cdr:   { ok: false, message: "", fetched: 0, sample: [] },
    };

    if (!baseUrl || !clientId || !clientSecret) {
      result.token.message = "بيانات الاعتماد غير مكتملة (baseUrl/clientId/clientSecret)";
      result.cdr.message = "تخطّيت — التوكن غير متاح";
      result.durationMs = Date.now() - t0;
      return res.json({ result });
    }

    const t = await fetchAccessToken(baseUrl, clientId, clientSecret);
    if (!t.ok) {
      result.token = { ok: false, message: t.error || "فشل get_token", expiresIn: 0, tokenPreview: "" };
      result.cdr.message = "تخطّيت — التوكن غير متاح";
      result.durationMs = Date.now() - t0;
      return res.json({ result });
    }
    result.token = {
      ok: true,
      message: `access_token صالح لـ ${t.expiresIn}s`,
      expiresIn: t.expiresIn,
      tokenPreview: `${t.token.slice(0, 8)}…${t.token.slice(-4)}`,
    };

    const cdr = await fetchRecentCdr(baseUrl, t.token, 5);
    if (!cdr.ok) {
      result.cdr = { ok: false, message: cdr.error || "فشل cdr/list", fetched: 0, sample: [] };
    } else {
      const sample = (cdr.list || []).slice(0, 5).map((c) => ({
        time:      c.time || c.call_time || null,
        caller:    c.caller_num || c.from_num || "",
        callee:    c.callee_num || c.member_num || c.extension || "",
        duration:  parseInt(c.duration || c.call_duration || 0, 10) || 0,
        talk:      parseInt(c.talk_duration || c.billsec || 0, 10) || 0,
        status:    c.status || c.call_status || "",
        direction: c.direction || (c.call_type === "1" ? "outbound" : c.call_type === "2" ? "inbound" : ""),
      }));
      result.cdr = {
        ok: true,
        message: `تم سحب ${cdr.list.length} سجل CDR من Yeastar`,
        fetched: cdr.list.length,
        sample,
      };
    }
    result.durationMs = Date.now() - t0;
    res.json({ result });
  } catch (e) {
    console.error("[yeastar/sync/test]", e);
    res.status(500).json({ error: "test_failed", message: e.message });
  }
});

// -------------------- GET /sync/history --------------------
router.get("/sync/history", requireRole("admin"), async (_req, res) => {
  try {
    const items = await loadHistory();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: "load_failed", message: e.message });
  }
});

// -------------------- GET /sync/trend --------------------
// إجمالي المكالمات المزامنة (المُدخَلة في pbx_call_logs) آخر 7 أيام
router.get("/sync/trend", requireRole("admin"), async (_req, res) => {
  try {
    const { rows } = await query(
      `WITH days AS (
         SELECT generate_series(
           (CURRENT_DATE - INTERVAL '6 days')::date,
           CURRENT_DATE::date,
           INTERVAL '1 day'
         )::date AS day
       )
       SELECT
         to_char(d.day, 'YYYY-MM-DD') AS day,
         COALESCE(COUNT(p.id), 0)::int AS total
       FROM days d
       LEFT JOIN pbx_call_logs p
         ON DATE(p.created_at) = d.day
       GROUP BY d.day
       ORDER BY d.day ASC`
    );
    res.json({ items: rows });
  } catch (e) {
    console.error("[yeastar/sync/trend]", e);
    res.status(500).json({ error: "load_failed", message: e.message });
  }
});

export default router;
