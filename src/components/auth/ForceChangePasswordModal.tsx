import React, { useState } from "react";
import { KeyRound, ShieldAlert, Eye, EyeOff } from "lucide-react";
import { Button, Input, Alert } from "../ui";
import { supabase } from "../../config/supabase";

interface ForceChangePasswordModalProps {
  isOpen: boolean;
  onPasswordChanged?: () => void;
}

export const ForceChangePasswordModal: React.FC<ForceChangePasswordModalProps> = ({
  isOpen,
  onPasswordChanged,
}) => {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 10) {
      setError("Password must be at least 10 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      // Single-step atomic password update + must_change_password clearing via Edge Function
      const { data, error: fnErr } = await supabase.functions.invoke("change-own-password", {
        body: {
          new_password: newPassword,
        },
      });

      if (fnErr || data?.error) {
        throw new Error(fnErr?.message || data?.error || "Failed to update password");
      }

      // Refresh user session so app_metadata.must_change_password is updated locally
      await supabase.auth.refreshSession();

      if (onPasswordChanged) {
        onPasswordChanged();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update password";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200 space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 text-purple-700">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Security Requirement: Update Password</h2>
            <p className="text-xs text-slate-500 mt-1">
              You are logging in with a temporary password. You must set a permanent password to continue.
            </p>
          </div>
        </div>

        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 text-amber-600 mt-0.5" />
          <span>
            Choose a strong password containing at least 10 characters. Avoid common or easily guessable passwords. You will use this password for all future logins.
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input
              label="New Password"
              type={showPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••••"
              required
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
          </div>

          <div>
            <Input
              label="Confirm New Password"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••••"
              required
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
          </div>

          <div className="pt-2">
            <Button
              type="submit"
              variant="primary"
              className="w-full justify-center bg-purple-600 hover:bg-purple-700"
              loading={loading}
            >
              Set Permanent Password & Continue
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
