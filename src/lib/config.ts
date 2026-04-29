// ============================================================
// إعدادات بيئة التشغيل — API حقيقي فقط (لا يوجد وضع Mock)
// ============================================================
// عنوان الـ API:
//   - VITE_API_URL إن وُجد (مثلاً https://api.hulul-albayan.com)
//   - وإلا يُستنتج من النطاق الحالي: https://api.<host>
//   - localhost → http://localhost:4000
// ============================================================

const envApiUrl = import.meta.env.VITE_API_URL as string | undefined;

function inferApiUrl(): string {
  if (envApiUrl) return envApiUrl;
  if (typeof window === "undefined") return "http://localhost:4000";
  const host = window.location.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "localhost" || host === "127.0.0.1") return "http://localhost:4000";
  // داخل preview الـ Lovable: نسمح للمستخدم بضبط VITE_API_URL يدوياً
  if (host.endsWith(".lovable.app") || host.endsWith(".lovableproject.com")) {
    return envApiUrl || "http://localhost:4000";
  }
  return `https://api.${host}`;
}

// ⚠️ نُبقي ثابت USE_REAL_API لأن أكواد كثيرة تستورده — لكنه دائماً true الآن.
export const USE_REAL_API = true;
export const API_URL = inferApiUrl();

if (typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.info(`[config] api=${API_URL} host=${window.location.hostname}`);
}
