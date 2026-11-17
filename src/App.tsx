import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";

// Public pages
import LandingPage from "./pages/public/LandingPage";
import RegisterPage from "./pages/public/RegisterPage";
import LoginPage from "./pages/public/LoginPage";

// Restaurant dashboard
import RestaurantDashboard from "./pages/restaurant/Dashboard";

// Admin panel
import AdminLogin from "./pages/admin/LoginPage";
import AdminDashboard from "./pages/admin/Dashboard";

// Customer ordering
import CustomerMenu from "./pages/customer/CustomerMenu";

// 404
import NotFoundPage from "./pages/NotFoundPage";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />

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

          {/* 404 */}
          <Route path="/404" element={<NotFoundPage />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
