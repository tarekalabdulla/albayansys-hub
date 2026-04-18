import { useEffect, useRef } from "react";
import { Headphones, User } from "lucide-react";
import type { TranscriptLine } from "@/lib/recordingsData";
import { formatTime } from "@/lib/recordingsData";
import { cn } from "@/lib/utils";

interface TranscriptViewProps {
  lines: TranscriptLine[];
  currentTime: number;
  onSeek: (time: number) => void;
}

export function TranscriptView({ lines, currentTime, onSeek }: TranscriptViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // العثور على السطر النشط
  const activeIndex = lines.reduce((acc, line, i) => {
    if (currentTime >= line.time) return i;
    return acc;
  }, 0);

  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      const c = containerRef.current;
      const el = activeRef.current;
      const offset = el.offsetTop - c.offsetTop - c.clientHeight / 2 + el.clientHeight / 2;
      c.scrollTo({ top: offset, behavior: "smooth" });
    }
  }, [activeIndex]);

  return (
    <div
      ref={containerRef}
      className="space-y-3 overflow-y-auto pr-1 max-h-[420px] scroll-smooth"
    >
      {lines.map((line, i) => {
        const isAgent = line.speaker === "agent";
        const isActive = i === activeIndex;

        return (
          <button
            key={i}
            ref={isActive ? activeRef : undefined}
            onClick={() => onSeek(line.time)}
            className={cn(
              "w-full flex gap-3 text-right transition-all duration-300 rounded-xl p-3 group",
              isAgent ? "flex-row" : "flex-row-reverse",
              isActive
                ? "bg-primary/10 border border-primary/30 shadow-soft"
                : "border border-transparent hover:bg-muted/60",
            )}
          >
            {/* الأفاتار */}
            <div
              className={cn(
                "w-9 h-9 rounded-full grid place-items-center shrink-0 shadow-sm",
                isAgent
                  ? "bg-primary/15 text-primary"
                  : "bg-accent/15 text-accent",
              )}
            >
              {isAgent ? <Headphones className="w-4 h-4" /> : <User className="w-4 h-4" />}
            </div>

            {/* النص */}
            <div className={cn("flex-1 min-w-0", isAgent ? "text-right" : "text-right")}>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    "text-[11px] font-bold",
                    isAgent ? "text-primary" : "text-accent",
                  )}
                >
                  {isAgent ? "الموظف" : "العميل"}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                  {formatTime(line.time)}
                </span>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                )}
              </div>
              <p
                className={cn(
                  "text-sm leading-relaxed",
                  isActive ? "text-foreground font-medium" : "text-foreground/85",
                )}
              >
                {line.text}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
