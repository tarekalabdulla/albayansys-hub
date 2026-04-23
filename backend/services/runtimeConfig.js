// ============================================================================
// runtimeConfig — مصدر حقيقة موحَّد لإعدادات Yeastar
// ----------------------------------------------------------------------------
// يدمج بين:
//   * system_settings.value WHERE key='yeastar_pbx'  (من DB — الأولوية)
//   * process.env.YEASTAR_*                          (افتراضي/fallback)
//
// مزايا:
//   - cache في الذاكرة لمدة 30 ثانية (لتفادي ضرب DB في كل event)
//   - دالة invalidate() لمسح الـ cache فوراً بعد PUT /config
//   - listeners (subscribe) ليُعاد تشغيل الخدمات (مثل AMI) عند التغيير
//   - يعمل graceful: إذا فشل الاتصال بـ DB يعود إلى .env فقط
//
// لا يحتفظ بالأسرار خارج الذاكرة، ولا يكتب أي شيء في DB.
// ============================================================================
import { query } from "../db/pool.js";

const SETTINGS_KEY = "yeastar_pbx";
const CACHE_TTL_MS = 30_000;

let cache = {
  value: null,        // الإعدادات المدمجة الفعّالة (DB ∪ env)
  loadedAt: 0,
  loading: null,      // Promise قيد التحميل (لمنع تحميل متزامن مكرر)
};

const listeners = new Set();   // (cfg) => void  — تُستدعى بعد كل invalidate

function envDefaults() {
  return {
    // OpenAPI / OAuth
    baseUrl:        process.env.YEASTAR_BASE_URL || process.env.YEASTAR_API_BASE || "",
    clientId:       process.env.YEASTAR_CLIENT_ID || "",
    clientSecret:   process.env.YEASTAR_CLIENT_SECRET || "",

    // Webhook
    webhookToken:   process.env.YEASTAR_WEBHOOK_TOKEN || "",
    webhookSecret:  process.env.YEASTAR_WEBHOOK_SECRET || "",
    webhookPath:    process.env.YEASTAR_WEBHOOK_PATH || "",
    allowedIps:     (process.env.YEASTAR_ALLOWED_IPS || "")
                      .split(",").map((s) => s.trim()).filter(Boolean),

    // AMI
    amiHost:        process.env.YEASTAR_AMI_HOST || "",
    amiPort:        parseInt(process.env.YEASTAR_AMI_PORT || "5038", 10),
    amiUsername:    process.env.YEASTAR_AMI_USERNAME || "",
    amiPassword:    process.env.YEASTAR_AMI_PASSWORD || "",

    // Toggles (true بالافتراضي = الحفاظ على السلوك القديم)
    enableWebhook:  true,
    enableOpenAPI:  String(process.env.YEASTAR_OPENAPI_DISABLED || "").toLowerCase() !== "true",
    enableAMI:      Boolean(process.env.YEASTAR_AMI_HOST && process.env.YEASTAR_AMI_USERNAME),
  };
}

function mergeWithDb(env, db) {
  if (!db || typeof db !== "object") return env;
  const out = { ...env };
  // النصوص: DB يفوز إذا غير فارغ
  for (const k of [
    "baseUrl", "clientId", "clientSecret",
    "webhookSecret", "webhookPath",
    "amiHost", "amiUsername", "amiPassword",
  ]) {
    if (typeof db[k] === "string" && db[k].trim()) out[k] = db[k].trim();
  }
  // أرقام
  if (Number.isInteger(db.amiPort) && db.amiPort > 0) out.amiPort = db.amiPort;
  // مصفوفات: إذا أُرسلت في DB استعمَلها (حتى لو فارغة كقرار صريح)
  if (Array.isArray(db.allowedIps)) out.allowedIps = db.allowedIps.map((s) => s.trim()).filter(Boolean);
  // booleans: DB يفوز إذا مُحدَّد صراحة
  for (const k of ["enableWebhook", "enableOpenAPI", "enableAMI"]) {
    if (typeof db[k] === "boolean") out[k] = db[k];
  }
  return out;
}

async function loadFromDb() {
  try {
    const { rows } = await query(`SELECT value FROM system_settings WHERE key = $1`, [SETTINGS_KEY]);
    return rows[0]?.value || {};
  } catch (e) {
    console.warn("[runtimeConfig] DB load failed, falling back to .env:", e.message);
    return {};
  }
}

async function loadEffective() {
  const db = await loadFromDb();
  return mergeWithDb(envDefaults(), db);
}

// ----------------------------------------------------------------------------
// واجهة عامة
// ----------------------------------------------------------------------------

/** يُرجع الإعدادات الفعّالة (مع cache 30s). */
export async function getEffectiveConfig() {
  const now = Date.now();
  if (cache.value && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.value;
  }
  if (cache.loading) return cache.loading;
  cache.loading = (async () => {
    try {
      const v = await loadEffective();
      cache.value = v;
      cache.loadedAt = Date.now();
      return v;
    } finally {
      cache.loading = null;
    }
  })();
  return cache.loading;
}

/**
 * نسخة sync — تُرجع آخر قيمة محمّلة (أو .env فقط إذا لم تُحمّل DB بعد).
 * مفيد في hot-paths مثل التحقق من IP في كل webhook بدون انتظار async.
 */
export function getEffectiveConfigSync() {
  return cache.value || envDefaults();
}

/**
 * إبطال الـ cache + إعادة التحميل + إخطار المشتركين.
 * يُستدعى بعد كل PUT /api/yeastar/config.
 */
export async function invalidateConfig() {
  cache.value = null;
  cache.loadedAt = 0;
  const fresh = await getEffectiveConfig();
  for (const fn of listeners) {
    try { await fn(fresh); } catch (e) { console.error("[runtimeConfig] listener failed:", e.message); }
  }
  return fresh;
}

/** اشترك بالتغييرات (يعيد دالة لإلغاء الاشتراك). */
export function subscribeConfig(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** تحميل أوّلي عند الإقلاع (لتعبئة cache). */
export async function bootstrapConfig() {
  try {
    await getEffectiveConfig();
    console.log("[runtimeConfig] bootstrap OK (DB + .env merged)");
  } catch (e) {
    console.warn("[runtimeConfig] bootstrap failed:", e.message);
  }
}
