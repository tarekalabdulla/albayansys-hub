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
  updated?: number;
  skipped: number;
  errors: Array<{ row: number; reason: string; [k: string]: unknown }>;
}

export type DuplicateMode = "skip" | "update";

interface Props {
  /** نوع البيانات المستوردة (للعرض) */
  label: string;
  /** أسماء الأعمدة الإلزامية للتحقق قبل الإرسال */
  requiredHeaders: string[];
  /** دالة تستقبل المصفوفة وترسلها للـ backend */
  onImport: (rows: CsvRow[], opts: { duplicateMode: DuplicateMode }) => Promise<BulkResult>;
  /** بيانات قالب التنزيل */
  templateHeaders: string[];
  templateSample: Record<string, string>[];
  templateFileName: string;
  /** يُستدعى بعد نجاح الاستيراد لتحديث الواجهة */
  onSuccess?: () => void;
  className?: string;
  /** عرض زر تنزيل القالب بجانب الاستيراد */
  showTemplate?: boolean;
  /** السماح بسؤال المستخدم عن سلوك التكرار (افتراضياً: نعم لـ users) */
  askDuplicateMode?: boolean;
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
  askDuplicateMode = true,
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
    e.target.value = "";

    setBusy(true);
    try {
      const text = await readFileAsText(file);
      const rows = parseCSV(text);

      if (rows.length === 0) {
        Swal.fire({ icon: "warning", title: "ملف فارغ", text: "لا توجد صفوف بيانات في الملف." });
        return;
      }

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

      // اختيار سلوك التكرار
      let duplicateMode: DuplicateMode = "skip";
      if (askDuplicateMode) {
        const choice = await Swal.fire({
          icon: "question",
          title: `استيراد ${rows.length} ${label}`,
          html: `
            <div style="text-align:right;font-size:14px">
              ماذا نفعل عند وجود سجل مكرر (نفس البريد/المعرّف)؟
            </div>
          `,
          showCancelButton: true,
          showDenyButton: true,
          confirmButtonText: "🔄 تحديث الموجود",
          denyButtonText: "⏭️ تخطي المكرر",
          cancelButtonText: "إلغاء",
          confirmButtonColor: "hsl(174 72% 38%)",
          denyButtonColor: "hsl(220 14% 50%)",
          reverseButtons: true,
        });
        if (choice.isDismissed) return;
        duplicateMode = choice.isConfirmed ? "update" : "skip";
      } else {
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
      }

      const result = await onImport(rows, { duplicateMode });

      const errorPreview = result.errors.slice(0, 5).map((e: any) => {
        const reason = e.reason === "duplicate" ? "مكرر" : e.reason === "invalid" ? "غير صالح" : "خطأ";
        const fields = e.fields ? ` (${e.fields})` : "";
        return `صف ${e.row}: ${reason}${fields}`;
      }).join("<br/>");

      const updatedLine = (result.updated ?? 0) > 0
        ? `<br/>🔄 تم تحديث: <b>${result.updated}</b>`
        : "";

      await Swal.fire({
        icon: (result.created + (result.updated ?? 0)) > 0 ? "success" : "warning",
        title: `تم معالجة ${result.created + (result.updated ?? 0)} من ${rows.length}`,
        html: `
          <div style="text-align:right">
            ✅ تم إنشاء: <b>${result.created}</b>${updatedLine}<br/>
            ⏭️ تم تخطي: <b>${result.skipped}</b>
            ${errorPreview ? `<br/><br/><div style="font-size:12px;color:#888">${errorPreview}${result.errors.length > 5 ? `<br/>... +${result.errors.length - 5}` : ""}</div>` : ""}
          </div>
        `,
        confirmButtonColor: "hsl(174 72% 38%)",
      });

      if ((result.created + (result.updated ?? 0)) > 0) onSuccess?.();
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
