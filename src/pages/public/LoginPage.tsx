import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Store, ArrowLeft, Mail, Lock, AlertCircle, Eye, EyeOff } from "lucide-react";
import { Button, Input, Alert, Card } from "../../components/ui";
import { APP_CONFIG } from "../../config/config";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import { isValidEmail, isValidPhone } from "../../utils/helpers";

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { signIn, signOut, user, role, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  // Automatically forward if already authenticated
  React.useEffect(() => {
    if (!authLoading && user && role) {
      if (role === "super_admin") {
        navigate("/admin", { replace: true });
      } else if (["owner", "manager", "cashier", "kitchen", "waiter"].includes(role)) {
        navigate("/restaurant", { replace: true });
      }
    }
  }, [user, role, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!formData.email || !formData.password) {
      setError("Please enter both email and password");
      return;
    }

    const isEmail = isValidEmail(formData.email);
    const isPhone = isValidPhone(formData.email);

    if (!isEmail && !isPhone) {
      setError("Please enter a valid email address or 11-digit phone number");
      return;
    }

    setLoading(true);

    try {
      const result = await signIn(formData.email, formData.password);

      if (!result.success) {
        // Check if registration is still pending
        const { data: registrationData } = await supabase
          .from("registration_requests")
          .select("status")
          .eq("email", formData.email.toLowerCase())
          .maybeSingle();

        if (registrationData && registrationData.status === "pending") {
          setError("pending");
          setLoading(false);
          return;
        }

        setError(result.error || "Invalid email or password");
        setLoading(false);
        return;
      }

      if (result.role === "super_admin") {
        navigate("/admin");
        return;
      }

      if (
        result.role &&
        ["owner", "manager", "cashier", "kitchen", "waiter"].includes(result.role)
      ) {
        navigate("/restaurant");
        return;
      }

      // No role found
      await signOut();
      setError("No active restaurant account associated with this login.");
    } catch (err: unknown) {
      console.error("Login error:", err);
      const message =
        err instanceof Error ? err.message : "Network error. Please check your connection.";
      setError(`Error: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError("");
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Back to Home */}
        <Link
          to="/"
          className="inline-flex items-center text-text-secondary hover:text-text mb-8"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Home
        </Link>

        {/* Login Card */}
        <Card>
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent/5 mb-4">
              <Store className="w-10 h-10 text-accent" />
            </div>
            <h1 className="text-2xl font-bold text-text mb-2">Welcome Back</h1>
            <p className="text-text-secondary">
              Login to your restaurant dashboard
            </p>
          </div>

          {/* Pending Registration Alert */}
          {error === "pending" && (
            <Alert
              type="warning"
              title="Account Pending Verification"
              message="Your registration is under review. Our team will contact you within 24 hours to complete the setup."
              className="mb-6"
            />
          )}

          {/* Error Alert */}
          {error && error !== "pending" && (
            <Alert type="error" message={error} className="mb-6" />
          )}


          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email or Phone Number"
              name="email"
              type="text"
              value={formData.email}
              onChange={handleChange}
              placeholder="your@email.com or 017XXXXXXXX"
              icon={<Mail className="w-5 h-5" />}
              required
              autoComplete="username"
            />

            <Input
              label="Password"
              name="password"
              type={showPassword ? "text" : "password"}
              value={formData.password}
              onChange={handleChange}
              placeholder="Enter your password"
              icon={<Lock className="w-5 h-5" />}
              required
              autoComplete="current-password"
              rightElement={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-slate-400 hover:text-slate-600 focus:outline-hidden transition-colors p-1"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center text-text-secondary">
                <input type="checkbox" className="mr-2 rounded border-border" />
                Remember me
              </label>
              <a href="#" className="text-accent hover:underline">
                Forgot password?
              </a>
            </div>

            <Button type="submit" loading={loading} fullWidth size="lg">
              Login
            </Button>
          </form>

          {/* Register Link */}
          <div className="mt-6 text-center text-sm text-text-secondary">
            Don't have an account?{" "}
            <Link
              to="/register"
              className="text-accent font-medium hover:underline"
            >
              Register your restaurant
            </Link>
          </div>

          {/* Admin Login */}
          <div className="mt-6 pt-6 border-t border-border text-center">
            <Link
              to="/admin/login"
              className="text-sm text-text-secondary hover:text-text flex items-center justify-center"
            >
              <AlertCircle className="w-4 h-4 mr-2" />
              Admin Login
            </Link>
          </div>
        </Card>

        {/* Help Text */}
        <p className="mt-6 text-center text-sm text-text-secondary">
          Need help? Contact us at support@{APP_CONFIG.appName.toLowerCase()}
          .com
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
