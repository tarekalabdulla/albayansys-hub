import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { AudioPlayer } from "@/components/recordings/AudioPlayer";
import { TranscriptView } from "@/components/recordings/TranscriptView";
import { QualityScore } from "@/components/recordings/QualityScore";
import { YeastarCdrTable } from "@/components/recordings/YeastarCdrTable";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Phone,
  Clock,
  Calendar,
  FileText,
  Sparkles,
  Filter,
  ChevronLeft,
  Server,
  Sparkle,
} from "lucide-react";
import {
  RECORDINGS,
  formatTime,
  qualityColorClass,
  sentimentLabel,
  type CallRecording,
} from "@/lib/recordingsData";
import { cn } from "@/lib/utils";

const CATEGORIES = ["الكل", "استفسار", "شكوى", "دعم فني", "مبيعات", "متابعة"] as const;

export default function Recordings() {
  const [selectedId, setSelectedId] = useState<string>(RECORDINGS[0].id);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("الكل");
  const [currentTime, setCurrentTime] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"list" | "detail">("list");

  const filtered = useMemo(() => {
    return RECORDINGS.filter((r) => {
      const matchSearch =
        !search ||
        r.agentName.includes(search) ||
        r.customerNumber.includes(search) ||
        r.id.includes(search);
      const matchCat = category === "الكل" || r.category === category;
      return matchSearch && matchCat;
    });
  }, [search, category]);

  const selected: CallRecording =
    filtered.find((r) => r.id === selectedId) || filtered[0] || RECORDINGS[0];

  const handleSeek = (time: number) => {
    setSeekTo(time);
    // إعادة تعيين بعد لحظة كي يستجيب لطلبات seek متعددة لنفس القيمة
    setTimeout(() => setSeekTo(null), 50);
  };

  const sentiment = sentimentLabel(selected.sentiment);

  return (
    <AppLayout
      title="تسجيلات المكالمات"
      subtitle="استمع، اقرأ النص، وراجع جودة كل مكالمة"
    >
      <Tabs defaultValue="yeastar" className="space-y-4">
        <TabsList className="grid grid-cols-2 max-w-md">
          <TabsTrigger value="yeastar" className="gap-1.5">
            <Server className="w-3.5 h-3.5" /> Yeastar CDR
          </TabsTrigger>
          <TabsTrigger value="demo" className="gap-1.5">
            <Sparkle className="w-3.5 h-3.5" /> تحليلات الجودة
          </TabsTrigger>
        </TabsList>

        <TabsContent value="yeastar" className="mt-0">
          <YeastarCdrTable />
        </TabsContent>

        <TabsContent value="demo" className="mt-0">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* قائمة التسجيلات */}
        <aside
          className={cn(
            "lg:col-span-4 xl:col-span-3 space-y-3",
            mobilePanel === "detail" && "hidden lg:block",
          )}
        >
          {/* الفلاتر */}
          <div className="rounded-2xl border border-border bg-card p-3 shadow-card space-y-3">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث برقم العميل أو الموظف..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-10"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    "text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition-all",
                    category === c
                      ? "bg-primary text-primary-foreground shadow-soft"
                      : "bg-muted text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="text-[11px] text-muted-foreground text-center pt-1 border-t border-border">
              {filtered.length} تسجيل من أصل {RECORDINGS.length}
            </div>
          </div>

          {/* بطاقات التسجيلات */}
          <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {filtered.map((r) => {
              const sent = sentimentLabel(r.sentiment);
              const active = r.id === selected.id;
              return (
                <button
                  key={r.id}
                  onClick={() => {
                    setSelectedId(r.id);
                    setMobilePanel("detail");
                    setCurrentTime(0);
                  }}
                  className={cn(
                    "w-full text-right rounded-xl p-3 border transition-all duration-300",
                    active
                      ? "bg-primary/10 border-primary/40 shadow-soft"
                      : "bg-card border-border hover:border-primary/30 hover:shadow-card",
                  )}
                >
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-9 h-9 rounded-full gradient-primary grid place-items-center text-[11px] font-bold text-primary-foreground shrink-0">
                      {r.agentAvatar}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{r.agentName}</p>
                      <p className="text-[11px] text-muted-foreground font-mono truncate">
                        {r.customerNumber}
                      </p>
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
                    <Badge variant="outline" className={cn("text-[10px] py-0 px-1.5 h-5", sent.cls)}>
                      {sent.label}
                    </Badge>
                  </div>
                </button>
              );
            })}

            {filtered.length === 0 && (
              <div className="text-center py-10 text-sm text-muted-foreground">
                لا توجد تسجيلات مطابقة
              </div>
            )}
          </div>
        </aside>

        {/* تفاصيل التسجيل المختار */}
        <section
          className={cn(
            "lg:col-span-8 xl:col-span-9 space-y-4",
            mobilePanel === "list" && "hidden lg:block",
          )}
        >
          {/* زر الرجوع للموبايل */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMobilePanel("list")}
            className="lg:hidden"
          >
            <ChevronLeft className="w-4 h-4 ms-1" /> العودة للقائمة
          </Button>

          {/* رأس المكالمة */}
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
              <Badge variant="outline" className={sentiment.cls}>
                المشاعر: {sentiment.label}
              </Badge>
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

            <div className="flex flex-wrap gap-1.5 mt-3">
              {selected.tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          </div>

          {/* المشغل */}
          <AudioPlayer
            src={selected.audioUrl}
            onTimeUpdate={setCurrentTime}
            seekTo={seekTo}
          />

          {/* الملخص + النص + الجودة */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <div className="xl:col-span-3 space-y-4">
              {/* الملخص الذكي */}
              <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-accent/15 grid place-items-center">
                    <Sparkles className="w-4 h-4 text-accent" />
                  </div>
                  <h3 className="text-sm font-bold text-foreground">الملخص الذكي</h3>
                </div>
                <p className="text-sm text-foreground/85 leading-relaxed">
                  {selected.summary}
                </p>
              </div>

              {/* النص */}
              <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-bold text-foreground">نص المكالمة</h3>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    اضغط على أي سطر للقفز إليه
                  </span>
                </div>
                <TranscriptView
                  lines={selected.transcript}
                  currentTime={currentTime}
                  onSeek={handleSeek}
                />
              </div>
            </div>

            {/* درجة الجودة */}
            <div className="xl:col-span-2">
              <div className="rounded-2xl border border-border bg-card p-4 shadow-card sticky top-4">
                <QualityScore score={selected.qualityScore} metrics={selected.metrics} />
              </div>
            </div>
          </div>
        </section>
      </div>
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
