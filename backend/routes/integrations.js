import { Router } from "express";
import crypto from "crypto";
import net from "net";
import { verifyToken } from "../middleware/auth.js";
import { getYeastarApiStatus } from "../realtime/yeastar-openapi.js";
import { getAmiStatus } from "../services/amiService.js";
import { getWebhookStatus } from "./webhooks-yeastar.js";
import {
  getEffectiveConfigSync,
  getConfigSource,
  sanitizeBaseUrl,
  buildAuthPayloadShape,
} from "../services/runtimeConfig.js";

function maskSecret(s) {
  if (!s || typeof s !== "string") return "(empty)";
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-2)} (len=${s.length})`;
}

const router = Router();

// auth خفيف — admin/supervisor فقط
router.use((req, res, next) => {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : null;
  const payload = tok ? verifyToken(tok) : null;
  if (!payload) return res.status(401).json({ error: "unauthorized" });
  req.user = payload;
  next();
});

router.get("/status", (_req, res) => {
  const webhook = getWebhookStatus();
  const openapi = getYeastarApiStatus();
  const ami = getAmiStatus();

  const webhookStatus = !webhook.tokenConfigured && !webhook.secretConfigured
    ? "disabled"
    : webhook.lastEventAt
      ? (Date.now() - webhook.lastEventAt < 30 * 60_000 ? "connected" : "idle")
      : "idle";

  const openapiStatus = openapi.disabled
    ? "disabled"
    : !openapi.configured
      ? "disabled"
      : openapi.wsState === 1
        ? "connected"
        : "failed";

  const amiStatus = !ami.configured
    ? "disabled"
    : ami.connected && ami.loggedIn
      ? "connected"
      : "failed";

  res.json({
    serverTime: Date.now(),
    webhook: { ...webhook, status: webhookStatus },
    openapi: { ...openapi, status: openapiStatus },
    ami: { ...ami, status: amiStatus },
  });
});

// ============================================================================
// Webhook test — نعتبر النجاح عند رصد callback جديد فعليًا في telemetry
// ============================================================================
const WEBHOOK_TEST_TIMEOUT_MS = 30_000;

router.post("/test/webhook", async (req, res) => {
  const t0 = Date.now();
  const correlationId = `wh-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const live = getEffectiveConfigSync() || {};
  const token = process.env.YEASTAR_WEBHOOK_TOKEN || "";
  const secret = live.webhookSecret || process.env.YEASTAR_WEBHOOK_SECRET || "";

  const before = getWebhookStatus();
  const beforeEventAt = Number(before?.lastEventAt || 0);
  const beforeTotalEvents = Number(before?.totalEvents || 0);

  console.log(
    `[webhook-test] ▶ start id=${correlationId}`,
    `timeout=${WEBHOOK_TEST_TIMEOUT_MS}ms`,
    `token=${maskSecret(token)}`,
    `secret=${secret ? maskSecret(secret) : "(none)"}`,
    `lastEventAtBefore=${beforeEventAt || null}`,
    `totalEventsBefore=${beforeTotalEvents}`
  );

  if (!token) {
    console.warn(`[webhook-test] ✗ id=${correlationId} disabled — no YEASTAR_WEBHOOK_TOKEN`);
    return res.json({
      ok: false,
      status: "disabled",
      durationMs: Date.now() - t0,
      message: "YEASTAR_WEBHOOK_TOKEN غير مضبوط في .env — Webhook معطّل",
    });
  }

  const host = req.get("host") || `127.0.0.1:${process.env.PORT || 4000}`;
  const proto = req.protocol || "http";
  const url = `${proto}://${host}/api/yeastar/webhook/call-event/${encodeURIComponent(token)}`;

  const body = JSON.stringify({
    type: 30012,
    msg: {
      call_id: `TEST-${correlationId}`,
      caller_num: "0000000000",
      callee_num: "100",
      call_status: "test",
      duration: 0,
      _self_test: true,
      _correlation_id: correlationId,
    },
  });

  const headers = {
    "Content-Type": "application/json",
    "X-Correlation-Id": correlationId,
  };

  if (secret) {
    headers["X-Yeastar-Signature"] =
      "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  }

  console.log(`[webhook-test] → POST ${url} id=${correlationId} hmac=${secret ? "yes" : "no"}`);

  let postHttpStatus = null;
  let postBodyText = "";
  let endpointReachable = false;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: ctrl.signal,
    });

    clearTimeout(timer);
    postHttpStatus = r.status;
    endpointReachable = true;
    postBodyText = await r.text().catch(() => "");

    console.log(
      `[webhook-test] ← initial POST response id=${correlationId}`,
      `http=${r.status}`,
      `elapsed=${Date.now() - t0}ms`
    );

    if (r.status === 401) {
      return res.json({
        ok: false,
        status: "invalid_signature",
        httpStatus: 401,
        url,
        correlationId,
        durationMs: Date.now() - t0,
        message: secret
          ? "Webhook receiver يعمل لكن رفض التوقيع (HTTP 401). السر المرسل لا يطابق webhook secret."
          : "Webhook receiver يطلب توقيعًا ولم يتم إرسال secret صالح.",
      });
    }

    if (r.status === 403) {
      return res.json({
        ok: false,
        status: "rejected_request",
        httpStatus: 403,
        url,
        correlationId,
        durationMs: Date.now() - t0,
        message: "Webhook receiver يعمل لكن رفض الـ IP (HTTP 403). تحقق من allowedIps.",
      });
    }

    if (r.status === 503) {
      return res.json({
        ok: false,
        status: "rejected_request",
        httpStatus: 503,
        url,
        correlationId,
        durationMs: Date.now() - t0,
        message: "Webhook receiver يعمل لكن webhook معطّل من الإعدادات (HTTP 503).",
      });
    }

    if (!r.ok) {
      return res.json({
        ok: false,
        status: "rejected_request",
        httpStatus: r.status,
        url,
        correlationId,
        durationMs: Date.now() - t0,
        message: `Webhook receiver ردّ بـ HTTP ${r.status}: ${postBodyText.slice(0, 200)}`,
      });
    }
  } catch (e) {
    clearTimeout(timer);

    if (e.name === "AbortError") {
      console.warn(
        `[webhook-test] ⏱ initial POST timeout id=${correlationId}`,
        `elapsed=${Date.now() - t0}ms target=${url}`
      );
      return res.json({
        ok: false,
        status: "endpoint_unreachable",
        url,
        correlationId,
        durationMs: Date.now() - t0,
        message: "انتهت مهلة الوصول الأولي إلى endpoint قبل أي استجابة.",
      });
    }

    console.warn(
      `[webhook-test] ✗ initial POST unreachable id=${correlationId}`,
      `code=${e.code || "ERR"} msg="${e.message}"`
    );

    return res.json({
      ok: false,
      status: "endpoint_unreachable",
      url,
      correlationId,
      durationMs: Date.now() - t0,
      message: `تعذّر الوصول للـ endpoint (${e.code || "ERR"}): ${e.message}`,
    });
  }

  console.log(
    `[webhook-test] ⏱ waiting for telemetry delta… id=${correlationId} (≤${WEBHOOK_TEST_TIMEOUT_MS}ms)`
  );

  const waitStart = Date.now();

  while (Date.now() - waitStart < WEBHOOK_TEST_TIMEOUT_MS) {
    const current = getWebhookStatus();
    const currentEventAt = Number(current?.lastEventAt || 0);
    const currentTotalEvents = Number(current?.totalEvents || 0);

    const advancedByTime = currentEventAt > beforeEventAt;
    const advancedByCount = currentTotalEvents > beforeTotalEvents;

    if (advancedByTime || advancedByCount) {
      const elapsed = Date.now() - t0;

      console.log(
        `[webhook-test] ✓ callback observed id=${correlationId}`,
        `elapsed=${elapsed}ms`,
        `lastEventAt=${currentEventAt || null}`,
        `totalEvents=${currentTotalEvents}`
      );

      return res.json({
        ok: true,
        status: "receiver_active",
        httpStatus: postHttpStatus,
        url,
        correlationId,
        durationMs: elapsed,
        endpointReachable,
        lastEventAt: current.lastEventAt || null,
        lastEventFrom: current.lastEventFrom || null,
        lastEventType: current.lastEventType || null,
        totalEvents: current.totalEvents || 0,
        message: "Webhook receiver يعمل وتم رصد callback جديد فعليًا أثناء نافذة الاختبار.",
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const elapsed = Date.now() - t0;

  console.warn(
    `[webhook-test] ⏱ id=${correlationId} aborted status=no_callback_received`,
    `elapsed=${elapsed}ms target=${url}`,
    `endpointReachable=${endpointReachable}`,
    `postHttpStatus=${postHttpStatus}`
  );

  return res.json({
    ok: false,
    status: "no_callback_received",
    httpStatus: postHttpStatus,
    url,
    correlationId,
    durationMs: elapsed,
    endpointReachable,
    endpointBody: postBodyText.slice(0, 200),
    message:
      "وصلنا إلى endpoint بنجاح، لكن telemetry لم تسجل حدثًا جديدًا أثناء نافذة الاختبار. هذا يعني أن مشكلة التتبع داخل التطبيق ما زالت قائمة.",
  });
});

// ============================================================================
// OpenAPI test — client_credentials أولاً ثم fallback إلى basic_credentials
// ============================================================================
const OPENAPI_TEST_TIMEOUT_MS = 15_000;

async function postJsonWithTimeout(url, payload, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    return { ok: true, response: r, data };
  } catch (e) {
    return { ok: false, error: e };
  } finally {
    clearTimeout(timer);
  }
}

function buildBasicFallbackShape(live) {
  const username = live.apiUsername || process.env.YEASTAR_API_USER || live.clientId || process.env.YEASTAR_CLIENT_ID || "";
  const password = live.apiPassword || process.env.YEASTAR_API_PASS || live.clientSecret || process.env.YEASTAR_CLIENT_SECRET || "";

  const payload = { username, password };
  const fields = ["username", "password"];
  const missing = fields.filter((f) => !payload[f]);

  return {
    effectiveMode: "basic_credentials",
    fields,
    payload,
    missing,
  };
}

router.post("/test/openapi", async (_req, res) => {
  const t0 = Date.now();
  const live = getEffectiveConfigSync() || {};
  const src = getConfigSource() || { baseUrl: "none" };

  const rawBase = live.baseUrl || process.env.YEASTAR_BASE_URL || process.env.YEASTAR_API_BASE || "";
  const base = sanitizeBaseUrl(rawBase);
  const primaryShape = buildAuthPayloadShape(live);

  console.log(
    "[integrations/test/openapi] starting",
    `base="${base || "(empty)"}" (source=${src.baseUrl})`,
    rawBase && rawBase !== base ? `(raw was sanitized from "${rawBase.slice(0, 120)}")` : "",
    `authMode="${primaryShape.effectiveMode}"${primaryShape.explicit ? "" : " (inferred)"}`,
    `fields=[${primaryShape.fields.join(", ")}]`,
    `values={ ${primaryShape.fields.map((f) => `${f}=${maskSecret(primaryShape.payload[f])}`).join(", ")} }`
  );

  if (!base) {
    return res.json({
      ok: false,
      durationMs: Date.now() - t0,
      authMode: primaryShape.effectiveMode,
      message: rawBase
        ? `Base URL مرفوض بعد التعقيم — القيمة المخزنة "${rawBase.slice(0, 80)}…" تبدو وكأنها webhook URL أو مسار. ضع origin فقط مثل https://pbx.example.com`
        : "YEASTAR_BASE_URL غير مضبوط في الإعدادات/البيئة",
    });
  }

  const url = `${base}/openapi/v1.0/get_token`;

  // ========= المحاولة الأولى =========
  if (!primaryShape.missing.length) {
    const first = await postJsonWithTimeout(url, primaryShape.payload, OPENAPI_TEST_TIMEOUT_MS);

    if (!first.ok) {
      const reason = first.error.name === "AbortError"
        ? `انتهت المهلة بعد ${OPENAPI_TEST_TIMEOUT_MS}ms`
        : first.error.message;

      console.warn(`[integrations/test/openapi] network error: ${reason} endpoint="${url}"`);

      return res.json({
        ok: false,
        durationMs: Date.now() - t0,
        endpoint: url,
        baseUrl: base,
        baseUrlSource: src.baseUrl,
        authMode: primaryShape.effectiveMode,
        message: `تعذّر الوصول لـ ${base}: ${reason}`,
      });
    }

    const r = first.response;
    const data = first.data;

    console.log(
      `[integrations/test/openapi] response http=${r.status}`,
      `authMode="${primaryShape.effectiveMode}"`,
      `errcode=${data.errcode ?? "-"}`,
      `errmsg="${data.errmsg ?? ""}"`,
      `endpoint="${url}"`
    );

    const accessToken = data.access_token || data.data?.access_token;
    if (r.ok && (data.errcode === 0 || data.errcode === undefined) && accessToken) {
      return res.json({
        ok: true,
        durationMs: Date.now() - t0,
        endpoint: url,
        baseUrl: base,
        baseUrlSource: src.baseUrl,
        authMode: primaryShape.effectiveMode,
        authFields: primaryShape.fields,
        expiresIn: data.expire_time || data.data?.expire_time || 1800,
        message: `حصلنا على access_token من ${base} بنجاح (authMode=${primaryShape.effectiveMode}).`,
      });
    }

    // ========= fallback إذا 40002 =========
    if (Number(data.errcode) === 40002) {
      const fallbackShape = buildBasicFallbackShape(live);

      console.log(
        `[integrations/test/openapi] fallback from authMode="${primaryShape.effectiveMode}" to authMode="${fallbackShape.effectiveMode}"`,
        `fields=[${fallbackShape.fields.join(", ")}]`,
        `values={ ${fallbackShape.fields.map((f) => `${f}=${maskSecret(fallbackShape.payload[f])}`).join(", ")} }`
      );

      if (!fallbackShape.missing.length) {
        const second = await postJsonWithTimeout(url, fallbackShape.payload, OPENAPI_TEST_TIMEOUT_MS);

        if (!second.ok) {
          const reason = second.error.name === "AbortError"
            ? `انتهت المهلة بعد ${OPENAPI_TEST_TIMEOUT_MS}ms`
            : second.error.message;

          return res.json({
            ok: false,
            durationMs: Date.now() - t0,
            endpoint: url,
            baseUrl: base,
            baseUrlSource: src.baseUrl,
            authMode: fallbackShape.effectiveMode,
            authFields: fallbackShape.fields,
            message: `تعذّر الوصول لـ ${base} أثناء fallback: ${reason}`,
          });
        }

        const r2 = second.response;
        const data2 = second.data;

        console.log(
          `[integrations/test/openapi] fallback response http=${r2.status}`,
          `authMode="${fallbackShape.effectiveMode}"`,
          `errcode=${data2.errcode ?? "-"}`,
          `errmsg="${data2.errmsg ?? ""}"`,
          `endpoint="${url}"`
        );

        const fallbackToken = data2.access_token || data2.data?.access_token;
        if (r2.ok && (data2.errcode === 0 || data2.errcode === undefined) && fallbackToken) {
          return res.json({
            ok: true,
            durationMs: Date.now() - t0,
            endpoint: url,
            baseUrl: base,
            baseUrlSource: src.baseUrl,
            authMode: fallbackShape.effectiveMode,
            authFields: fallbackShape.fields,
            fallbackFrom: primaryShape.effectiveMode,
            expiresIn: data2.expire_time || data2.data?.expire_time || 1800,
            message: `حصلنا على access_token من ${base} بنجاح بعد fallback إلى ${fallbackShape.effectiveMode}.`,
          });
        }

        return res.json({
          ok: false,
          durationMs: Date.now() - t0,
          endpoint: url,
          baseUrl: base,
          baseUrlSource: src.baseUrl,
          authMode: fallbackShape.effectiveMode,
          authFields: fallbackShape.fields,
          fallbackFrom: primaryShape.effectiveMode,
          httpStatus: r2.status,
          errcode: data2.errcode ?? null,
          errmsg: data2.errmsg ?? null,
          message: `رفض PBX المصادقة حتى بعد fallback (authMode=${fallbackShape.effectiveMode}, fields=[${fallbackShape.fields.join(",")}]) errcode=${data2.errcode ?? r2.status} ${data2.errmsg || ""}`.trim(),
        });
      }
    }

    return res.json({
      ok: false,
      durationMs: Date.now() - t0,
      endpoint: url,
      baseUrl: base,
      baseUrlSource: src.baseUrl,
      authMode: primaryShape.effectiveMode,
      authFields: primaryShape.fields,
      httpStatus: r.status,
      errcode: data.errcode ?? null,
      errmsg: data.errmsg ?? null,
      message: `رفض PBX المصادقة (authMode=${primaryShape.effectiveMode}, fields=[${primaryShape.fields.join(",")}]) errcode=${data.errcode ?? r.status} ${data.errmsg || ""}`.trim(),
    });
  }

  // إذا الحقول الأساسية ناقصة، جرّب fallback basic مباشرة
  const fallbackShape = buildBasicFallbackShape(live);
  if (fallbackShape.missing.length) {
    return res.json({
      ok: false,
      durationMs: Date.now() - t0,
      authMode: fallbackShape.effectiveMode,
      authFields: fallbackShape.fields,
      message: `بيانات المصادقة ناقصة. الحقول الناقصة: ${fallbackShape.missing.join(", ")}`,
    });
  }

  const second = await postJsonWithTimeout(url, fallbackShape.payload, OPENAPI_TEST_TIMEOUT_MS);
  if (!second.ok) {
    const reason = second.error.name === "AbortError"
      ? `انتهت المهلة بعد ${OPENAPI_TEST_TIMEOUT_MS}ms`
      : second.error.message;

    return res.json({
      ok: false,
      durationMs: Date.now() - t0,
      endpoint: url,
      baseUrl: base,
      baseUrlSource: src.baseUrl,
      authMode: fallbackShape.effectiveMode,
      authFields: fallbackShape.fields,
      message: `تعذّر الوصول لـ ${base}: ${reason}`,
    });
  }

  const r2 = second.response;
  const data2 = second.data;
  const fallbackToken = data2.access_token || data2.data?.access_token;

  if (r2.ok && (data2.errcode === 0 || data2.errcode === undefined) && fallbackToken) {
    return res.json({
      ok: true,
      durationMs: Date.now() - t0,
      endpoint: url,
      baseUrl: base,
      baseUrlSource: src.baseUrl,
      authMode: fallbackShape.effectiveMode,
      authFields: fallbackShape.fields,
      expiresIn: data2.expire_time || data2.data?.expire_time || 1800,
      message: `حصلنا على access_token من ${base} بنجاح (authMode=${fallbackShape.effectiveMode}).`,
    });
  }

  return res.json({
    ok: false,
    durationMs: Date.now() - t0,
    endpoint: url,
    baseUrl: base,
    baseUrlSource: src.baseUrl,
    authMode: fallbackShape.effectiveMode,
    authFields: fallbackShape.fields,
    httpStatus: r2.status,
    errcode: data2.errcode ?? null,
    errmsg: data2.errmsg ?? null,
    message: `رفض PBX المصادقة (authMode=${fallbackShape.effectiveMode}, fields=[${fallbackShape.fields.join(",")}]) errcode=${data2.errcode ?? r2.status} ${data2.errmsg || ""}`.trim(),
  });
});

// ============================================================================
// AMI TCP test
// ============================================================================
router.post("/test/ami", async (_req, res) => {
  const t0 = Date.now();
  const live = getEffectiveConfigSync() || {};
  const host = live.amiHost || process.env.YEASTAR_AMI_HOST || "";
  const port = Number.isInteger(live.amiPort) && live.amiPort > 0
    ? live.amiPort
    : parseInt(process.env.YEASTAR_AMI_PORT || "5038", 10);

  if (!host) {
    return res.json({
      ok: false,
      durationMs: Date.now() - t0,
      message: "YEASTAR_AMI_HOST غير مضبوط (AMI معطّل)",
    });
  }

  const result = await new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;

    const finish = (ok, msg) => {
      if (!done) {
        done = true;
        try {
          sock.destroy();
        } catch {
          // noop
        }
        resolve({ ok, msg });
      }
    };

    sock.setTimeout(8000);
    sock.once("connect", () => finish(true, `TCP متصل بـ ${host}:${port}`));
    sock.once("timeout", () => finish(false, `انتهت المهلة عند الاتصال بـ ${host}:${port} (الـ VPS لا يصل للسنترال)`));
    sock.once("error", (e) => finish(false, `${e.code || "ERR"}: ${e.message}`));
    sock.connect(port, host);
  });

  res.json({
    ok: result.ok,
    durationMs: Date.now() - t0,
    message: result.msg,
  });
});

export default router;