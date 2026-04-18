import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Inbox,
  Send,
  Star,
  Trash2,
  Edit3,
  Search,
  Paperclip,
  Reply,
  Forward,
  Archive,
  ChevronLeft,
  Mail,
  AlertCircle,
  CornerUpLeft,
} from "lucide-react";
import { AGENTS } from "@/lib/mockData";
import {
  MAILS,
  CURRENT_USER,
  formatMailDate,
  priorityMeta,
  type InternalMail,
  type MailFolder,
  type MailPriority,
} from "@/lib/mailData";
import { cn } from "@/lib/utils";
import Swal from "sweetalert2";

const FOLDERS: { id: MailFolder; label: string; icon: any }[] = [
  { id: "inbox",   label: "الوارد", icon: Inbox },
  { id: "starred", label: "المميزة", icon: Star },
  { id: "sent",    label: "الصادر", icon: Send },
  { id: "drafts",  label: "المسودات", icon: Edit3 },
  { id: "trash",   label: "المحذوفة", icon: Trash2 },
];

export default function Mailbox() {
  const [mails, setMails] = useState<InternalMail[]>(MAILS);
  const [folder, setFolder] = useState<MailFolder>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(MAILS[0]?.id || null);
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  // Compose state
  const [toExt, setToExt] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<MailPriority>("normal");

  const folderMails = useMemo(() => {
    return mails.filter((m) => {
      if (folder === "starred") return m.starred && m.folder !== "trash";
      return m.folder === folder;
    });
  }, [mails, folder]);

  const filteredMails = useMemo(() => {
    if (!search) return folderMails;
    const q = search.toLowerCase();
    return folderMails.filter(
      (m) =>
        m.subject.toLowerCase().includes(q) ||
        m.from.name.toLowerCase().includes(q) ||
        m.to.name.toLowerCase().includes(q) ||
        m.body.toLowerCase().includes(q),
    );
  }, [folderMails, search]);

  const selected = useMemo(
    () => mails.find((m) => m.id === selectedId) || null,
    [mails, selectedId],
  );

  const counts = useMemo(() => ({
    inbox:   mails.filter((m) => m.folder === "inbox" && !m.read).length,
    sent:    mails.filter((m) => m.folder === "sent").length,
    starred: mails.filter((m) => m.starred && m.folder !== "trash").length,
    drafts:  0,
    trash:   mails.filter((m) => m.folder === "trash").length,
  }), [mails]);

  const openMail = (id: string) => {
    setSelectedId(id);
    setMobileView("detail");
    setMails((prev) => prev.map((m) => (m.id === id ? { ...m, read: true } : m)));
  };

  const toggleStar = (id: string) => {
    setMails((prev) => prev.map((m) => (m.id === id ? { ...m, starred: !m.starred } : m)));
  };

  const moveToTrash = (id: string) => {
    setMails((prev) => prev.map((m) => (m.id === id ? { ...m, folder: "trash" } : m)));
    setSelectedId(null);
    setMobileView("list");
  };

  const sendMail = () => {
    const target = AGENTS.find((a) => a.ext === toExt);
    if (!target || !subject.trim() || !body.trim()) {
      Swal.fire({
        icon: "warning",
        title: "بيانات ناقصة",
        text: "يرجى تعبئة المستلم والموضوع والمحتوى.",
        confirmButtonColor: "hsl(var(--primary))",
      });
      return;
    }
    const newMail: InternalMail = {
      id: `M-${Date.now()}`,
      from: { name: CURRENT_USER.name, avatar: CURRENT_USER.avatar, ext: CURRENT_USER.ext },
      to: { name: target.name, avatar: target.avatar, ext: target.ext },
      subject,
      body,
      date: new Date().toISOString(),
      read: true,
      starred: false,
      priority,
      folder: "sent",
      ownerExt: CURRENT_USER.ext,
    };
    setMails((prev) => [newMail, ...prev]);
    setComposeOpen(false);
    setToExt(""); setSubject(""); setBody(""); setPriority("normal");
    setFolder("sent");
    setSelectedId(newMail.id);
    Swal.fire({
      icon: "success",
      title: "تم الإرسال",
      text: `تم إرسال الرسالة إلى ${target.name}`,
      confirmButtonColor: "hsl(var(--primary))",
      timer: 1800,
    });
  };

  const replyTo = (m: InternalMail) => {
    setToExt(m.from.ext);
    setSubject(m.subject.startsWith("Re:") ? m.subject : `Re: ${m.subject}`);
    setBody(`\n\n---\nرد على رسالة من ${m.from.name}:\n${m.body.split("\n").map((l) => "> " + l).join("\n")}`);
    setPriority(m.priority);
    setComposeOpen(true);
  };

  return (
    <AppLayout title="البريد الداخلي" subtitle="تواصل بين موظفي مركز الاتصال">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* الشريط الجانبي للمجلدات */}
        <aside className="lg:col-span-2 space-y-2">
          <Button
            onClick={() => setComposeOpen(true)}
            className="w-full gradient-primary text-primary-foreground shadow-glow"
          >
            <Edit3 className="w-4 h-4 ms-2" /> رسالة جديدة
          </Button>

          <nav className="rounded-2xl border border-border bg-card p-2 shadow-card">
            {FOLDERS.map((f) => {
              const count = counts[f.id];
              const active = folder === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => { setFolder(f.id); setMobileView("list"); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/75 hover:bg-muted",
                  )}
                >
                  <f.icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1 text-right">{f.label}</span>
                  {count > 0 && (
                    <Badge
                      variant={active ? "default" : "secondary"}
                      className={cn("text-[10px] h-5 px-1.5", active && "bg-primary text-primary-foreground")}
                    >
                      {count}
                    </Badge>
                  )}
                </button>
              );
            })}
          </nav>

          {/* بطاقة المستخدم */}
          <div className="rounded-2xl border border-border bg-card p-3 shadow-card hidden lg:block">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full gradient-primary grid place-items-center text-[11px] font-bold text-primary-foreground">
                {CURRENT_USER.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate">{CURRENT_USER.name}</p>
                <p className="text-[10px] text-muted-foreground">تحويلة {CURRENT_USER.ext}</p>
              </div>
            </div>
          </div>
        </aside>

        {/* قائمة الرسائل */}
        <section
          className={cn(
            "lg:col-span-4 rounded-2xl border border-border bg-card shadow-card overflow-hidden flex flex-col",
            mobileView === "detail" && "hidden lg:flex",
          )}
        >
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث في الرسائل..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-10 bg-background/60"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[calc(100vh-280px)]">
            {filteredMails.length === 0 && (
              <div className="text-center py-12 text-sm text-muted-foreground">
                <Mail className="w-10 h-10 mx-auto mb-2 opacity-40" />
                لا توجد رسائل
              </div>
            )}
            {filteredMails.map((m) => {
              const isSent = m.folder === "sent";
              const person = isSent ? m.to : m.from;
              const active = m.id === selectedId;
              const prio = priorityMeta(m.priority);
              return (
                <button
                  key={m.id}
                  onClick={() => openMail(m.id)}
                  className={cn(
                    "w-full text-right p-3 border-b border-border/60 transition-colors flex gap-3",
                    active ? "bg-primary/10" : "hover:bg-muted/40",
                    !m.read && !isSent && "bg-info/5",
                  )}
                >
                  <div className="w-10 h-10 rounded-full gradient-primary grid place-items-center text-[11px] font-bold text-primary-foreground shrink-0">
                    {person.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className={cn(
                        "text-sm truncate",
                        !m.read && !isSent ? "font-extrabold" : "font-semibold",
                      )}>
                        {isSent ? `إلى: ${person.name}` : person.name}
                      </p>
                      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                        {formatMailDate(m.date)}
                      </span>
                    </div>
                    <p className={cn(
                      "text-xs truncate mb-1",
                      !m.read && !isSent ? "font-bold text-foreground" : "text-foreground/80",
                    )}>
                      {m.subject}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {!m.read && !isSent && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                      {m.starred && (
                        <Star className="w-3 h-3 fill-warning text-warning" />
                      )}
                      {m.attachments && m.attachments.length > 0 && (
                        <Paperclip className="w-3 h-3 text-muted-foreground" />
                      )}
                      <Badge variant="outline" className={cn("text-[9px] h-4 px-1.5", prio.cls)}>
                        {prio.label}
                      </Badge>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* تفاصيل الرسالة */}
        <section
          className={cn(
            "lg:col-span-6 rounded-2xl border border-border bg-card shadow-card flex flex-col",
            mobileView === "list" && "hidden lg:flex",
          )}
        >
          {selected ? (
            <>
              <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between mb-3 gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setMobileView("list")}
                    className="lg:hidden"
                  >
                    <ChevronLeft className="w-4 h-4 ms-1" /> العودة
                  </Button>
                  <div className="flex items-center gap-1 ms-auto">
                    <Button variant="ghost" size="icon" onClick={() => toggleStar(selected.id)}>
                      <Star className={cn("w-4 h-4", selected.starred && "fill-warning text-warning")} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => replyTo(selected)} title="رد">
                      <Reply className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="إعادة توجيه">
                      <Forward className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="أرشفة">
                      <Archive className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => moveToTrash(selected.id)} title="حذف">
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <h2 className="text-lg font-extrabold text-foreground mb-3">
                  {selected.subject}
                </h2>

                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-full gradient-primary grid place-items-center text-xs font-bold text-primary-foreground shrink-0">
                    {selected.from.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-sm font-bold">{selected.from.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          من: تحويلة {selected.from.ext} → إلى: {selected.to.name} (تحويلة {selected.to.ext})
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={priorityMeta(selected.priority).cls}>
                          {priorityMeta(selected.priority).label}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {new Date(selected.date).toLocaleString("ar-SA", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 max-h-[calc(100vh-380px)]">
                <div className="prose prose-sm max-w-none text-foreground/90 whitespace-pre-wrap text-sm leading-relaxed">
                  {selected.body}
                </div>

                {selected.attachments && selected.attachments.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-border">
                    <p className="text-xs font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Paperclip className="w-3.5 h-3.5" />
                      المرفقات ({selected.attachments.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selected.attachments.map((a) => (
                        <button
                          key={a.name}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/40 hover:bg-muted transition-colors text-xs"
                        >
                          <Paperclip className="w-3.5 h-3.5 text-primary" />
                          <span className="font-semibold">{a.name}</span>
                          <span className="text-muted-foreground">({a.size})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3 border-t border-border flex items-center gap-2">
                <Button onClick={() => replyTo(selected)} className="gradient-primary text-primary-foreground">
                  <CornerUpLeft className="w-4 h-4 ms-2" /> رد
                </Button>
                <Button variant="outline">
                  <Forward className="w-4 h-4 ms-2" /> إعادة توجيه
                </Button>
              </div>
            </>
          ) : (
            <div className="flex-1 grid place-items-center text-center p-10">
              <div>
                <Mail className="w-14 h-14 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">اختر رسالة لعرض محتواها</p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* مودال التأليف */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="w-5 h-5 text-primary" />
              رسالة جديدة
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-bold text-muted-foreground mb-1 block">
                إلى (الموظف)
              </label>
              <Select value={toExt} onValueChange={setToExt}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الموظف المستلم..." />
                </SelectTrigger>
                <SelectContent>
                  {AGENTS.map((a) => (
                    <SelectItem key={a.id} value={a.ext}>
                      {a.name} — تحويلة {a.ext}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-bold text-muted-foreground mb-1 block">الموضوع</label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="عنوان الرسالة..."
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground mb-1 block">الأولوية</label>
                <Select value={priority} onValueChange={(v) => setPriority(v as MailPriority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">
                      <span className="flex items-center gap-2">
                        <AlertCircle className="w-3.5 h-3.5 text-destructive" /> عاجل
                      </span>
                    </SelectItem>
                    <SelectItem value="normal">عادي</SelectItem>
                    <SelectItem value="low">منخفض</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-muted-foreground mb-1 block">المحتوى</label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="اكتب رسالتك هنا..."
                rows={8}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeOpen(false)}>إلغاء</Button>
            <Button onClick={sendMail} className="gradient-primary text-primary-foreground">
              <Send className="w-4 h-4 ms-2" /> إرسال
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
