import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { ForceChangePasswordModal } from "./components/auth/ForceChangePasswordModal";
import { Loading } from "./components/ui";

// Core Public pages (bundled for instant load)
import LandingPage from "./pages/public/LandingPage";
import LoginPage from "./pages/public/LoginPage";

// Code-split secondary public & role portals
const RegisterPage = lazy(() => import("./pages/public/RegisterPage"));
const SetPasswordPage = lazy(() => import("./pages/public/SetPasswordPage"));

// Code-split dashboards & ordering flows
const RestaurantDashboard = lazy(() => import("./pages/restaurant/Dashboard"));
const AdminLogin = lazy(() => import("./pages/admin/LoginPage"));
const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const CustomerMenu = lazy(() => import("./pages/customer/CustomerMenu"));
const OrderStatusPage = lazy(() => import("./pages/customer/OrderStatusPage"));

// 404
import NotFoundPage from "./pages/NotFoundPage";

const RouteFallback = (
  <div className="min-h-screen flex items-center justify-center bg-slate-50">
    <Loading text="Loading AmarMenu..." />
  </div>
);

function AppContent() {
  const { mustChangePassword } = useAuth();

  return (
    <>
      <ForceChangePasswordModal isOpen={mustChangePassword} />
      <Suspense fallback={RouteFallback}>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/set-password" element={<SetPasswordPage />} />

          {/* Restaurant Dashboard Routes - Protected */}
          <Route path="/dashboard/profile" element={<Navigate to="/restaurant/profile" replace />} />
          <Route path="/dashboard/*" element={<Navigate to="/restaurant" replace />} />
          <Route
            path="/restaurant/*"
            element={
              <ProtectedRoute
                allowedRoles={["owner", "manager", "cashier", "kitchen", "waiter"]}
                fallbackPath="/login"
              >
                <RestaurantDashboard />
              </ProtectedRoute>
            }
          />

          {/* Admin Panel Routes - Protected */}
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route
            path="/admin/*"
            element={
              <ProtectedRoute allowedRoles={["super_admin"]} fallbackPath="/admin/login">
                <AdminDashboard />
              </ProtectedRoute>
            }
          />

          {/* Customer Ordering Route */}
          <Route path="/menu/:slug" element={<CustomerMenu />} />
          <Route path="/order/:orderId" element={<OrderStatusPage />} />

          {/* 404 */}
          <Route path="/404" element={<NotFoundPage />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
