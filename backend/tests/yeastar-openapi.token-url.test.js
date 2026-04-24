// ============================================================================
// integration test — Yeastar OpenAPI get_token URL is always sanitized
// ----------------------------------------------------------------------------
// نتأكد أن fetchToken() (داخل startYeastarOpenApi) يستدعي fetch بـ:
//     `${origin}/openapi/v1.0/get_token`
// مهما كانت قيمة baseUrl القادمة من runtimeConfig (حتى لو ملوّثة بـ
// webhook URL أو path آخر).
//
// نُموَك:
//   - ../services/runtimeConfig.js  → نتحكم بـ getEffectiveConfigSync/getConfigSource
//                                      ونستخدم sanitizeBaseUrl الحقيقي (regression guard)
//   - ../routes/webhooks-yeastar.js → handleNormalizedEvent مُموَّك (لتفادي تحميل DB/Express)
//   - ws                             → WebSocket مُموَّك (لا اتصال شبكي)
//   - global.fetch                   → نلتقط URL ونعيد رد get_token صالح
// ============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------- المُموَكات ----------
// 1) handleNormalizedEvent — نقطع التبعية على routes (وبالتالي على DB)
vi.mock("../routes/webhooks-yeastar.js", () => ({
  handleNormalizedEvent: vi.fn(async () => {}),
}));

// 2) ws — لا نريد فتح WebSocket فعلياً. نُرجع كائناً يحاكي EventEmitter
vi.mock("ws", () => {
  class FakeWS {
    constructor() {
      this.readyState = 0; // CONNECTING
      this._handlers = {};
    }
    on(ev, fn)   { (this._handlers[ev] ||= []).push(fn); return this; }
    once(ev, fn) { return this.on(ev, fn); }
    send()       { /* noop */ }
    ping()       { /* noop */ }
    close()      { this.readyState = 3; }
  }
  FakeWS.OPEN = 1;
  FakeWS.CLOSED = 3;
  return { default: FakeWS };
});

// 3) runtimeConfig — قابل للتحكم من كل اختبار. نُبقي sanitizeBaseUrl الحقيقي
//    بحيث نتأكد أن الـ defense-in-depth داخل yeastar-openapi.js يعمل.
const runtimeMock = vi.hoisted(() => ({
  getEffectiveConfigSync: vi.fn(),
  getConfigSource:        vi.fn(),
  sanitizeBaseUrl:        null, // سنحقن الحقيقي بعد الاستيراد
}));

vi.mock("../services/runtimeConfig.js", async () => {
  // استورد الحقيقي فقط للحصول على sanitizeBaseUrl، ثم اخلطه مع الـ mocks
  const actual = await vi.importActual("../services/runtimeConfig.js");
  runtimeMock.sanitizeBaseUrl = actual.sanitizeBaseUrl;
  return {
    ...actual,
    getEffectiveConfigSync: runtimeMock.getEffectiveConfigSync,
    getConfigSource:        runtimeMock.getConfigSource,
    // sanitizeBaseUrl نُبقيه الحقيقي
    sanitizeBaseUrl:        actual.sanitizeBaseUrl,
  };
});

// ---------- استيراد الـ system under test بعد إعداد كل المُموَكات ----------
const { startYeastarOpenApi, stopYeastarOpenApi, getYeastarApiStatus } =
  await import("../realtime/yeastar-openapi.js");

// ---------- Helpers ----------
const EXPECTED_ORIGIN = "https://hululalbayan.ras.yeastar.com";
const EXPECTED_TOKEN_URL = `${EXPECTED_ORIGIN}/openapi/v1.0/get_token`;

function makeFetchSpy() {
  return vi.fn(async (url /* , opts */) => ({
    ok: true,
    status: 200,
    json: async () => ({
      access_token:  "AT-test-12345",
      refresh_token: "RT-test-12345",
      expire_time:   1800,
    }),
  }));
}

// ============================================================================
// Test cases — كل قيمة baseUrl يجب أن تُنظّف لـ EXPECTED_ORIGIN قبل الاستدعاء
// ============================================================================
const POLLUTED_BASE_URLS = [
  // (label, raw value coming from "DB" via runtimeConfig)
  ["origin نظيف",
    "https://hululalbayan.ras.yeastar.com"],
  ["origin مع slash نهائي",
    "https://hululalbayan.ras.yeastar.com/"],
  ["origin + path /openapi/v1.0/get_token",
    "https://hululalbayan.ras.yeastar.com/openapi/v1.0/get_token"],
  ["origin + path /openapi",
    "https://hululalbayan.ras.yeastar.com/openapi"],
  ["origin + slashes متعددة في النهاية",
    "https://hululalbayan.ras.yeastar.com//"],
  ["origin بدون بروتوكول (يُضاف https تلقائياً)",
    "hululalbayan.ras.yeastar.com"],
];

