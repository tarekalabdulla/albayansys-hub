// ============================================================
// إعدادات بيئة التشغيل — التبديل بين Mock و Real API
// ============================================================
// منطق التفعيل (بالأولوية):
//   1) VITE_USE_REAL_API="true"  → API حقيقي (يتجاوز كل شيء)
//   2) VITE_USE_REAL_API="false" → Mock (يتجاوز الاستنتاج التلقائي)
//   3) لو غير مضبوط:
//      - النطاق ينتهي بـ .lovable.app أو localhost → Mock
//      - أي نطاق آخر (مثل hulul-albayan.com)       → Real API تلقائياً
//
// عنوان الـ API:
//   - VITE_API_URL إن وُجد
//   - وإلا: https://api.<النطاق الحالي بدون www>
// ============================================================

const envFlag = (import.meta.env.VITE_USE_REAL_API ?? "").toString().toLowerCase();
const envApiUrl = import.meta.env.VITE_API_URL as string | undefined;

function inferUseRealApi(): boolean {
  if (envFlag === "true")  return true;
  if (envFlag === "false") return false;
  // استنتاج تلقائي من hostname
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return false;
  if (host.endsWith(".lovable.app") || host.endsWith(".lovableproject.com")) return false;
  return true; // أي نطاق مخصص → API حقيقي
}

function inferApiUrl(): string {
  if (envApiUrl) return envApiUrl;
  if (typeof window === "undefined") return "http://localhost:4000";
  const host = window.location.hostname.replace(/^www\./, "");
  return `https://api.${host}`;
}

export const USE_REAL_API = inferUseRealApi();
export const API_URL = USE_REAL_API ? inferApiUrl() : "http://localhost:4000";

if (typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.info(
    `[config] mode=${USE_REAL_API ? "REAL" : "MOCK"} api=${API_URL} host=${window.location.hostname}`
  );
}
