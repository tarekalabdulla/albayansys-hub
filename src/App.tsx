import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import { PlaceholderPage } from "./pages/PlaceholderPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route
            path="/live"
            element={
              <PlaceholderPage
                title="التقرير الحي"
                subtitle="رسوم بيانية متوسطة وجدول أداء تفصيلي"
                description="سيعرض هذا القسم رسوماً بيانية لتوزيع المكالمات وجدولاً تفصيلياً يبيّن أداء كل موظف مع تحويلاته وحالته بشارات ملونة."
              />
            }
          />
          <Route
            path="/monitoring"
            element={
              <PlaceholderPage
                title="مراقبة الموظفين"
                subtitle="شريط تنبيهات ذكي وبطاقات مع مؤقتات حية"
                description="شبكة بطاقات تتغير حواف ألوانها بناءً على حالة الموظف، مع مؤقتات حية وأدوات بحث وفلترة."
              />
            }
          />
          <Route
            path="/performance"
            element={
              <PlaceholderPage
                title="جدول الأداء"
                subtitle="فلاتر متقدمة وتصدير البيانات"
                description="جدول بيانات شامل قابل للتصفية حسب التاريخ والموظف، مع إمكانية التصدير."
              />
            }
          />
          <Route
            path="/alerts"
            element={
              <PlaceholderPage
                title="الإشعارات التنبيهية"
                subtitle="إعدادات الخمول والتأخير"
                description="لوحة للتحكم بحدود التنبيهات عبر شرائط تمرير وأزرار تفعيل، مع قائمة إشعارات نشطة مصنفة حسب الخطورة."
              />
            }
          />
          <Route
            path="/ai"
            element={
              <PlaceholderPage
                title="تحليل الذكاء الاصطناعي"
                subtitle="توصيات ذكية وتحليل المشاعر"
                description="بطاقات بتوصيات ذكية لتحسين الأداء، ورسوم بيانية لتحليل المشاعر والتنبؤ بضغط العمل."
              />
            }
          />
          <Route
            path="/settings"
            element={
              <PlaceholderPage
                title="الإعدادات والمستخدمين"
                subtitle="إدارة الصلاحيات وإعدادات السيرفر"
                description="إدارة المستخدمين والصلاحيات عبر نوافذ منبثقة، إعدادات السيرفر (IP, Webhook)، وأدوات النسخ الاحتياطي."
              />
            }
          />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