describe("yeastar-openapi: get_token URL sanitization (integration)", () => {
  let fetchSpy;
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchSpy = makeFetchSpy();
    global.fetch = fetchSpy;

    runtimeMock.getConfigSource.mockReturnValue({
      baseUrl: "db",
      webhookPath: "db",
    });
  });

  afterEach(() => {
    stopYeastarOpenApi();
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  for (const [label, rawBaseUrl] of POLLUTED_BASE_URLS) {
    it(`يستدعي get_token على ${EXPECTED_TOKEN_URL} عندما baseUrl="${label}"`, async () => {
      runtimeMock.getEffectiveConfigSync.mockReturnValue({
        baseUrl:      rawBaseUrl,
        clientId:     "CID-test-XYZ",
        clientSecret: "CSEC-test-very-secret-1234",
      });

      const fakeIo = { emit: vi.fn(), to: vi.fn().mockReturnThis() };
      await startYeastarOpenApi(fakeIo);

      // أول استدعاء fetch يجب أن يكون get_token
      expect(fetchSpy).toHaveBeenCalled();
      const [calledUrl, calledOpts] = fetchSpy.mock.calls[0];

      expect(calledUrl).toBe(EXPECTED_TOKEN_URL);
      expect(calledOpts).toMatchObject({ method: "POST" });

      // payload OAuth فقط — لا username/password
      const body = JSON.parse(calledOpts.body);
      expect(body).toEqual({
        client_id:     "CID-test-XYZ",
        client_secret: "CSEC-test-very-secret-1234",
      });
      expect(body).not.toHaveProperty("username");
      expect(body).not.toHaveProperty("password");

      // Status snapshot يعكس الـ origin النظيف
      const status = getYeastarApiStatus();
      expect(status.baseUrl).toBe(EXPECTED_ORIGIN);
      expect(status.configured).toBe(true);
      expect(status.authMode).toBe("oauth");
    });
  }

  // -------- حالات يجب أن ترفض ولا تطلق fetch --------
  it("يرفض baseUrl الذي يبدو وكأنه webhook URL ولا يطلق get_token", async () => {
    runtimeMock.getEffectiveConfigSync.mockReturnValue({
      baseUrl:
        "https://api.hulul-albayan.com/api/yeastar/webhook/call-event/{TOKEN}",
      clientId:     "CID-test",
      clientSecret: "CSEC-test",
    });

    await startYeastarOpenApi({ emit: vi.fn() });

    // sanitizeBaseUrl يُرجع "" → cfg().base فارغ → start يطبع DISABLED
    // ولا يُستدعى fetch إطلاقاً.
    expect(fetchSpy).not.toHaveBeenCalled();
    const status = getYeastarApiStatus();
    expect(status.configured).toBe(false);
    expect(status.baseUrl).toBeFalsy();
  });

  it("يرفض غياب client_secret ولا يُرسل أي طلب OAuth", async () => {
    runtimeMock.getEffectiveConfigSync.mockReturnValue({
      baseUrl:      EXPECTED_ORIGIN,
      clientId:     "CID-only",
      clientSecret: "", // مفقود
    });

    await startYeastarOpenApi({ emit: vi.fn() });

    expect(fetchSpy).not.toHaveBeenCalled();
    const status = getYeastarApiStatus();
    expect(status.configured).toBe(false);
    expect(status.authMode).toBe("none");
  });

  // -------- حارس انحدار صريح: المسار حرفياً --------
  it("المسار المُلحق بـ origin هو /openapi/v1.0/get_token حرفياً (لا /api/yeastar ولا webhook)", async () => {
    runtimeMock.getEffectiveConfigSync.mockReturnValue({
      baseUrl:      EXPECTED_ORIGIN + "/openapi/v1.0/get_token", // ملوّث
      clientId:     "CID",
      clientSecret: "CSEC",
    });

    await startYeastarOpenApi({ emit: vi.fn() });

    const calledUrl = fetchSpy.mock.calls[0][0];

    // إيجابي
    expect(calledUrl).toBe(EXPECTED_TOKEN_URL);
    expect(calledUrl.endsWith("/openapi/v1.0/get_token")).toBe(true);

    // سلبي — لا تلوّث
    expect(calledUrl).not.toMatch(/\/api\/yeastar/i);
    expect(calledUrl).not.toMatch(/\/webhook/i);
    expect(calledUrl).not.toMatch(/\/call-event/i);
    expect(calledUrl).not.toMatch(/\{TOKEN\}/);
    expect(calledUrl).not.toMatch(/%7BTOKEN%7D/i);

    // ولا يحتوي مسار get_token مكرّراً
    const occurrences = (calledUrl.match(/\/openapi\/v1\.0\/get_token/g) || []).length;
    expect(occurrences).toBe(1);
  });
});
