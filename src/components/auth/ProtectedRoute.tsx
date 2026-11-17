import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, type UserRole } from "../../context/AuthContext";
import { Loading } from "../ui";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
  fallbackPath?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
  fallbackPath = "/login",
}) => {
  const { user, role, loading } = useAuth();
  const location = useLocation();

  if (loading) {
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

  return <>{children}</>;
};
