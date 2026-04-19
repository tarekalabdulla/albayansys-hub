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
import ForgotPassword from "./pages/ForgotPassword";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          {/* الجميع */}
          <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
          <Route path="/live" element={<ProtectedRoute><LiveReport /></ProtectedRoute>} />
          <Route path="/recordings" element={<ProtectedRoute><Recordings /></ProtectedRoute>} />
          <Route path="/mail" element={<ProtectedRoute><Mailbox /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

          {/* مدير + مشرف */}
          <Route path="/monitoring" element={<ProtectedRoute allowedRoles={["admin", "supervisor"]}><Monitoring /></ProtectedRoute>} />
          <Route path="/performance" element={<ProtectedRoute allowedRoles={["admin", "supervisor"]}><Performance /></ProtectedRoute>} />
          <Route path="/alerts" element={<ProtectedRoute allowedRoles={["admin", "supervisor"]}><Alerts /></ProtectedRoute>} />
          <Route path="/ai" element={<ProtectedRoute allowedRoles={["admin", "supervisor"]}><AIAnalytics /></ProtectedRoute>} />
          <Route path="/supervisors/:id" element={<ProtectedRoute allowedRoles={["admin", "supervisor"]}><SupervisorDetail /></ProtectedRoute>} />

          {/* مدير فقط */}
          <Route path="/supervisors" element={<ProtectedRoute allowedRoles={["admin"]}><Supervisors /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute allowedRoles={["admin"]}><Settings /></ProtectedRoute>} />

          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
