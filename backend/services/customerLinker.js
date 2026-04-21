// ============================================================================
// customerLinker — تطبيع الأرقام + ربط المكالمات بالعملاء/المطالبات
// ============================================================================
import { query } from "../db/pool.js";

/**
 * Normalize a phone number for fuzzy matching.
 *  - يُزيل المسافات والشرطات والأقواس
 *  - يُحوّل +966 / 00966 → 966
 *  - يُبقي آخر 9-10 أرقام كمفتاح بحث (لتجاوز اختلاف بادئة الدولة)
 */
export function normalizePhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d+]/g, "").replace(/^\+/, "").replace(/^00/, "");
  // ابقِ آخر 10 أرقام (يكفي لمعظم بلدان المنطقة)
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * يبحث عن عميل برقم الهاتف (أصلي أو بديل) بعد normalization.
 * يعيد { customer, claim } أو null.
 */
export async function findCustomerByPhone(phoneRaw) {
  const norm = normalizePhone(phoneRaw);
  if (!norm) return null;

  // 1) ابحث في customers.phone_normalized
  const { rows: cs } = await query(
    `SELECT id, name, customer_type, phone, alt_phone
     FROM customers
     WHERE phone_normalized = $1
        OR RIGHT(REGEXP_REPLACE(COALESCE(alt_phone,''), '[^0-9]', '', 'g'), 10) = $1
     LIMIT 1`,
    [norm]
  );
  if (cs.length === 0) return null;
  const customer = cs[0];

  // 2) أحضر آخر مطالبة مفتوحة لهذا العميل
  const { rows: cls } = await query(
    `SELECT id, claim_number, status, title
     FROM claims
     WHERE customer_id = $1 AND status = 'open'
     ORDER BY opened_at DESC
     LIMIT 1`,
    [customer.id]
  );
  return { customer, claim: cls[0] || null };
}
