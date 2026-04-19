import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, Download, Play, RefreshCw, Loader2, AlertCircle, Phone, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { fetchCdr, buildAbsoluteRecordingUrl, type CdrItem } from "@/lib/cdrApi";
import { AudioPlayer } from "./AudioPlayer";
import { formatTime } from "@/lib/recordingsData";
import { tokenStorage } from "@/lib/api";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

function statusBadge(s: string) {
  const v = (s || "").toUpperCase();
  if (v.includes("ANSWER") && !v.includes("NO")) return "bg-success/15 text-success border-success/30";
  if (v.includes("NO ANSWER") || v.includes("MISSED")) return "bg-warning/15 text-warning border-warning/30";
  if (v.includes("BUSY") || v.includes("FAIL")) return "bg-destructive/15 text-destructive border-destructive/30";
  return "bg-muted text-muted-foreground border-border";
}

function directionIcon(d: string) {
  const v = (d || "").toLowerCase();
  if (v.includes("in")) return <ArrowDownLeft className="w-3.5 h-3.5 text-success" />;
  if (v.includes("out")) return <ArrowUpRight className="w-3.5 h-3.5 text-info" />;
  return <Phone className="w-3.5 h-3.5 text-muted-foreground" />;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso.replace(" ", "T"));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("ar-SA", { hour12: false });
  } catch { return iso; }
}

export function YeastarCdrTable() {
  const [items, setItems] = useState<CdrItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [pendingSearch, setPendingSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<CdrItem | null>(null);

  const load = async (p = page, q = search) => {
    setLoading(true); setErr(null);
    try {
      const res = await fetchCdr({ page: p, page_size: PAGE_SIZE, search: q || undefined });
      setItems(res.items);
      setTotal(res.total);
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message || "فشل الجلب";
      setErr(msg);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(page, search); /* eslint-disable-next-line */ }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const downloadHref = (rel: string) => {
    // ملاحظة: التحميل المباشر يحتاج token عبر Header — نستخدم زر يفتح Blob
    return buildAbsoluteRecordingUrl(rel);
  };

  const handleDownload = async (it: CdrItem) => {
    if (!it.recordingUrl) return;
    const url = buildAbsoluteRecordingUrl(it.recordingUrl);
    const token = tokenStorage.get();
    try {
      const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const a = document.createElement("a");
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = `recording-${it.id}.wav`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    } catch (e: any) {
      alert(`تعذّر التحميل: ${e?.message || e}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* شريط البحث */}
      <div className="rounded-2xl border border-border bg-card p-3 shadow-card flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="بحث برقم العميل أو التحويلة..."
            value={pendingSearch}
            onChange={(e) => setPendingSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { setSearch(pendingSearch); setPage(1); load(1, pendingSearch); }
            }}
            className="pr-10"
          />
        </div>
        <Button onClick={() => { setSearch(pendingSearch); setPage(1); load(1, pendingSearch); }} disabled={loading}>
          بحث
        </Button>
        <Button variant="outline" onClick={() => load(page, search)} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ms-1.5">تحديث</span>
        </Button>
        <Badge variant="outline" className="ms-auto">
          {total} مكالمة
        </Badge>
      </div>

      {/* خطأ */}
      {err && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <div className="flex-1">
            تعذّر جلب CDR من Yeastar: {err}
          </div>
        </div>
      )}

      {/* الجدول */}
      <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">#</TableHead>
              <TableHead className="text-right">الوقت</TableHead>
              <TableHead className="text-right">الاتجاه</TableHead>
              <TableHead className="text-right">من</TableHead>
              <TableHead className="text-right">إلى</TableHead>
              <TableHead className="text-right">التحويلة</TableHead>
              <TableHead className="text-right">المدة</TableHead>
              <TableHead className="text-right">الحالة</TableHead>
              <TableHead className="text-right">التسجيل</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin inline-block ms-1" /> جارٍ التحميل...
                </TableCell>
              </TableRow>
            )}
            {!loading && items.length === 0 && !err && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                  لا توجد مكالمات
                </TableCell>
              </TableRow>
            )}
            {items.map((it, idx) => (
              <TableRow key={it.id} className={cn(selected?.id === it.id && "bg-primary/5")}>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {(page - 1) * PAGE_SIZE + idx + 1}
                </TableCell>
                <TableCell className="text-right text-xs whitespace-nowrap">{fmtDate(it.startedAt)}</TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center gap-1">
                    {directionIcon(it.direction)}
                    <span className="text-[11px] text-muted-foreground">{it.direction || "—"}</span>
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  <div>{it.from.number || "—"}</div>
                  {it.from.name && <div className="text-[10px] text-muted-foreground">{it.from.name}</div>}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  <div>{it.to.number || "—"}</div>
                  {it.to.name && <div className="text-[10px] text-muted-foreground">{it.to.name}</div>}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">{it.extension || "—"}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">{formatTime(it.duration)}</TableCell>
                <TableCell className="text-right">
                  <Badge variant="outline" className={cn("text-[10px]", statusBadge(it.status))}>
                    {it.status || "—"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {it.hasRecording && it.recordingUrl ? (
                    <div className="flex items-center gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(it)} title="تشغيل">
                        <Play className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDownload(it)} title="تحميل">
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">لا يوجد</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-muted-foreground">
          صفحة {page} من {totalPages}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            السابق
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
            التالي
          </Button>
        </div>
      </div>

      {/* مشغّل التسجيل المختار */}
      {selected && selected.recordingUrl && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-foreground">
              تسجيل: <span className="font-mono text-xs text-muted-foreground">{selected.id}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>إغلاق</Button>
          </div>
          <AudioPlayer src={selected.recordingUrl} authRequired />
        </div>
      )}
    </div>
  );
}
