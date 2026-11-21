import React, { useEffect, useState } from "react";
import {
  Phone,
  Mail,
  MapPin,
  Store as StoreIcon,
  CheckCircle,
  X,
  Clock,
  AlertCircle,
  MailCheck,
  Send,
} from "lucide-react";
import {
  Card,
  Button,
  Modal,
  Input,
  Select,
  Textarea,
  Alert,
  Badge,
  Loading,
} from "../../components/ui";
import {
  subscribeToPendingRequests,
  createRestaurantAccount,
  rejectRegistrationRequest,
  resendRestaurantInvite,
  type ApprovalResult,
} from "../../services/adminService";
import type { RegistrationRequest } from "../../config/supabase";
import { formatDateTime } from "../../utils/helpers";
import { APP_CONFIG } from "../../config/config";

const PendingRequests: React.FC = () => {
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] =
    useState<RegistrationRequest | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [approvalResult, setApprovalResult] = useState<ApprovalResult | null>(null);

  // Real-time subscription
  useEffect(() => {
    const subscription = subscribeToPendingRequests((data) => {
      setRequests(data);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleCreateAccount = (request: RegistrationRequest) => {
    setSelectedRequest(request);
    setShowCreateModal(true);
  };

  const handleReject = (request: RegistrationRequest) => {
    setSelectedRequest(request);
    setShowRejectModal(true);
  };

  if (loading) {
    return <Loading text="Loading pending requests..." />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text mb-2">
            Pending Requests
          </h2>
          <p className="text-text-secondary">
            Review and approve restaurant registrations
          </p>
        </div>
        <Badge variant="warning" className="text-lg px-4 py-2">
          {requests.length} Pending
        </Badge>
      </div>

      {/* Real-time indicator */}
      {requests.length > 0 && (
        <div className="flex items-center space-x-2 text-sm text-success">
          <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
          <span>Live updates enabled</span>
        </div>
      )}

      {/* Requests List */}
      {requests.length === 0 ? (
        <Card className="text-center py-12">
          <CheckCircle className="w-16 h-16 text-success mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-text mb-2">
            All Caught Up!
          </h3>
          <p className="text-text-secondary">
            No pending registration requests at the moment.
          </p>
        </Card>
      ) : (
        <div className="grid gap-6">
          {requests.map((request) => (
            <Card
              key={request.id}
              className="hover:shadow-lg transition-shadow"
            >
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                {/* Request Details */}
                <div className="flex-1 space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-xl font-bold text-text mb-1">
                        {request.restaurant_name}
                      </h3>
                      <Badge variant="neutral">{request.restaurant_type}</Badge>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-text-secondary flex items-center justify-end">
                        <Clock className="w-4 h-4 mr-1" />
                        {formatDateTime(request.created_at)}
                      </p>
                    </div>
                  </div>

                  {/* Contact Info */}
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="flex items-center space-x-2 text-text-secondary">
                      <StoreIcon className="w-4 h-4" />
                      <span className="font-medium text-text">
                        {request.owner_name}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 text-text-secondary">
                      <Phone className="w-4 h-4" />
                      <a
                        href={`tel:${request.phone}`}
                        className="text-accent hover:underline"
                      >
                        {request.phone}
                      </a>
                    </div>
                    {request.email && (
                      <div className="flex items-center space-x-2 text-text-secondary">
                        <Mail className="w-4 h-4" />
                        <a
                          href={`mailto:${request.email}`}
                          className="text-accent hover:underline truncate"
                        >
                          {request.email}
                        </a>
                      </div>
                    )}
                    <div className="flex items-center space-x-2 text-text-secondary">
                      <MapPin className="w-4 h-4" />
                      <span>
                        {request.city}
                        {request.address && `, ${request.address}`}
                      </span>
                    </div>
                  </div>

                  {/* Additional Info */}
                  {(request.heard_from || request.notes) && (
                    <div className="bg-bg-subtle rounded-lg p-3 space-y-2 text-sm">
                      {request.heard_from && (
                        <p className="text-text-secondary">
                          <strong className="text-text">Heard from:</strong>{" "}
                          {request.heard_from}
                        </p>
                      )}
                      {request.notes && (
                        <p className="text-text-secondary">
                          <strong className="text-text">Notes:</strong>{" "}
                          {request.notes}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex md:flex-col gap-2 md:min-w-[140px]">
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    icon={<CheckCircle className="w-4 h-4" />}
                    onClick={() => handleCreateAccount(request)}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    fullWidth
                    icon={<X className="w-4 h-4" />}
                    onClick={() => handleReject(request)}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create Account Modal */}
      <CreateAccountModal
        isOpen={showCreateModal}
        request={selectedRequest}
        onClose={() => {
          setShowCreateModal(false);
          setSelectedRequest(null);
        }}
        onSuccess={(result) => {
          setShowCreateModal(false);
          setApprovalResult(result);
          setShowCredentialsModal(true);
        }}
      />

      {/* Reject Modal */}
      <RejectModal
        isOpen={showRejectModal}
        request={selectedRequest}
        onClose={() => {
          setShowRejectModal(false);
          setSelectedRequest(null);
        }}
      />

      {/* Approval & Onboarding Display Modal */}
      <ApprovalSuccessModal
        isOpen={showCredentialsModal}
        result={approvalResult}
        onClose={() => {
          setShowCredentialsModal(false);
          setApprovalResult(null);
        }}
      />
    </div>
  );
};

// Create Account Modal Component
interface CreateAccountModalProps {
  isOpen: boolean;
  request: RegistrationRequest | null;
  onClose: () => void;
  onSuccess: (result: ApprovalResult) => void;
}

const CreateAccountModal: React.FC<CreateAccountModalProps> = ({
  isOpen,
  request,
  onClose,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    email: "",
    subscriptionPlan: "growth",
    internalNotes: "",
  });

  useEffect(() => {
    if (request) {
      setFormData((prev) => ({
        ...prev,
        email: request.email || "",
      }));
    }
  }, [request]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!formData.email) {
      setError("Email is required");
      return;
    }

    if (!request) return;

    setLoading(true);
    const result = await createRestaurantAccount(request.id, {
      email: formData.email,
      subscriptionPlan: formData.subscriptionPlan,
      internalNotes: formData.internalNotes,
    });

    setLoading(false);

    if (result.success) {
      onSuccess(result);
    } else {
      setError(result.error || "Failed to create account");
    }
  };

  if (!request) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Restaurant Account"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <Alert type="error" message={error} />}

        {/* Restaurant Info */}
        <div className="bg-bg-subtle rounded-lg p-4">
          <h4 className="font-semibold text-text mb-2">Restaurant Details</h4>
          <div className="space-y-1 text-sm">
            <p className="text-text">
              <strong>Name:</strong> {request.restaurant_name}
            </p>
            <p className="text-text-secondary">
              <strong>Owner:</strong> {request.owner_name}
            </p>
            <p className="text-text-secondary">
              <strong>Phone:</strong> {request.phone}
            </p>
            <p className="text-text-secondary">
              <strong>City:</strong> {request.city}
            </p>
          </div>
        </div>

        {/* Account Details */}
        <Input
          label="Email Address"
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          placeholder="owner@restaurant.com"
          required
          helperText="An invitation will be sent to this email address"
        />

        <Select
          label="Subscription Plan"
          value={formData.subscriptionPlan}
          onChange={(e) =>
            setFormData({ ...formData, subscriptionPlan: e.target.value })
          }
          options={Object.keys(APP_CONFIG.plans).map((key) => {
            const p = APP_CONFIG.plans[key as keyof typeof APP_CONFIG.plans];
            return {
              value: key,
              label: `${p.name} (৳${p.price.toLocaleString()}/mo - ${p.freeTrialDays}-day trial)`,
            };
          })}
        />

        <Textarea
          label="Internal Notes (Optional)"
          value={formData.internalNotes}
          onChange={(e) =>
            setFormData({ ...formData, internalNotes: e.target.value })
          }
          placeholder="Add any internal notes..."
          rows={2}
        />

        {/* Email Dispatch Info */}
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm flex items-start gap-2.5">
          <Mail className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <span className="text-text-secondary">
            An onboarding invitation email with a secure password setup link will be automatically sent to{" "}
            <strong className="text-text">{formData.email || "the owner's email"}</strong>.
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={onClose} fullWidth>
            Cancel
          </Button>
          <Button type="submit" loading={loading} fullWidth>
            Approve & Send Invitation Email
          </Button>
        </div>
      </form>
    </Modal>
  );
};

// Reject Modal Component
interface RejectModalProps {
  isOpen: boolean;
  request: RegistrationRequest | null;
  onClose: () => void;
}

const RejectModal: React.FC<RejectModalProps> = ({
  isOpen,
  request,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const handleReject = async () => {
    if (!reason.trim()) {
      setError("Please provide a reason for rejection");
      return;
    }

    if (!request) return;

    setLoading(true);
    const success = await rejectRegistrationRequest(request.id, reason);
    setLoading(false);

    if (success) {
      onClose();
      setReason("");
    } else {
      setError("Failed to reject request");
    }
  };

  if (!request) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reject Registration"
      size="md"
    >
      <div className="space-y-4">
        {error && <Alert type="error" message={error} />}

        <p className="text-text-secondary">
          Are you sure you want to reject the registration for{" "}
          <strong className="text-text">{request.restaurant_name}</strong>?
        </p>

        <Textarea
          label="Reason for Rejection"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError("");
          }}
          placeholder="Please provide a reason..."
          required
          rows={3}
        />

        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={onClose} fullWidth>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleReject}
            loading={loading}
            fullWidth
          >
            Reject Registration
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// Approval Confirmation & Onboarding Modal (Email-Only Flow)
interface ApprovalSuccessModalProps {
  isOpen: boolean;
  result: ApprovalResult | null;
  onClose: () => void;
}

const ApprovalSuccessModal: React.FC<ApprovalSuccessModalProps> = ({
  isOpen,
  result,
  onClose,
}) => {
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  if (!result) return null;

  const isEmailSent = result.emailSent !== false && !result.emailError;

  const handleResend = async () => {
    if (!result.restaurant?.id) return;
    setResending(true);
    setResendMessage(null);
    setResendError(null);
    try {
      const res = await resendRestaurantInvite(result.restaurant.id);
      if (res.success) {
        setResendMessage(res.message || `Invitation email resent to ${result.email || "owner"}.`);
      } else {
        setResendError(res.error || "Failed to resend email.");
      }
    } catch (err: unknown) {
      setResendError(err instanceof Error ? err.message : "Error resending invitation email");
    } finally {
      setResending(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEmailSent ? "Restaurant Approved & Email Sent!" : "Restaurant Approved"}
      size="md"
    >
      <div className="space-y-6">
        {/* Success Icon & Header */}
        <div className="text-center">
          <div
            className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${
              isEmailSent ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
            }`}
          >
            {isEmailSent ? (
              <MailCheck className="w-10 h-10 text-emerald-600" />
            ) : (
              <AlertCircle className="w-10 h-10 text-amber-600" />
            )}
          </div>
          <h3 className="text-xl font-bold text-text">
            {result.restaurant?.name || "Restaurant"}
          </h3>
          <p className="text-sm text-text-secondary mt-1">
            {isEmailSent ? (
              <>
                An onboarding invitation with a secure password setup link has been automatically sent to{" "}
                <strong className="text-text font-semibold">{result.email}</strong>.
              </>
            ) : (
              <>Restaurant created, but email dispatch reported an issue.</>
            )}
          </p>
        </div>

        {/* Email Error Alert if email dispatch failed */}
        {!isEmailSent && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 text-sm text-red-700 space-y-1">
            <div className="font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>Email Delivery Failed:</span>
            </div>
            <p className="text-xs text-red-600 ml-6 break-words">
              {result.emailError || "Could not deliver email via configured SMTP settings."}
            </p>
          </div>
        )}

        {/* Resend Status feedback */}
        {resendMessage && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{resendMessage}</span>
          </div>
        )}

        {resendError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{resendError}</span>
          </div>
        )}

        {/* Restaurant Summary Details */}
        <div className="bg-bg-subtle rounded-xl p-4 border border-border/50 space-y-2.5 text-sm">
          <h4 className="font-semibold text-text text-xs uppercase tracking-wider text-text-secondary">
            Onboarding Summary
          </h4>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-text-secondary block">Owner:</span>
              <span className="font-medium text-text">{result.ownerName || "Owner"}</span>
            </div>
            <div>
              <span className="text-text-secondary block">Owner Email:</span>
              <span className="font-medium text-text truncate block">{result.email}</span>
            </div>
            <div>
              <span className="text-text-secondary block">Restaurant Slug:</span>
              <span className="font-mono text-accent font-medium">{result.restaurant?.slug}</span>
            </div>
            <div>
              <span className="text-text-secondary block">Email Status:</span>
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  isEmailSent ? "text-emerald-600" : "text-amber-600"
                }`}
              >
                {isEmailSent ? "Dispatched" : "Pending / Retry"}
              </span>
            </div>
          </div>
        </div>

        {/* Information Notice */}
        <div className="bg-blue-50 border border-blue-200/60 rounded-lg p-3 text-xs text-blue-800 flex items-start gap-2">
          <Mail className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <span>
            The owner will receive an email with instructions to set their permanent password and access their restaurant POS and dashboard directly.
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          {result.restaurant?.id && (
            <Button
              type="button"
              variant="outline"
              onClick={handleResend}
              loading={resending}
              icon={<Send className="w-4 h-4" />}
              fullWidth
            >
              Resend Email
            </Button>
          )}
          <Button onClick={onClose} fullWidth>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default PendingRequests;
