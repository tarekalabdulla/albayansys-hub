// ============================================================
// إعدادات بيئة التشغيل — يتصل بـ backend الحقيقي على VPS
// ============================================================
// اضبط في ملف .env بجذر المشروع قبل البناء (npm run build):
//   VITE_API_URL=https://api.yourdomain.com
//
// USE_REAL_API يبقى true دائماً — تم إزالة وضع mock نهائياً.
// ============================================================

export const USE_REAL_API = true;

export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:4000";

// تنبيه واضح في الكونسول وقت التشغيل
// eslint-disable-next-line no-console
console.info(`[config] API URL: ${API_URL}`);
