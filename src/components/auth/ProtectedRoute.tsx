import { Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { isAuthenticated, getRole, type Role } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: Role[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const location = useLocation();
  const { toast } = useToast();
  const authed = isAuthenticated();
  const role = getRole();
  const allowed = !allowedRoles || (role !== null && allowedRoles.includes(role));

  useEffect(() => {
    if (authed && !allowed) {
      toast({
        title: "ليس لديك صلاحية",
        description: "هذه الصفحة متاحة لأدوار محددة فقط",
        variant: "destructive",
      });
    }
  }, [authed, allowed, toast]);

  if (!authed) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!allowed) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
