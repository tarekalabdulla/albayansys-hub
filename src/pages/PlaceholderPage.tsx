import { AppLayout } from "@/components/layout/AppLayout";
import { Sparkles } from "lucide-react";

interface PlaceholderPageProps {
  title: string;
  subtitle: string;
  description: string;
}

export function PlaceholderPage({ title, subtitle, description }: PlaceholderPageProps) {
  return (
    <AppLayout title={title} subtitle={subtitle}>
      <div className="grid place-items-center min-h-[60vh]">
        <div className="glass-card p-10 max-w-lg text-center anim-scale-in">
          <div className="w-16 h-16 rounded-2xl gradient-primary grid place-items-center mx-auto shadow-glow">
            <Sparkles className="w-8 h-8 text-primary-foreground" />
          </div>
          <h2 className="mt-5 text-2xl font-extrabold">{title}</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{description}</p>
          <div className="mt-5 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-primary/10 text-primary font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            قيد التطوير في المراحل القادمة
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
