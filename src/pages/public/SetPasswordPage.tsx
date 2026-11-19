import React, { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Lock, ArrowLeft, ShieldCheck } from "lucide-react";
import { Button, Input, Alert, Card } from "../../components/ui";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import { APP_CONFIG } from "../../config/config";

const SetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refreshProfile } = useAuth();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  // Store token and type in component state and strip them from the browser address bar
  const [tokenHash, setTokenHash] = useState<string>("");
  const [otpType, setOtpType] = useState<"invite" | "recovery" | null>(null);

  useEffect(() => {
    const hashFromUrl = searchParams.get("token_hash");
    const rawType = searchParams.get("type");

    if (hashFromUrl) {
      setTokenHash(hashFromUrl);
      if (rawType === "invite" || rawType === "recovery") {
        setOtpType(rawType);
      } else {
        setOtpType("recovery");
      }

      // Strip token_hash and type from address bar to prevent scanner/leak issues
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Check if user is currently in a recovery/invite session via token in URL hash
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setHasSession(true);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        event === "PASSWORD_RECOVERY" ||
        event === "SIGNED_IN" ||
        event === "USER_UPDATED"
      ) {
        if (session) {
          setHasSession(true);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match. Please verify.");
      return;
    }

    setLoading(true);

    try {
      if (hasSession) {
        // Active session from prior login/recovery -> update password directly
        const { error: updateError } = await supabase.auth.updateUser({
          password: password,
        });

        if (updateError) {
          throw updateError;
        }

        setSuccess(true);
        await refreshProfile();
        setTimeout(() => {
          navigate("/restaurant");
        }, 1500);
      } else if (tokenHash) {
        // Anti-scanner protection: verifyOtp({ type, token_hash }) only on explicit user click
        const selectedType = otpType === "invite" ? "invite" : "recovery";
        const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: selectedType,
        });

        if (verifyError || !verifyData?.session) {
          throw new Error(
            verifyError?.message || "Invalid or expired invitation link. Please request a new invite link from support."
          );
        }

        // Session is now established; immediately update password
        const { error: updateError } = await supabase.auth.updateUser({
          password: password,
        });

        if (updateError) {
          throw updateError;
        }

        setSuccess(true);
        await refreshProfile();
        setTimeout(() => {
          navigate("/restaurant");
        }, 1500);
      } else {
        setError(
          "Invalid or expired invitation link. Please request a new invite link from your administrator."
        );
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to set password. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Back Link */}
        <Link
          to="/login"
          className="inline-flex items-center text-text-secondary hover:text-text mb-8"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Login
        </Link>

        {/* Card */}
        <Card>
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent/10 mb-4">
              <ShieldCheck className="w-10 h-10 text-accent" />
            </div>
            <h1 className="text-2xl font-bold text-text mb-2">
              Set Your Password
            </h1>
            <p className="text-text-secondary">
              Create a secure password for your restaurant owner account
            </p>
          </div>

          {success && (
            <Alert
              type="success"
              title="Password Set Successfully!"
              message="Redirecting you to your restaurant dashboard..."
              className="mb-6"
            />
          )}

          {error && <Alert type="error" message={error} className="mb-6" />}

          {!success && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="New Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                icon={<Lock className="w-5 h-5" />}
                required
                autoComplete="new-password"
              />

              <Input
                label="Confirm New Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                icon={<Lock className="w-5 h-5" />}
                required
                autoComplete="new-password"
              />

              <div className="p-3 bg-bg-subtle rounded-lg text-xs text-text-secondary space-y-1">
                <p className="font-semibold text-text">Password Requirements:</p>
                <p>• At least 8 characters</p>
                <p>• Recommended: mix of letters, numbers, and symbols</p>
              </div>

              <Button type="submit" loading={loading} fullWidth size="lg">
                Set Password & Continue
              </Button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t border-border text-center text-sm text-text-secondary">
            Need help? Contact support at support@{APP_CONFIG.appName.toLowerCase()}.com
          </div>
        </Card>
      </div>
    </div>
  );
};

export default SetPasswordPage;
