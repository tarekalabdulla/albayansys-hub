// ============================================================
// إعدادات بيئة التشغيل — التبديل بين Mock و Real API
// ============================================================
// إذا VITE_USE_REAL_API="true" → يتصل بـ VPS الحقيقي
// خلاف ذلك → يستخدم mockData/mockSocket كما هو الحال الآن
//
// لتفعيل API الحقيقي، أنشئ ملف .env في جذر المشروع يحتوي:
//   VITE_USE_REAL_API=true
//   VITE_API_URL=https://api.hulul-albayan.com
// ============================================================

export const USE_REAL_API =
  (import.meta.env.VITE_USE_REAL_API ?? "").toString().toLowerCase() === "true";

export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:4000";

if (USE_REAL_API) {
  // تنبيه واضح في الكونسول وقت التشغيل
  // eslint-disable-next-line no-console
  console.info(`[config] استخدام API حقيقي: ${API_URL}`);
}
