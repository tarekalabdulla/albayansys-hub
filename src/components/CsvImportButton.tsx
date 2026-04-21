// زر استيراد CSV قابل لإعادة الاستخدام — يقرأ الملف، يفحصه، يستدعي bulk endpoint
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import Swal from "sweetalert2";
import {
  parseCSV,
  rowsToCsv,
  downloadFile,
  readFileAsText,
  type CsvRow,
} from "@/lib/csvImport";

export interface BulkResult {
  created: number;
  skipped: number;
  errors: Array<{ row: number; reason: string; [k: string]: unknown }>;
}

interface Props {
  /** نوع البيانات المستوردة (للعرض) */
  label: string;
  /** أسماء الأعمدة الإلزامية للتحقق قبل الإرسال */
  requiredHeaders: string[];
  /** دالة تستقبل المصفوفة وترسلها للـ backend */
  onImport: (rows: CsvRow[]) => Promise<BulkResult>;
  /** بيانات قالب التنزيل */
  templateHeaders: string[];
  templateSample: Record<string, string>[];
  templateFileName: string;
  /** يُستدعى بعد نجاح الاستيراد لتحديث الواجهة */
  onSuccess?: () => void;
  className?: string;
  /** عرض زر تنزيل القالب بجانب الاستيراد */
  showTemplate?: boolean;
}

export function CsvImportButton({
  label,
  requiredHeaders,
  onImport,
  templateHeaders,
  templateSample,
  templateFileName,
  onSuccess,
  className,
  showTemplate = true,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const downloadTemplate = () => {
    downloadFile(templateFileName, rowsToCsv(templateSample, templateHeaders));
  };

  const onPick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // إعادة الضبط للسماح بنفس الملف لاحقاً

    setBusy(true);
    try {
      const text = await readFileAsText(file);
      const rows = parseCSV(text);

      if (rows.length === 0) {
        Swal.fire({ icon: "warning", title: "ملف فارغ", text: "لا توجد صفوف بيانات في الملف." });
        return;
      }

      // تحقق من وجود الأعمدة الإلزامية
      const headers = Object.keys(rows[0] || {});
      const missing = requiredHeaders.filter((h) => !headers.includes(h));
      if (missing.length > 0) {
        Swal.fire({
          icon: "error",
          title: "أعمدة مفقودة",
          html: `الأعمدة التالية إلزامية ومفقودة:<br/><b dir="ltr">${missing.join(", ")}</b><br/><br/>نزّل القالب لمعرفة الترتيب الصحيح.`,
        });
        return;
      }

      // تأكيد قبل الإرسال
      const confirm = await Swal.fire({
        icon: "question",
        title: `استيراد ${rows.length} ${label}؟`,
        text: "سيتم إنشاء السجلات الجديدة وتجاهل المكررة.",
        showCancelButton: true,
        confirmButtonText: "متابعة",
        cancelButtonText: "إلغاء",
        confirmButtonColor: "hsl(174 72% 38%)",
      });
      if (!confirm.isConfirmed) return;

      const result = await onImport(rows);

      // عرض ملخص النتائج
      const errorPreview = result.errors.slice(0, 5).map((e) => {
        const reason = e.reason === "duplicate" ? "مكرر" : e.reason === "invalid" ? "غير صالح" : "خطأ";
        return `صف ${e.row}: ${reason}`;
      }).join("<br/>");

      await Swal.fire({
        icon: result.created > 0 ? "success" : "warning",
        title: `تم استيراد ${result.created} من ${rows.length}`,
        html: `
          <div style="text-align:right">
            ✅ تم إنشاء: <b>${result.created}</b><br/>
            ⏭️ تم تخطي: <b>${result.skipped}</b>
            ${errorPreview ? `<br/><br/><div style="font-size:12px;color:#888">${errorPreview}${result.errors.length > 5 ? `<br/>... +${result.errors.length - 5}` : ""}</div>` : ""}
          </div>
        `,
        confirmButtonColor: "hsl(174 72% 38%)",
      });

      if (result.created > 0) onSuccess?.();
    } catch (err: any) {
      Swal.fire({
        icon: "error",
        title: "فشل الاستيراد",
        text: err?.response?.data?.error || err?.message || "خطأ غير متوقع",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={onChange}
        className="hidden"
      />
      {showTemplate && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={downloadTemplate}
          disabled={busy}
          title="تنزيل قالب CSV نموذجي"
        >
          <Download className="w-4 h-4 ml-1.5" />
          قالب CSV
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onPick}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="w-4 h-4 ml-1.5 animate-spin" />
        ) : (
          <Upload className="w-4 h-4 ml-1.5" />
        )}
        استيراد CSV
      </Button>
    </div>
  );
}
