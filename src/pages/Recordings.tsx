import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { AudioPlayer } from "@/components/recordings/AudioPlayer";
import { TranscriptView } from "@/components/recordings/TranscriptView";
import { QualityScore } from "@/components/recordings/QualityScore";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Search, Phone, Clock, Calendar, FileText, Sparkles, Filter, ChevronLeft, Loader2, Mic,
} from "lucide-react";
import { recordingsApi, type ApiRecording } from "@/lib/dataApi";
import { CsvImportButton } from "@/components/CsvImportButton";
import { AudioUploadDialog } from "@/components/recordings/AudioUploadDialog";
import { RECORDINGS_TEMPLATE_HEADERS, RECORDINGS_TEMPLATE_SAMPLE } from "@/lib/csvImport";
import { cn } from "@/lib/utils";

const CATEGORIES = ["الكل", "استفسار", "شكوى", "دعم فني", "مبيعات", "متابعة"] as const;

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function qualityColorClass(score: number): string {
  if (score >= 85) return "text-success";
  if (score >= 70) return "text-info";
  if (score >= 55) return "text-warning";
  return "text-destructive";
}

function sentimentLabel(s: ApiRecording["sentiment"]) {
  switch (s) {
    case "positive": return { label: "إيجابي", cls: "bg-success/15 text-success border-success/30" };
    case "neutral":  return { label: "محايد",  cls: "bg-info/15 text-info border-info/30" };
    case "negative": return { label: "سلبي",   cls: "bg-destructive/15 text-destructive border-destructive/30" };
  }
}

