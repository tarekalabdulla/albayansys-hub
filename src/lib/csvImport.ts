// أدوات استيراد/تصدير CSV — مع دعم العربية (BOM) والعلامة "
// لا يعتمد على مكتبات خارجية

export type CsvRow = Record<string, string>;

/** parser CSV بسيط يدعم: علامات اقتباس مزدوجة، فواصل مهرّبة، أسطر داخل الحقول. */
export function parseCSV(text: string): CsvRow[] {
  // أزل BOM إن وُجد
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else { field += c; }
    }
  }
  // آخر حقل/سطر
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  const out: CsvRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const line = rows[r];
    // تجاهل الأسطر الفارغة كلياً
    if (line.length === 1 && line[0].trim() === "") continue;
    const obj: CsvRow = {};
    headers.forEach((h, idx) => {
      obj[h] = (line[idx] ?? "").trim();
    });
    out.push(obj);
  }
  return out;
}

/** يحوّل صفوف الكائنات إلى نص CSV، مع BOM لدعم Excel العربية. */
export function rowsToCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  const cols = headers ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => escape(r[c])).join(","));
  return "\uFEFF" + lines.join("\n");
}

/** نزّل ملفاً نصياً في المتصفح. */
export function downloadFile(filename: string, content: string, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** اقرأ ملفاً نصياً من <input type="file" />. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

// ============================================================
// قوالب جاهزة
// ============================================================

export const USERS_TEMPLATE_HEADERS = [
  "name", "email", "password", "role", "active", "phone", "department", "ext",
];

export const USERS_TEMPLATE_SAMPLE: Record<string, string>[] = [
  { name: "أحمد العتيبي", email: "ahmad@example.com", password: "Hulul@1234", role: "agent", active: "true", phone: "0500000000", department: "خدمة العملاء", ext: "2101" },
  { name: "فاطمة الزهراء", email: "fatima@example.com", password: "Hulul@1234", role: "supervisor", active: "true", phone: "0500000001", department: "خدمة العملاء", ext: "2102" },
];

export const RECORDINGS_TEMPLATE_HEADERS = [
  "agentName", "customerNumber", "duration", "audioUrl",
  "qualityScore", "sentiment", "category", "tags", "summary", "recordedAt",
];

export const RECORDINGS_TEMPLATE_SAMPLE: Record<string, string>[] = [
  {
    agentName: "أحمد العتيبي",
    customerNumber: "+966500000000",
    duration: "180",
    audioUrl: "https://example.com/rec1.mp3",
    qualityScore: "88",
    sentiment: "positive",
    category: "استفسار",
    tags: "تم الحل;VIP",
    summary: "استفسار العميل عن الفاتورة وتم توضيح السبب.",
    recordedAt: "2025-04-18 09:30",
  },
];
