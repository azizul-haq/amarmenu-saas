import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { ForceChangePasswordModal } from "./components/auth/ForceChangePasswordModal";

// Public pages
import LandingPage from "./pages/public/LandingPage";
import RegisterPage from "./pages/public/RegisterPage";
import LoginPage from "./pages/public/LoginPage";
import SetPasswordPage from "./pages/public/SetPasswordPage";

// Restaurant dashboard
import RestaurantDashboard from "./pages/restaurant/Dashboard";

// Admin panel
import AdminLogin from "./pages/admin/LoginPage";
import AdminDashboard from "./pages/admin/Dashboard";

// Customer ordering
import CustomerMenu from "./pages/customer/CustomerMenu";
import OrderStatusPage from "./pages/customer/OrderStatusPage";

// 404
import NotFoundPage from "./pages/NotFoundPage";

function AppContent() {
  const { mustChangePassword } = useAuth();

  return (
    <>
      <ForceChangePasswordModal isOpen={mustChangePassword} />
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />

        {/* Restaurant Dashboard Routes - Protected */}
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
