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
// ⚠️  فصل صارم بين الحقول (2026-04 fix):
//   * baseUrl       = origin فقط (https://host[:port])  — لا يحتوي على /openapi
//                     ولا /api/yeastar ولا webhook ولا {TOKEN}
//   * webhookPath   = pathname فقط (يبدأ بـ /)          — لا يحتوي على origin
//   * أي قيمة ملوّثة تُعقَّم تلقائياً قبل الاستخدام
//     (مثلاً المستخدم ألصق webhook URL كاملًا في خانة Base URL)
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
  source: { baseUrl: "none", webhookPath: "none" }, // من أين أتت كل قيمة
};

const listeners = new Set();   // (cfg) => void  — تُستدعى بعد كل invalidate

// ----------------------------------------------------------------------------
// عقَّامات (sanitizers) — تمنع تماماً خلط webhook URL مع OpenAPI baseUrl
// ----------------------------------------------------------------------------

/**
 * يُرجع origin فقط (https://host[:port]). يرفض أي مسار/استعلام/توكن.
 * أمثلة:
 *   "https://pbx.x.yeastar.com"                          → "https://pbx.x.yeastar.com"
 *   "https://pbx.x.yeastar.com/"                         → "https://pbx.x.yeastar.com"
 *   "https://pbx.x.yeastar.com/openapi/v1.0/get_token"   → "https://pbx.x.yeastar.com"  (وlog warning)
 *   "https://api.hulul-albayan.com/api/yeastar/webhook/..."→ ""  (مرفوض — هذا webhook URL)
 *   ""                                                   → ""
 */
export function sanitizeBaseUrl(raw) {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();
  if (!s) return "";

  // إذا لم يحتو على بروتوكول، أضف https
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;

  let u;
  try { u = new URL(s); }
  catch {
    console.warn(`[runtimeConfig] sanitizeBaseUrl: invalid URL "${raw.slice(0, 80)}", ignoring`);
    return "";
  }

  const path = (u.pathname || "/").replace(/\/+$/, "");
  const lower = path.toLowerCase();

  // كاشف صريح لـ webhook URL مُلصَق بالخطأ في حقل Base URL
  const looksLikeWebhook =
    lower.includes("/api/yeastar") ||
    lower.includes("/webhook")     ||
    lower.includes("/call-event")  ||
    s.includes("{TOKEN}")          ||
    s.includes("%7BTOKEN%7D");

  if (looksLikeWebhook) {
    console.warn(
      `[runtimeConfig] sanitizeBaseUrl: REJECTED webhook-looking value as Base URL ` +
      `("${raw.slice(0, 120)}") — Base URL يجب أن يكون origin فقط (مثل https://pbx.example.com). ` +
      `سأتجاهل هذه القيمة.`
    );
    return "";
  }

  // إذا كان فيه أي pathname آخر (مثل /openapi/v1.0/get_token)، نتجاهله ونحتفظ بالـ origin فقط
  if (path && path !== "" && path !== "/") {
    console.warn(
      `[runtimeConfig] sanitizeBaseUrl: stripped trailing path "${path}" from Base URL ` +
      `(use origin only). raw="${raw.slice(0, 120)}"`
    );
  }

  // origin = protocol + // + host (+ :port)
  return `${u.protocol}//${u.host}`;
}

/**
 * يُرجع pathname فقط يبدأ بـ /. يرفض أي origin أو بروتوكول.
 * أمثلة:
 *   "/api/yeastar/webhook/call-event/{TOKEN}"             → "/api/yeastar/webhook/call-event/{TOKEN}"
 *   "https://api.x.com/api/yeastar/webhook/call-event/{T}"→ "/api/yeastar/webhook/call-event/{T}" (وlog)
 *   "api/yeastar/webhook/call-event/{TOKEN}"              → "/api/yeastar/webhook/call-event/{TOKEN}"
 *   ""                                                    → ""
 */
export function sanitizeWebhookPath(raw) {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();
  if (!s) return "";

  // إذا أُرسل URL كامل، استخرج pathname فقط
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const stripped = (u.pathname || "/") + (u.search || "");
      console.warn(
        `[runtimeConfig] sanitizeWebhookPath: stripped origin from full URL ` +
        `("${raw.slice(0, 120)}") → "${stripped}"`
      );
      s = stripped;
    } catch {
      console.warn(`[runtimeConfig] sanitizeWebhookPath: invalid URL "${raw.slice(0, 80)}", ignoring`);
      return "";
    }
  }

  // ضمان البداية بـ /
  if (!s.startsWith("/")) s = "/" + s;
  // إزالة شرطات متكررة
  s = s.replace(/\/{2,}/g, "/");
  return s;
}

