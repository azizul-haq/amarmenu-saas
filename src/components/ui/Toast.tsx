import React, { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const duration = toast.duration ?? 4000;
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => onDismiss(toast.id), 200);
    }, duration);

    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  };

  const styles = {
    success: {
      bg: "bg-emerald-50",
      border: "border-emerald-300",
      text: "text-emerald-900",
      iconColor: "text-emerald-600",
      icon: CheckCircle2,
    },
    error: {
      bg: "bg-rose-50",
      border: "border-rose-300",
      text: "text-rose-900",
      iconColor: "text-rose-600",
      icon: AlertCircle,
    },
    warning: {
      bg: "bg-amber-50",
      border: "border-amber-300",
      text: "text-amber-900",
      iconColor: "text-amber-600",
      icon: AlertTriangle,
    },
    info: {
      bg: "bg-blue-50",
      border: "border-blue-300",
      text: "text-blue-900",
      iconColor: "text-blue-600",
      icon: Info,
    },
  };

  const config = styles[toast.type] || styles.info;
  const Icon = config.icon;

  return (
    <div
      role={toast.type === "error" ? "alert" : "status"}
      aria-live={toast.type === "error" ? "assertive" : "polite"}
      className={`pointer-events-auto flex items-start gap-3 w-full max-w-sm rounded-xl border p-3.5 shadow-lg backdrop-blur-xs transition-all duration-200 ${
        config.bg
      } ${config.border} ${
        isExiting
          ? "opacity-0 -translate-y-2 scale-95"
          : "opacity-100 translate-y-0 scale-100 animate-in fade-in slide-in-from-top-2"
      }`}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${config.iconColor}`} />
      <div className={`flex-1 text-xs sm:text-sm font-medium leading-snug break-words ${config.text}`}>
        {toast.message}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="p-1 -mr-1 -mt-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-black/5 transition-colors"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
