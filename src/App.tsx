import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Monitoring from "./pages/Monitoring";
import LiveReport from "./pages/LiveReport";
import Performance from "./pages/Performance";
import Alerts from "./pages/Alerts";
import AIAnalytics from "./pages/AIAnalytics";
import Recordings from "./pages/Recordings";
import Mailbox from "./pages/Mailbox";
import Settings from "./pages/Settings";
import Supervisors from "./pages/Supervisors";
import SupervisorDetail from "./pages/SupervisorDetail";
import Profile from "./pages/Profile";
import Login from "./pages/Login";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Index />} />
          <Route path="/live" element={<LiveReport />} />
          <Route path="/monitoring" element={<Monitoring />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/ai" element={<AIAnalytics />} />
          <Route path="/recordings" element={<Recordings />} />
          <Route path="/mail" element={<Mailbox />} />
          <Route path="/supervisors" element={<Supervisors />} />
          <Route path="/supervisors/:id" element={<SupervisorDetail />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
