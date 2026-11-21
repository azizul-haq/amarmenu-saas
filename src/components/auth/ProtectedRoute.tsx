import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, type UserRole } from "../../context/AuthContext";
import { Loading } from "../ui";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
  requiredPermission?: string;
  requiredPermissions?: string[];
  fallbackPath?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
  requiredPermission,
  requiredPermissions,
  fallbackPath = "/login",
}) => {
  const { user, role, hasPermission, loading } = useAuth();
  const location = useLocation();
  const [hasTimedOut, setHasTimedOut] = React.useState(false);

  React.useEffect(() => {
    if (!loading) {
      setHasTimedOut(false);
      return;
    }
    const timer = setTimeout(() => {
      setHasTimedOut(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [loading]);

  if (loading && !hasTimedOut) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-subtle">
        <Loading text="Authenticating..." />
      </div>
    );
  }

  // Not logged in -> Redirect to login page
  if (!user) {
    return <Navigate to={fallbackPath} state={{ from: location }} replace />;
  }

  // Check role authorization if allowedRoles are specified
  if (allowedRoles && allowedRoles.length > 0) {
    if (!role || !allowedRoles.includes(role)) {
      // If user is trying to access admin without super_admin role, send to /admin/login
      if (allowedRoles.includes("super_admin")) {
        return <Navigate to="/admin/login" state={{ from: location }} replace />;
      }
      // Otherwise send to generic fallback
      return <Navigate to={fallbackPath} state={{ from: location }} replace />;
    }
  }

  // Check granular permission requirement
  if (role !== "super_admin") {
    if (requiredPermission && !hasPermission(requiredPermission)) {
      return <Navigate to={fallbackPath} state={{ from: location }} replace />;
    }
    if (
      requiredPermissions &&
      requiredPermissions.length > 0 &&
      !requiredPermissions.some((p) => hasPermission(p))
    ) {
      return <Navigate to={fallbackPath} state={{ from: location }} replace />;
    }
  }

  return <>{children}</>;
};
