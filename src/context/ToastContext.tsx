import React, { createContext, useContext, useState, useCallback } from "react";
import { Toast, type ToastItem, type ToastType } from "../components/ui/Toast";
import { generateUUID } from "../utils/uuid";

export interface ToastContextType {
  showToast: (options: { type: ToastType; message: string; duration?: number }) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ type, message, duration = 4000 }: { type: ToastType; message: string; duration?: number }) => {
      const id = generateUUID();
      setToasts((prev) => [...prev, { id, type, message, duration }]);
    },
    []
  );

  const success = useCallback(
    (message: string, duration?: number) => showToast({ type: "success", message, duration }),
    [showToast]
  );
  const error = useCallback(
    (message: string, duration?: number) => showToast({ type: "error", message, duration }),
    [showToast]
  );
  const info = useCallback(
    (message: string, duration?: number) => showToast({ type: "info", message, duration }),
    [showToast]
  );
  const warning = useCallback(
    (message: string, duration?: number) => showToast({ type: "warning", message, duration }),
    [showToast]
  );

  return (
    <ToastContext.Provider value={{ showToast, success, error, info, warning }}>
      {children}
      {/* Global Toast Viewport Container */}
      <div
        aria-live="polite"
        className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none max-w-sm w-full px-4 sm:px-0"
      >
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};
