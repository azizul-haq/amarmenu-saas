import React from "react";
import { Printer, X, FileSpreadsheet } from "lucide-react";
import type { ZReportData } from "../../config/supabase";
import { formatCurrency, formatDateTime } from "../../utils/helpers";
import { Button } from "../ui";

interface ZReportModalProps {
  report: ZReportData;
  onClose: () => void;
  onPrint?: () => void;
}

export const ZReportModal: React.FC<ZReportModalProps> = ({
  report,
  onClose,
  onPrint,
}) => {
  const handlePrint = () => {
    if (onPrint) onPrint();
    window.print();
  };

  const handleDownloadCSV = () => {
    const r = report;
    const csvContent = [
      ["AMARMENU FISCAL END-OF-DAY (EOD) Z-REPORT"],
      ["Report Number", r.z_report_number],
      ["Restaurant", r.restaurant.name],
      ["VAT BIN", r.restaurant.vat_bin_no || "N/A"],
      ["Trade License", r.restaurant.trade_license_no || "N/A"],
      ["Shift Opened At", r.timings.opened_at],
      ["Shift Opened By", r.timings.opened_by],
      ["Shift Closed At", r.timings.closed_at],
      ["Shift Closed By", r.timings.closed_by],
      [],
      ["CASH DRAWER RECONCILIATION"],
      ["Opening Float", r.cash_reconciliation.opening_float],
      ["Cash Sales Collected (+)", r.cash_reconciliation.cash_sales],
      ["System Expected Cash", r.cash_reconciliation.expected_cash],
      ["Actual Counted Cash", r.cash_reconciliation.actual_cash_counted],
      ["Discrepancy (Overage/Shortage)", r.cash_reconciliation.discrepancy],
      [],
      ["SALES SUMMARY"],
      ["Gross Sales", r.sales_summary.gross_sales],
      ["Cash Sales", r.sales_summary.cash_sales],
      ["Digital Sales", r.sales_summary.digital_sales],
      ["bKash Sales", r.sales_summary.bkash_sales],
      ["Nagad Sales", r.sales_summary.nagad_sales],
      ["Card Sales", r.sales_summary.card_sales],
      ["Tax / VAT Collected", r.sales_summary.tax_collected],
      ["Discount Total", r.sales_summary.discount_total],
      [],
      ["ORDER STATISTICS"],
      ["Completed Orders Count", r.sales_summary.completed_orders_count],
      ["Dine-In Orders Count", r.sales_summary.dine_in_orders_count],
      ["Takeaway Orders Count", r.sales_summary.takeaway_orders_count],
      ["Manager Voided Orders Count", r.sales_summary.voided_orders_count],
      ["Notes", r.notes || ""],
    ]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${r.z_report_number}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const { cash_reconciliation: cr, sales_summary: ss, timings, restaurant } = report;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      {/* Container */}
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden print:shadow-none print:max-w-none print:w-auto">
        {/* Header (Hidden on Print) */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white print:hidden">
          <div className="flex items-center gap-2">
            <Printer className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-xs uppercase tracking-wider">
              Fiscal Z-Report Preview (80mm)
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Printable 80mm Thermal Slip */}
        <div
          id="z-report-print-area"
          className="p-6 bg-white font-mono text-gray-900 text-xs selection:bg-none print:p-0 print:m-0 print:w-[80mm]"
        >
          {/* Restaurant Header */}
          <div className="text-center border-b border-dashed border-gray-400 pb-3">
            {restaurant.logo_url && (
              <div className="flex justify-center mb-2">
                <img
                  src={restaurant.logo_url}
                  alt={restaurant.name}
                  className="max-h-12 max-w-[120px] object-contain filter grayscale contrast-125 print:max-h-12"
                />
              </div>
            )}
            <h2 className="text-base font-black tracking-tight uppercase">
              {restaurant.name}
            </h2>
            {restaurant.name_bn && (
              <p className="text-xs font-bangla font-semibold text-gray-700">
                {restaurant.name_bn}
              </p>
            )}
            {restaurant.address && (
              <p className="text-[10px] text-gray-600 mt-0.5 leading-tight">
                {restaurant.address}
              </p>
            )}
            {restaurant.phone && (
              <p className="text-[10px] text-gray-600">Tel: {restaurant.phone}</p>
            )}

            <div className="mt-1.5 pt-1.5 border-t border-dotted border-gray-300 text-[10px] text-gray-800 space-y-0.5">
              {restaurant.vat_bin_no && (
                <p className="font-bold">BIN: {restaurant.vat_bin_no}</p>
              )}
              {restaurant.trade_license_no && (
                <p>Trade Lic: {restaurant.trade_license_no}</p>
              )}
              <div className="py-1 my-1 border-y border-dashed border-black font-black text-sm tracking-wider">
                *** END OF DAY Z-REPORT ***
              </div>
              <p className="font-bold">{report.z_report_number}</p>
            </div>
          </div>

          {/* Timings & Cashiers */}
          <div className="py-2.5 border-b border-dashed border-gray-400 space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span>OPENED:</span>
              <span>{formatDateTime(timings.opened_at)}</span>
            </div>
            <div className="flex justify-between">
              <span>OPENED BY:</span>
              <span className="font-bold">{timings.opened_by}</span>
            </div>
            <div className="flex justify-between">
              <span>CLOSED:</span>
              <span>{formatDateTime(timings.closed_at)}</span>
            </div>
            <div className="flex justify-between">
              <span>CLOSED BY:</span>
              <span className="font-bold">{timings.closed_by}</span>
            </div>
          </div>

          {/* Drawer Reconciliation */}
          <div className="py-2.5 border-b-2 border-gray-900 space-y-1 text-xs">
            <div className="font-bold pb-1 text-center border-b border-gray-300 text-[11px]">
              -- CASH DRAWER RECONCILIATION --
            </div>
            <div className="flex justify-between">
              <span>Opening Float:</span>
              <span>{formatCurrency(cr.opening_float)}</span>
            </div>
            <div className="flex justify-between">
              <span>Cash Sales (+):</span>
              <span className="font-semibold">{formatCurrency(cr.cash_sales)}</span>
            </div>
            <div className="flex justify-between font-bold pt-1 border-t border-dotted border-gray-300">
              <span>EXPECTED CASH:</span>
              <span>{formatCurrency(cr.expected_cash)}</span>
            </div>
            <div className="flex justify-between font-black">
              <span>COUNTED CASH:</span>
              <span>{formatCurrency(cr.actual_cash_counted)}</span>
            </div>
            <div className="flex justify-between font-black text-sm pt-1 border-t border-gray-900">
              <span>DISCREPANCY:</span>
              <span
                className={
                  cr.has_shortage
                    ? "text-red-700"
                    : cr.has_overage
                    ? "text-emerald-700"
                    : ""
                }
              >
                {cr.has_shortage ? "-" : cr.has_overage ? "+" : ""}
                {formatCurrency(Math.abs(cr.discrepancy))}
              </span>
            </div>
          </div>

          {/* Sales Breakdown by Tender */}
          <div className="py-2.5 border-b border-dashed border-gray-400 space-y-1 text-xs">
            <div className="font-bold pb-1 text-center border-b border-gray-300 text-[11px]">
              -- SALES BY PAYMENT MODE --
            </div>
            <div className="flex justify-between">
              <span>Cash:</span>
              <span className="font-bold">{formatCurrency(ss.cash_sales)}</span>
            </div>
            <div className="flex justify-between">
              <span>bKash:</span>
              <span>{formatCurrency(ss.bkash_sales)}</span>
            </div>
            <div className="flex justify-between">
              <span>Nagad:</span>
              <span>{formatCurrency(ss.nagad_sales)}</span>
            </div>
            <div className="flex justify-between">
              <span>Card:</span>
              <span>{formatCurrency(ss.card_sales)}</span>
            </div>
            <div className="flex justify-between font-bold pt-1 border-t border-dotted border-gray-300">
              <span>Total Digital Tender:</span>
              <span>{formatCurrency(ss.digital_sales)}</span>
            </div>
            <div className="flex justify-between font-black text-sm pt-1 border-t border-gray-900">
              <span>GROSS SALES:</span>
              <span>{formatCurrency(ss.gross_sales)}</span>
            </div>
          </div>

          {/* Taxes, Discounts & Statistics */}
          <div className="py-2.5 border-b-2 border-gray-900 space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span>Total VAT / Tax Collected:</span>
              <span className="font-bold">{formatCurrency(ss.tax_collected)}</span>
            </div>
            <div className="flex justify-between">
              <span>Total Discounts Given:</span>
              <span className="font-bold">{formatCurrency(ss.discount_total)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-dotted border-gray-300">
              <span>Completed Orders:</span>
              <span className="font-bold">{ss.completed_orders_count}</span>
            </div>
            <div className="flex justify-between pl-2 text-[10px] text-gray-600">
              <span>› Dine-in Orders:</span>
              <span>{ss.dine_in_orders_count}</span>
            </div>
            <div className="flex justify-between pl-2 text-[10px] text-gray-600">
              <span>› Takeaway / Counter:</span>
              <span>{ss.takeaway_orders_count}</span>
            </div>
            <div className="flex justify-between text-red-700 font-bold">
              <span>Voided Orders Count:</span>
              <span>{ss.voided_orders_count}</span>
            </div>
          </div>

          {/* Signatures */}
          <div className="pt-6 pb-2 grid grid-cols-2 gap-4 text-center text-[10px] text-gray-700">
            <div>
              <div className="border-t border-gray-500 pt-1">Cashier Signature</div>
            </div>
            <div>
              <div className="border-t border-gray-500 pt-1">Manager Signature</div>
            </div>
          </div>

          {/* Footer */}
          <div className="pt-3 text-center text-[9px] text-gray-400">
            Generated via AmarMenu POS &bull; amarmenu.com
          </div>
        </div>

        {/* Action Controls (Hidden on Print) */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex flex-col gap-2 print:hidden">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleDownloadCSV}
              fullWidth
              className="flex items-center justify-center gap-1.5 text-xs font-bold text-gray-700"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Download CSV</span>
            </Button>
            <Button
              variant="primary"
              onClick={handlePrint}
              fullWidth
              className="flex items-center justify-center gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Printer className="w-4 h-4" />
              <span>Print Z-Report</span>
            </Button>
          </div>
          <Button variant="ghost" onClick={onClose} fullWidth size="sm">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
