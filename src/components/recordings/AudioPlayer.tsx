import { useEffect, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Download, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatTime } from "@/lib/recordingsData";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  src: string;
  onTimeUpdate?: (time: number) => void;
  onSeek?: (time: number) => void;
  seekTo?: number | null;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export function AudioPlayer({ src, onTimeUpdate, onSeek, seekTo }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setLoading(true);
  }, [src]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    if (seekTo != null && audioRef.current) {
      audioRef.current.currentTime = seekTo;
      setCurrent(seekTo);
    }
  }, [seekTo]);

  const toggle = async () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      try {
        await audioRef.current.play();
        setPlaying(true);
      } catch {
        // المتصفح قد يمنع التشغيل التلقائي
      }
    }
  };

  const skip = (sec: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(duration, audioRef.current.currentTime + sec));
  };

  const onSlide = (vals: number[]) => {
    if (!audioRef.current) return;
    const v = vals[0];
    audioRef.current.currentTime = v;
    setCurrent(v);
    onSeek?.(v);
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || 0);
          setLoading(false);
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setCurrent(t);
          onTimeUpdate?.(t);
        }}
        onEnded={() => setPlaying(false)}
        onError={() => setLoading(false)}
      />

      {/* شريط التقدم */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs font-mono tabular-nums text-muted-foreground w-12 text-center">
          {formatTime(current)}
        </span>
        <Slider
          value={[current]}
          max={duration || 100}
          step={0.1}
          onValueChange={onSlide}
          className="flex-1"
          disabled={loading}
        />
        <span className="text-xs font-mono tabular-nums text-muted-foreground w-12 text-center">
          {formatTime(duration)}
        </span>
      </div>

      {/* أدوات التحكم */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => skip(-10)} disabled={loading}>
            <SkipBack className="w-4 h-4" />
          </Button>
          <Button
            onClick={toggle}
            disabled={loading}
            size="icon"
            className={cn(
              "w-12 h-12 rounded-full shadow-glow",
              "bg-primary hover:bg-primary/90 text-primary-foreground",
            )}
          >
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ms-0.5" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => skip(10)} disabled={loading}>
            <SkipForward className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {/* السرعة */}
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-muted">
            <Gauge className="w-3.5 h-3.5 text-muted-foreground" />
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={cn(
                  "text-[11px] font-bold px-1.5 py-0.5 rounded-md transition-colors",
                  speed === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* الصوت */}
          <div className="flex items-center gap-2 min-w-[120px]">
            <Button variant="ghost" size="icon" onClick={() => setMuted((m) => !m)}>
              {muted || volume === 0 ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </Button>
            <Slider
              value={[muted ? 0 : volume * 100]}
              max={100}
              onValueChange={(v) => {
                setMuted(false);
                setVolume(v[0] / 100);
              }}
              className="w-20"
            />
          </div>

          <a href={src} download target="_blank" rel="noreferrer">
            <Button variant="outline" size="icon">
              <Download className="w-4 h-4" />
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}
