import { useState, type ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";

interface AppLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

export function AppLayout({ children, title, subtitle }: AppLayoutProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen flex w-full">
      <AppSidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onMenuClick={() => setOpen(true)} title={title} subtitle={subtitle} />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