// ----------------------------------------------------------------------------
// قراءة من .env / DB ودمجهما
// ----------------------------------------------------------------------------

function envDefaults() {
  const rawBase = process.env.YEASTAR_BASE_URL || process.env.YEASTAR_API_BASE || "";
  return {
    // OpenAPI / OAuth
    baseUrl:        sanitizeBaseUrl(rawBase),
    clientId:       process.env.YEASTAR_CLIENT_ID || "",
    clientSecret:   process.env.YEASTAR_CLIENT_SECRET || "",

    // Webhook
    webhookToken:   process.env.YEASTAR_WEBHOOK_TOKEN || "",
    webhookSecret:  process.env.YEASTAR_WEBHOOK_SECRET || "",
    webhookPath:    sanitizeWebhookPath(process.env.YEASTAR_WEBHOOK_PATH || ""),
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
  // نتتبّع المصدر الفعلي لكل من baseUrl و webhookPath لأغراض التشخيص
  const source = { baseUrl: env.baseUrl ? "env" : "none", webhookPath: env.webhookPath ? "env" : "none" };

  if (!db || typeof db !== "object") {
    cache.source = source;
    return env;
  }

  const out = { ...env };

  // ----- baseUrl: يُعقَّم بصرامة قبل القبول
  if (typeof db.baseUrl === "string" && db.baseUrl.trim()) {
    const cleaned = sanitizeBaseUrl(db.baseUrl);
    if (cleaned) {
      out.baseUrl = cleaned;
      source.baseUrl = "db";
    } else {
      console.warn(
        `[runtimeConfig] DB baseUrl was rejected by sanitizer ("${db.baseUrl.slice(0, 120)}") — ` +
        `falling back to env value "${env.baseUrl || "(empty)"}"`
      );
      // نُبقي env كما هو
    }
  }

  // ----- webhookPath: يُعقَّم بصرامة قبل القبول
  if (typeof db.webhookPath === "string" && db.webhookPath.trim()) {
    const cleaned = sanitizeWebhookPath(db.webhookPath);
    if (cleaned) {
      out.webhookPath = cleaned;
      source.webhookPath = "db";
    } else {
      console.warn(
        `[runtimeConfig] DB webhookPath was rejected by sanitizer ("${db.webhookPath.slice(0, 120)}")`
      );
    }
  }

  // ----- بقية النصوص (لا تتأثر بالخلط مع OpenAPI base): DB يفوز إذا غير فارغ
  for (const k of [
    "clientId", "clientSecret",
    "webhookSecret",
    "amiHost", "amiUsername", "amiPassword",
  ]) {
    if (typeof db[k] === "string" && db[k].trim()) out[k] = db[k].trim();
  }

  // ----- أرقام
  if (Number.isInteger(db.amiPort) && db.amiPort > 0) out.amiPort = db.amiPort;

  // ----- مصفوفات
  if (Array.isArray(db.allowedIps)) {
    out.allowedIps = db.allowedIps.map((s) => s.trim()).filter(Boolean);
  }

  // ----- booleans
  for (const k of ["enableWebhook", "enableOpenAPI", "enableAMI"]) {
    if (typeof db[k] === "boolean") out[k] = db[k];
  }

  cache.source = source;
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
  const merged = mergeWithDb(envDefaults(), db);

  // log آمن — لا أسرار، فقط القيم البنيوية + المصدر
  console.log(
    `[runtimeConfig] effective Yeastar config:`,
    `baseUrl="${merged.baseUrl || "(empty)"}" (source=${cache.source.baseUrl})`,
    `webhookPath="${merged.webhookPath || "(empty)"}" (source=${cache.source.webhookPath})`,
    `clientIdSet=${Boolean(merged.clientId)}`,
    `clientSecretSet=${Boolean(merged.clientSecret)}`,
    `webhookSecretSet=${Boolean(merged.webhookSecret)}`,
    `enableOpenAPI=${merged.enableOpenAPI}`,
    `enableWebhook=${merged.enableWebhook}`,
    `enableAMI=${merged.enableAMI}`,
  );
  return merged;
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

/** المصدر الفعلي لـ baseUrl/webhookPath (للتشخيص في /status). */
export function getConfigSource() {
  return { ...cache.source };
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
