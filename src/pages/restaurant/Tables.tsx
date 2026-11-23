import React, { useEffect, useState, useRef } from "react";
import {
  QrCode,
  Plus,
  Trash2,
  Edit,
  RefreshCw,
  Download,
  Users,
  Copy,
  Check,
  Sparkles,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { useAuth } from "../../context/AuthContext";
import {
  subscribeToTables,
  createRestaurantTable,
  updateRestaurantTable,
  deleteRestaurantTable,
  regenerateTableQR,
} from "../../services/restaurantService";
import type { RestaurantTable } from "../../config/supabase";
import { restaurantTableSchema } from "../../schemas/tableSchema";
import { Card, Button, Input, Modal, Loading, Alert } from "../../components/ui";
import { copyToClipboard } from "../../utils/helpers";
import { usePlanLimits, UpgradePlanBanner } from "../../hooks/usePlanLimits";

// Helper to synchronously read cached tables for zero-delay hydration
const getCachedTables = (restId: string | null): RestaurantTable[] => {
  if (!restId || typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(`amarmenu_tables_cache_${restId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const TablesPage: React.FC = () => {
  const { restaurant, user, loading: authLoading } = useAuth();
  const planLimits = usePlanLimits();
  const initialRestId =
    restaurant?.id ||
    (() => {
      try {
        const raw = sessionStorage.getItem("current_restaurant");
        return raw ? JSON.parse(raw)?.id || "" : "";
      } catch {
        return "";
      }
    })();

  const [tables, setTables] = useState<RestaurantTable[]>(() => getCachedTables(initialRestId));
  const [loading, setLoading] = useState<boolean>(() => tables.length === 0);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Modals state
  const [showAddEditModal, setShowAddEditModal] = useState(false);
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null);
  const [showQRModal, setShowQRModal] = useState(false);
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [tableToDelete, setTableToDelete] = useState<RestaurantTable | null>(null);
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [tableToRegen, setTableToRegen] = useState<RestaurantTable | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    table_number: "",
    capacity: 4,
    is_active: true,
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Ref for PDF export
  const singleCardRef = useRef<HTMLDivElement>(null);
  const bulkPrintRef = useRef<HTMLDivElement>(null);

  // Real-time subscription to restaurant tables
  useEffect(() => {
    if (authLoading && tables.length === 0) {
      setLoading(true);
      return;
    }
    if (!restaurant?.id || !user) return;

    if (tables.length === 0) {
      setLoading(true);
    }
    const subscription = subscribeToTables(restaurant.id, (data) => {
      setTables(data);
      setLoading(false);
      try {
        if (restaurant.id && data.length > 0) {
          sessionStorage.setItem(`amarmenu_tables_cache_${restaurant.id}`, JSON.stringify(data));
        }
      } catch {
        // ignore
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [restaurant?.id, user?.id, authLoading]);

  const getTableUrl = (qrToken: string) => {
    const origin = window.location.origin;
    return `${origin}/menu/${restaurant?.slug}?table=${qrToken}`;
  };

  const handleCopyLink = async (qrToken: string) => {
    const url = getTableUrl(qrToken);
    const success = await copyToClipboard(url);
    if (success) {
      setCopiedToken(qrToken);
      setTimeout(() => setCopiedToken(null), 2000);
    }
  };

  // Open Add/Edit Modal
  const handleOpenAdd = () => {
    if (!planLimits.canAddTable(tables.length)) {
      setError(
        `Your ${planLimits.planName} plan limit of ${planLimits.maxTables} tables has been reached. Please upgrade your subscription to add more tables.`
      );
      return;
    }
    setEditingTable(null);
    setFormData({
      table_number: `Table ${tables.length + 1}`,
      capacity: 4,
      is_active: true,
    });
    setFormErrors({});
    setError("");
    setShowAddEditModal(true);
  };

  const handleOpenEdit = (table: RestaurantTable) => {
    setEditingTable(table);
    setFormData({
      table_number: table.table_number,
      capacity: table.capacity,
      is_active: table.is_active,
    });
    setFormErrors({});
    setError("");
    setShowAddEditModal(true);
  };

  const handleSaveTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurant?.id) return;

    // Validate with Zod
    const validation = restaurantTableSchema.safeParse(formData);
    if (!validation.success) {
      const errMap: Record<string, string> = {};
      validation.error.issues.forEach((issue) => {
        const path = issue.path.join(".");
        errMap[path] = issue.message;
      });
      setFormErrors(errMap);
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      if (editingTable) {
        // Update table
        const res = await updateRestaurantTable(editingTable.id, {
          table_number: validation.data.table_number,
          capacity: validation.data.capacity,
          is_active: validation.data.is_active,
        });

        if (res.success) {
          setSuccessMsg(`Table "${validation.data.table_number}" updated successfully.`);
          setShowAddEditModal(false);
          setTimeout(() => setSuccessMsg(""), 3000);
        } else {
          setError(res.error || "Failed to update table.");
        }
      } else {
        // Create table
        const res = await createRestaurantTable({
          restaurant_id: restaurant.id,
          table_number: validation.data.table_number,
          capacity: validation.data.capacity,
          is_active: validation.data.is_active,
        });

        if (res.success) {
          setSuccessMsg(`Table "${validation.data.table_number}" created successfully.`);
          setShowAddEditModal(false);
          setTimeout(() => setSuccessMsg(""), 3000);
        } else {
          setError(res.error || "Failed to create table. (Table number may already exist)");
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle table active status directly
  const handleToggleActive = async (table: RestaurantTable) => {
    await updateRestaurantTable(table.id, { is_active: !table.is_active });
  };

  // Soft Delete Table
  const handleConfirmDelete = async () => {
    if (!tableToDelete) return;
    setIsSubmitting(true);
    const success = await deleteRestaurantTable(tableToDelete.id);
    setIsSubmitting(false);
    setShowDeleteModal(false);

    if (success) {
      setSuccessMsg(`Table "${tableToDelete.table_number}" deleted.`);
      setTimeout(() => setSuccessMsg(""), 3000);
    } else {
      setError("Failed to delete table.");
    }
  };

  // Regenerate QR Token
  const handleConfirmRegen = async () => {
    if (!tableToRegen) return;
    setIsSubmitting(true);
    const res = await regenerateTableQR(tableToRegen.id);
    setIsSubmitting(false);
    setShowRegenModal(false);

    if (res.success) {
      setSuccessMsg(`QR code token for "${tableToRegen.table_number}" has been regenerated.`);
      if (selectedTable?.id === tableToRegen.id) {
        setSelectedTable({ ...selectedTable, qr_token: res.token });
      }
      setTimeout(() => setSuccessMsg(""), 3000);
    } else {
      setError(res.error || "Failed to regenerate QR token.");
    }
  };

  // Download Single QR Code PDF
  const handleDownloadSinglePDF = async (table: RestaurantTable) => {
    if (!singleCardRef.current) return;
    setIsGeneratingPDF(true);

    try {
      const canvas = await html2canvas(singleCardRef.current, {
        scale: 3, // crisp high resolution
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: [100, 150], // Standard table tent card size (100mm x 150mm)
      });

      pdf.addImage(imgData, "PNG", 0, 0, 100, 150);
      pdf.save(`${restaurant?.slug || "restaurant"}-${table.table_number.toLowerCase().replace(/\s+/g, "-")}-qr.pdf`);
    } catch (e) {
      console.error("PDF generation failed:", e);
      setError("Failed to generate PDF.");
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  // Download All Active Tables as Single PDF
  const handleDownloadAllPDF = async () => {
    const activeTables = tables.filter((t) => t.is_active);
    if (activeTables.length === 0) {
      setError("No active tables to download.");
      return;
    }

    setIsGeneratingPDF(true);
    try {
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: [100, 150],
      });

      const cards = bulkPrintRef.current?.querySelectorAll<HTMLElement>(".table-card-item");
      if (!cards || cards.length === 0) {
        throw new Error("Card elements not rendered");
      }

      for (let i = 0; i < cards.length; i++) {
        if (i > 0) pdf.addPage([100, 150], "portrait");

        const canvas = await html2canvas(cards[i], {
          scale: 3,
          useCORS: true,
          backgroundColor: "#ffffff",
        });
        const imgData = canvas.toDataURL("image/png");
        pdf.addImage(imgData, "PNG", 0, 0, 100, 150);
      }

      pdf.save(`${restaurant?.slug || "restaurant"}-all-tables-qr.pdf`);
      setSuccessMsg(`Generated QR PDF for all ${activeTables.length} tables.`);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (e) {
      console.error("Bulk PDF export error:", e);
      setError("Failed to generate bulk PDF.");
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  if (loading && tables.length === 0) {
    return <Loading text="Loading tables & QR codes..." />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text flex items-center gap-2">
            <QrCode className="w-7 h-7 text-accent" />
            <span>Tables & QR Management</span>
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Manage your dine-in tables, generate encrypted QR codes, and download printable table tent cards.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {tables.length > 0 && (
            <Button
              variant="outline"
              onClick={handleDownloadAllPDF}
              disabled={isGeneratingPDF}
              className="flex items-center gap-2 text-sm"
            >
              <Download className="w-4 h-4" />
              <span>{isGeneratingPDF ? "Generating PDF..." : "Download All QR (PDF)"}</span>
            </Button>
          )}

          <Button onClick={handleOpenAdd} className="flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" />
            <span>Add Table</span>
          </Button>
        </div>
      </div>

      {/* Plan Limit Banner */}
      {!planLimits.canAddTable(tables.length) && (
        <UpgradePlanBanner
          featureName="Additional Tables"
          currentCount={tables.length}
          maxLimit={planLimits.maxTables}
          requiredPlan={planLimits.planSlug === "starter" ? "growth" : "enterprise"}
        />
      )}

      {/* Notifications */}
      {successMsg && <Alert type="success" message={successMsg} />}
      {error && <Alert type="error" message={error} />}

      {/* Table Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-text-secondary uppercase font-semibold">Total Tables</p>
            <p className="text-2xl font-bold text-text mt-1">
              {tables.length}
              {planLimits.maxTables !== null && (
                <span className="text-xs text-text-secondary font-normal ml-1">
                  / {planLimits.maxTables} max
                </span>
              )}
            </p>
          </div>
          <div className="w-12 h-12 bg-accent/10 rounded-xl flex items-center justify-center text-accent">
            <QrCode className="w-6 h-6" />
          </div>
        </Card>

        <Card className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-text-secondary uppercase font-semibold">Active for Ordering</p>
            <p className="text-2xl font-bold text-success mt-1">
              {tables.filter((t) => t.is_active).length}
            </p>
          </div>
          <div className="w-12 h-12 bg-success/10 rounded-xl flex items-center justify-center text-success">
            <Check className="w-6 h-6" />
          </div>
        </Card>

        <Card className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-text-secondary uppercase font-semibold">Total Seating Capacity</p>
            <p className="text-2xl font-bold text-text mt-1">
              {tables.reduce((sum, t) => sum + (t.is_active ? t.capacity : 0), 0)} Seats
            </p>
          </div>
          <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary">
            <Users className="w-6 h-6" />
          </div>
        </Card>
      </div>

      {/* Tables Grid */}
      {tables.length === 0 ? (
        <Card className="text-center py-16 px-4">
          <QrCode className="w-16 h-16 text-text-secondary mx-auto mb-4 opacity-40" />
          <h3 className="text-lg font-bold text-text mb-1">No Tables Created Yet</h3>
          <p className="text-sm text-text-secondary max-w-md mx-auto mb-6">
            Add your restaurant's tables to automatically generate QR codes. Customers can scan them to view your bilingual menu and place orders directly.
          </p>
          <Button onClick={handleOpenAdd} className="inline-flex items-center gap-2">
            <Plus className="w-4 h-4" />
            <span>Add Your First Table</span>
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tables.map((table) => {
            const tableUrl = getTableUrl(table.qr_token);
            const isCopied = copiedToken === table.qr_token;

            return (
              <Card
                key={table.id}
                className={`overflow-hidden transition-all duration-200 border ${
                  table.is_active ? "border-border hover:border-accent" : "border-border/50 opacity-70 bg-gray-50"
                }`}
              >
                <div className="p-5">
                  {/* Top Bar: Table Number & Status */}
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-text">{table.table_number}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="inline-flex items-center gap-1 text-xs text-text-secondary font-medium">
                          <Users className="w-3.5 h-3.5" />
                          <span>{table.capacity} Persons</span>
                        </span>
                        <span className="text-text-secondary">•</span>
                        {table.status === "occupied" ? (
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-300 animate-pulse">
                            ● Occupied
                          </span>
                        ) : table.status === "reserved" ? (
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-blue-100 text-blue-800 border border-blue-300">
                            Reserved
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            Available
                          </span>
                        )}
                        <span className="text-text-secondary">•</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            table.is_active
                              ? "bg-success/10 text-success"
                              : "bg-gray-200 text-gray-600"
                          }`}
                        >
                          {table.is_active ? "Active" : "Closed"}
                        </span>
                      </div>
                    </div>

                    {/* QR Code Mini Preview */}
                    <button
                      onClick={() => {
                        setSelectedTable(table);
                        setShowQRModal(true);
                      }}
                      className="p-2 bg-white rounded-lg border border-border shadow-sm hover:border-accent hover:shadow transition-all group"
                      title="Click to view printable QR code"
                    >
                      <QRCodeSVG
                        value={tableUrl}
                        size={60}
                        level="M"
                        className="group-hover:scale-105 transition-transform"
                      />
                    </button>
                  </div>

                  {/* Direct Link Preview & Copy */}
                  <div className="bg-bg-subtle rounded-lg p-2.5 flex items-center justify-between text-xs text-text-secondary mb-4">
                    <span className="truncate pr-2 font-mono">
                      /menu/{restaurant?.slug}?table={table.qr_token.slice(0, 8)}...
                    </span>
                    <button
                      onClick={() => handleCopyLink(table.qr_token)}
                      className="text-accent hover:text-accent-dark flex items-center gap-1 font-medium transition-colors shrink-0"
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-success" />
                          <span className="text-success">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Actions Grid */}
                  <div className="pt-3 border-t border-border flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedTable(table);
                          setShowQRModal(true);
                        }}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>View QR</span>
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setTableToRegen(table);
                          setShowRegenModal(true);
                        }}
                        className="text-xs p-1.5 text-text-secondary hover:text-accent"
                        title="Regenerate QR Token (in case QR is leaked or stale)"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggleActive(table)}
                        className={`text-xs px-2 py-1 rounded font-medium transition-colors ${
                          table.is_active
                            ? "text-warning hover:bg-warning/10"
                            : "text-success hover:bg-success/10"
                        }`}
                      >
                        {table.is_active ? "Disable" : "Enable"}
                      </button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleOpenEdit(table)}
                        className="text-xs p-1.5 text-text-secondary hover:text-primary"
                        title="Edit Table"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setTableToDelete(table);
                          setShowDeleteModal(true);
                        }}
                        className="text-xs p-1.5 text-text-secondary hover:text-error"
                        title="Delete Table"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add / Edit Table Modal */}
      <Modal
        isOpen={showAddEditModal}
        onClose={() => setShowAddEditModal(false)}
        title={editingTable ? "Edit Restaurant Table" : "Add New Table"}
        size="md"
      >
        <form onSubmit={handleSaveTable} className="space-y-4">
          {error && <Alert type="error" message={error} />}

          <Input
            label="Table Number / Name"
            name="table_number"
            value={formData.table_number}
            onChange={(e) => setFormData({ ...formData, table_number: e.target.value })}
            placeholder="e.g. Table 01, VIP-2, Balcony-A"
            error={formErrors.table_number}
            required
          />

          <Input
            label="Seating Capacity"
            type="number"
            name="capacity"
            value={formData.capacity.toString()}
            onChange={(e) =>
              setFormData({ ...formData, capacity: parseInt(e.target.value, 10) || 1 })
            }
            min="1"
            max="100"
            error={formErrors.capacity}
            required
          />

          <div className="flex items-center gap-3 pt-2">
            <input
              type="checkbox"
              id="is_active"
              checked={formData.is_active}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              className="w-4 h-4 text-accent border-gray-300 rounded focus:ring-accent"
            />
            <label htmlFor="is_active" className="text-sm font-medium text-text cursor-pointer">
              Active (Customers can scan & order from this table)
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAddEditModal(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : editingTable ? "Save Changes" : "Create Table"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* View Printable QR & Table Tent Modal */}
      <Modal
        isOpen={showQRModal && !!selectedTable}
        onClose={() => setShowQRModal(false)}
        title={`Table QR Code: ${selectedTable?.table_number}`}
        size="lg"
      >
        {selectedTable && (
          <div className="space-y-6">
            {/* Action Bar */}
            <div className="flex items-center justify-between bg-bg-subtle p-3 rounded-lg">
              <div className="text-xs text-text-secondary">
                <span className="font-semibold text-text">Format: </span>
                Printable 100mm × 150mm Table Tent Card
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopyLink(selectedTable.qr_token)}
                  className="text-xs flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Link</span>
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleDownloadSinglePDF(selectedTable)}
                  disabled={isGeneratingPDF}
                  className="text-xs flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isGeneratingPDF ? "Generating..." : "Download PDF"}</span>
                </Button>
              </div>
            </div>

            {/* Visual Table Tent Preview Container */}
            <div className="flex justify-center p-4 bg-gray-100 rounded-xl overflow-x-auto">
              <div
                ref={singleCardRef}
                style={{ width: "378px", height: "567px" }}
                className="bg-white shadow-xl rounded-2xl p-8 flex flex-col items-center justify-between text-center border border-gray-200"
              >
                {/* Brand Header */}
                <div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-accent/10 text-accent rounded-full text-xs font-semibold uppercase tracking-wider mb-2">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AmarMenu Smart Dining</span>
                  </div>
                  <h3 className="text-2xl font-black text-gray-900 leading-tight">
                    {restaurant?.name || "Restaurant"}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {restaurant?.restaurant_type || "Dine-in"}
                  </p>
                </div>

                {/* Table Badge */}
                <div className="w-full my-3">
                  <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white py-2 px-6 rounded-xl shadow-sm">
                    <p className="text-xs uppercase tracking-widest font-bold opacity-90">DINE-IN</p>
                    <p className="text-3xl font-extrabold tracking-tight">{selectedTable.table_number}</p>
                  </div>
                </div>

                {/* High Resolution Crisp QR */}
                <div className="p-4 bg-white rounded-2xl shadow-md border-2 border-dashed border-gray-200">
                  <QRCodeSVG
                    value={getTableUrl(selectedTable.qr_token)}
                    size={190}
                    level="H"
                    includeMargin={false}
                  />
                </div>

                {/* Instructions in Bangla + English */}
                <div className="space-y-1">
                  <p className="text-base font-bold text-gray-800">
                    মেনু দেখতে এবং অর্ডার করতে স্ক্যান করুন
                  </p>
                  <p className="text-xs text-gray-500">
                    Scan with your phone camera to view menu & order
                  </p>
                </div>

                {/* Payment Badge */}
                <div className="pt-3 border-t border-gray-100 w-full flex items-center justify-center gap-3 text-xs text-gray-400">
                  <span>bKash</span>
                  <span>•</span>
                  <span>Nagad</span>
                  <span>•</span>
                  <span>Cash on Counter</span>
                </div>
              </div>
            </div>

            {/* Direct URL Information */}
            <div className="text-xs text-text-secondary text-center break-all font-mono bg-bg-subtle p-2 rounded">
              {getTableUrl(selectedTable.qr_token)}
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal && !!tableToDelete}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Restaurant Table"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-text-secondary text-sm">
            Are you sure you want to delete{" "}
            <span className="font-bold text-text">"{tableToDelete?.table_number}"</span>?
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
            <strong>Note:</strong> Past customer orders from this table will remain safely preserved in reports. The QR code will be deactivated immediately.
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button
              variant="outline"
              onClick={() => setShowDeleteModal(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmDelete}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Deleting..." : "Confirm Delete"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Regenerate Token Confirmation Modal */}
      <Modal
        isOpen={showRegenModal && !!tableToRegen}
        onClose={() => setShowRegenModal(false)}
        title="Regenerate QR Token"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-text-secondary text-sm">
            Are you sure you want to regenerate the QR code for{" "}
            <span className="font-bold text-text">"{tableToRegen?.table_number}"</span>?
          </p>
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
            <strong>Warning:</strong> Any printed QR codes with the current token will immediately stop working. You will need to reprint and replace the table tent.
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button
              variant="outline"
              onClick={() => setShowRegenModal(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmRegen}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Regenerating..." : "Regenerate Token"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Hidden Container for Bulk PDF Rendering */}
      <div
        ref={bulkPrintRef}
        style={{ position: "absolute", left: "-9999px", top: "-9999px" }}
      >
        {tables
          .filter((t) => t.is_active)
          .map((table) => (
            <div
              key={table.id}
              className="table-card-item bg-white p-8 flex flex-col items-center justify-between text-center"
              style={{ width: "378px", height: "567px" }}
            >
              <div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-orange-100 text-orange-600 rounded-full text-xs font-semibold uppercase tracking-wider mb-2">
                  <span>AmarMenu Smart Dining</span>
                </div>
                <h3 className="text-2xl font-black text-gray-900 leading-tight">
                  {restaurant?.name || "Restaurant"}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {restaurant?.restaurant_type || "Dine-in"}
                </p>
              </div>

              <div className="w-full my-3">
                <div className="bg-orange-500 text-white py-2 px-6 rounded-xl">
                  <p className="text-xs uppercase tracking-widest font-bold opacity-90">DINE-IN</p>
                  <p className="text-3xl font-extrabold tracking-tight">{table.table_number}</p>
                </div>
              </div>

              <div className="p-4 bg-white rounded-2xl border-2 border-dashed border-gray-200">
                <QRCodeSVG
                  value={getTableUrl(table.qr_token)}
                  size={190}
                  level="H"
                  includeMargin={false}
                />
              </div>

              <div className="space-y-1">
                <p className="text-base font-bold text-gray-800">
                  মেনু দেখতে এবং অর্ডার করতে স্ক্যান করুন
                </p>
                <p className="text-xs text-gray-500">
                  Scan with your phone camera to view menu & order
                </p>
              </div>

              <div className="pt-3 border-t border-gray-100 w-full flex items-center justify-center gap-3 text-xs text-gray-400">
                <span>bKash</span>
                <span>•</span>
                <span>Nagad</span>
                <span>•</span>
                <span>Cash on Counter</span>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
};

export default TablesPage;