export default function Recordings() {
  const [recordings, setRecordings] = useState<ApiRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("الكل");
  const [currentTime, setCurrentTime] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"list" | "detail">("list");

  const loadRecordings = () => {
    setLoading(true);
    recordingsApi.list()
      .then((list) => {
        setRecordings(list);
        if (list.length && !selectedId) setSelectedId(list[0].id);
      })
      .catch(() => setRecordings([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadRecordings(); }, []);

  const actionsBtns = (
    <div className="flex items-center gap-2 flex-wrap">
      <AudioUploadDialog onCreated={loadRecordings} />
      <CsvImportButton
        label="تسجيل"
        requiredHeaders={["agentName", "customerNumber"]}
        templateHeaders={RECORDINGS_TEMPLATE_HEADERS}
        templateSample={RECORDINGS_TEMPLATE_SAMPLE}
        templateFileName="recordings-template.csv"
        onImport={async (rows) => recordingsApi.bulkCreate(rows)}
        onSuccess={loadRecordings}
      />
    </div>
  );

  const filtered = useMemo(() => {
    return recordings.filter((r) => {
      const matchSearch =
        !search ||
        r.agentName.includes(search) ||
        r.customerNumber.includes(search) ||
        r.id.includes(search);
      const matchCat = category === "الكل" || r.category === category;
      return matchSearch && matchCat;
    });
  }, [recordings, search, category]);

  const selected: ApiRecording | null =
    filtered.find((r) => r.id === selectedId) || filtered[0] || null;

  const handleSeek = (time: number) => {
    setSeekTo(time);
    setTimeout(() => setSeekTo(null), 50);
  };

  if (loading) {
    return (
      <AppLayout title="تسجيلات المكالمات" subtitle="استمع، اقرأ النص، وراجع جودة كل مكالمة">
        <div className="grid place-items-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (recordings.length === 0) {
    return (
      <AppLayout title="تسجيلات المكالمات" subtitle="استمع، اقرأ النص، وراجع جودة كل مكالمة">
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Mic className="w-14 h-14 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-base font-bold mb-1">لا توجد تسجيلات بعد</p>
          <p className="text-sm text-muted-foreground mb-5">
            ستظهر هنا تلقائياً عند ربط نظام تسجيل المكالمات (PBX) — أو استورد دفعة يدوياً عبر CSV.
          </p>
          <div className="flex items-center justify-center">{importBtn}</div>
        </div>
      </AppLayout>
    );
  }

  if (!selected) return null;
  const sentiment = sentimentLabel(selected.sentiment);

  return (
    <AppLayout title="تسجيلات المكالمات" subtitle="استمع، اقرأ النص، وراجع جودة كل مكالمة">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <aside className={cn("lg:col-span-4 xl:col-span-3 space-y-3", mobilePanel === "detail" && "hidden lg:block")}>
          <div className="rounded-2xl border border-border bg-card p-3 shadow-card space-y-3">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="بحث برقم العميل أو الموظف..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-10" />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    "text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition-all",
                    category === c ? "bg-primary text-primary-foreground shadow-soft" : "bg-muted text-muted-foreground hover:bg-secondary",
                  )}
                >{c}</button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
              <div className="text-[11px] text-muted-foreground">
                {filtered.length} من {recordings.length}
              </div>
              {importBtn}
            </div>
          </div>

          <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {filtered.map((r) => {
              const sent = sentimentLabel(r.sentiment);
              const active = r.id === selected.id;
              return (
                <button
                  key={r.id}
                  onClick={() => { setSelectedId(r.id); setMobilePanel("detail"); setCurrentTime(0); }}
                  className={cn(
                    "w-full text-right rounded-xl p-3 border transition-all duration-300",
                    active ? "bg-primary/10 border-primary/40 shadow-soft" : "bg-card border-border hover:border-primary/30 hover:shadow-card",
                  )}
                >
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-9 h-9 rounded-full gradient-primary grid place-items-center text-[11px] font-bold text-primary-foreground shrink-0">
                      {r.agentAvatar}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{r.agentName}</p>
                      <p className="text-[11px] text-muted-foreground font-mono truncate">{r.customerNumber}</p>
                    </div>
                    <div className={cn("text-lg font-extrabold tabular-nums", qualityColorClass(r.qualityScore))}>
                      {r.qualityScore}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatTime(r.duration)}
                      </span>
                      <span>•</span>
                      <span>{r.time}</span>
                    </div>
                    <Badge variant="outline" className={cn("text-[10px] py-0 px-1.5 h-5", sent.cls)}>{sent.label}</Badge>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-center py-10 text-sm text-muted-foreground">لا توجد تسجيلات مطابقة</div>
            )}
          </div>
        </aside>

        <section className={cn("lg:col-span-8 xl:col-span-9 space-y-4", mobilePanel === "list" && "hidden lg:block")}>
          <Button variant="ghost" size="sm" onClick={() => setMobilePanel("list")} className="lg:hidden">
            <ChevronLeft className="w-4 h-4 ms-1" /> العودة للقائمة
          </Button>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl gradient-primary grid place-items-center text-sm font-bold text-primary-foreground shadow-glow">
                  {selected.agentAvatar}
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">{selected.agentName}</h3>
                  <p className="text-xs text-muted-foreground font-mono">{selected.id}</p>
                </div>
              </div>
              <Badge variant="outline" className={sentiment.cls}>المشاعر: {sentiment.label}</Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/60">
                <Phone className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="font-mono truncate">{selected.customerNumber}</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/60">
                <Calendar className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>{selected.date}</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/60">
                <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>{selected.time} • {formatTime(selected.duration)}</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/60">
                <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>{selected.category}</span>
              </div>
            </div>

            {selected.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {selected.tags.map((t) => (<Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>))}
              </div>
            )}
          </div>

          {selected.audioUrl && (
            <AudioPlayer src={selected.audioUrl} onTimeUpdate={setCurrentTime} seekTo={seekTo} />
          )}

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <div className="xl:col-span-3 space-y-4">
              {selected.summary && (
                <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-accent/15 grid place-items-center">
                      <Sparkles className="w-4 h-4 text-accent" />
                    </div>
                    <h3 className="text-sm font-bold text-foreground">الملخص الذكي</h3>
                  </div>
                  <p className="text-sm text-foreground/85 leading-relaxed">{selected.summary}</p>
                </div>
              )}

              {selected.transcript?.length > 0 && (
                <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary" />
                      <h3 className="text-sm font-bold text-foreground">نص المكالمة</h3>
                    </div>
                    <span className="text-[10px] text-muted-foreground">اضغط على أي سطر للقفز إليه</span>
                  </div>
                  <TranscriptView lines={selected.transcript} currentTime={currentTime} onSeek={handleSeek} />
                </div>
              )}
            </div>

            {selected.metrics?.length > 0 && (
              <div className="xl:col-span-2">
                <div className="rounded-2xl border border-border bg-card p-4 shadow-card sticky top-4">
                  <QualityScore score={selected.qualityScore} metrics={selected.metrics} />
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
