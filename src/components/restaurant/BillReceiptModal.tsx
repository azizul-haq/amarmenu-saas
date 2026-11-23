import React from "react";
import { Printer, X, Receipt, CheckCircle2 } from "lucide-react";
import type { Order, OrderItem, Restaurant } from "../../config/supabase";
import { formatCurrency, formatDateTime } from "../../utils/helpers";
import { Button } from "../ui";

interface BillReceiptModalProps {
  order: Order;
  restaurant?: Restaurant | null;
  onClose: () => void;
  onPrint?: () => void;
}

export const BillReceiptModal: React.FC<BillReceiptModalProps> = ({
  order,
  restaurant,
  onClose,
  onPrint,
}) => {
  const handlePrint = () => {
    if (onPrint) onPrint();
    window.print();
  };

  const invoiceNumber = order.invoice_number || `INV-${order.order_number}`;
  const restaurantName = restaurant?.name || "AmarMenu Restaurant";
  const restaurantPhone = restaurant?.phone || "";
  const restaurantAddress = restaurant?.address || "";
  const vatBin = restaurant?.vat_bin_no || "";
  const tradeLicense = restaurant?.trade_license_no || "";

  const tenderedAmount = order.tendered_amount ?? order.total;
  const changeAmount = order.change_amount ?? 0;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      {/* Modal Container */}
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden print:shadow-none print:max-w-none print:w-auto">
        {/* Header (Hidden on Print) */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white print:hidden">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-xs uppercase tracking-wider">
              Customer Bill Receipt (POS 80mm)
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Printable Thermal POS Bill */}
        <div
          id="bill-receipt-area"
          className="p-6 bg-white font-mono text-gray-900 text-xs selection:bg-none print:p-0 print:m-0 print:w-[80mm]"
        >
          {/* Restaurant Details */}
          <div className="text-center border-b border-dashed border-gray-400 pb-3">
            {restaurant?.logo_url && (
              <div className="flex justify-center mb-2">
                <img
                  src={restaurant.logo_url}
                  alt={restaurantName}
                  className="max-h-12 max-w-[120px] object-contain filter grayscale contrast-125 print:max-h-12"
                />
              </div>
            )}
            <h2 className="text-base font-black tracking-tight uppercase">
              {restaurantName}
            </h2>
            {restaurant?.name_bn && (
              <p className="text-xs font-bangla font-semibold text-gray-700">
                {restaurant.name_bn}
              </p>
            )}
            {restaurantAddress && (
              <p className="text-[10px] text-gray-600 mt-0.5 leading-tight">
                {restaurantAddress}
              </p>
            )}
            {restaurantPhone && (
              <p className="text-[10px] text-gray-600">Tel: {restaurantPhone}</p>
            )}

            {/* NBR Fiscal Information */}
            <div className="mt-1.5 pt-1.5 border-t border-dotted border-gray-300 text-[10px] text-gray-800 space-y-0.5">
              {vatBin ? (
                <p className="font-bold">BIN / VAT Reg: {vatBin}</p>
              ) : (
                <p className="text-gray-500">VAT Reg: Unregistered</p>
              )}
              {tradeLicense && <p>Trade Lic: {tradeLicense}</p>}
              <p className="font-extrabold text-[11px] tracking-wider pt-0.5">
                -- FISCAL CASH RECEIPT / INVOICE --
              </p>
            </div>
          </div>

          {/* Invoice & Order Meta */}
          <div className="py-2.5 border-b border-dashed border-gray-400 space-y-1 text-[11px]">
            <div className="flex justify-between font-black">
              <span>INVOICE NO:</span>
              <span className="font-mono text-emerald-800">{invoiceNumber}</span>
            </div>
            <div className="flex justify-between text-gray-700">
              <span>ORDER NO:</span>
              <span>#{order.order_number}</span>
            </div>
            <div className="flex justify-between text-gray-700">
              <span>DATE/TIME:</span>
              <span>{formatDateTime(order.completed_at || order.created_at)}</span>
            </div>
            <div className="flex justify-between text-gray-700">
              <span>TYPE / TABLE:</span>
              <span className="font-bold">
                {order.table_number
                  ? `Table ${order.table_number}`
                  : order.order_type.toUpperCase()}
              </span>
            </div>
            {order.customer_name && (
              <div className="flex justify-between text-gray-700">
                <span>CUSTOMER:</span>
                <span>
                  {order.customer_name}{" "}
                  {order.customer_phone ? `(${order.customer_phone})` : ""}
                </span>
              </div>
            )}
            {order.verified_by && (
              <div className="flex justify-between text-gray-600 text-[10px]">
                <span>SERVED BY:</span>
                <span>{order.verified_by}</span>
              </div>
            )}
          </div>

          {/* Line Items */}
          <div className="py-2.5 border-b-2 border-gray-900">
            <div className="flex justify-between font-bold text-[11px] pb-1 border-b border-gray-300">
              <span className="w-1/2">ITEM</span>
              <span className="w-1/6 text-center">QTY</span>
              <span className="w-1/3 text-right">TOTAL</span>
            </div>

            <div className="divide-y divide-dotted divide-gray-200 mt-1">
              {order.items?.map((item: OrderItem, idx: number) => (
                <div key={idx} className="py-1.5">
                  <div className="flex justify-between items-baseline font-bold text-[11px]">
                    <span className="w-1/2 break-words">{item.name}</span>
                    <span className="w-1/6 text-center">x{item.quantity}</span>
                    <span className="w-1/3 text-right">
                      {formatCurrency(item.item_total)}
                    </span>
                  </div>

                  {/* Size Info */}
                  {item.selected_size && (
                    <div className="text-[10px] text-gray-600 pl-2">
                      Size: {item.selected_size.name} (৳{item.selected_size.price})
                    </div>
                  )}

                  {/* Add-ons */}
                  {item.selected_addons && item.selected_addons.length > 0 && (
                    <div className="text-[10px] text-gray-600 pl-2">
                      +{" "}
                      {item.selected_addons
                        .map((a) => `${a.name} (৳${a.price})`)
                        .join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Financial Totals */}
          <div className="py-2.5 border-b border-dashed border-gray-400 space-y-1 text-xs">
            <div className="flex justify-between text-gray-700">
              <span>Subtotal:</span>
              <span>{formatCurrency(order.subtotal)}</span>
            </div>

            <div className="flex justify-between text-gray-700">
              <span>VAT / Tax:</span>
              <span>{formatCurrency(order.tax)}</span>
            </div>

            {order.discount !== undefined && order.discount > 0 && (
              <div className="flex justify-between text-emerald-700 font-semibold">
                <span>Discount:</span>
                <span>-{formatCurrency(order.discount)}</span>
              </div>
            )}

            <div className="flex justify-between font-black text-sm pt-1 border-t border-gray-900">
              <span>GRAND TOTAL:</span>
              <span>{formatCurrency(order.total)}</span>
            </div>
          </div>

          {/* Payment & Change Breakdown */}
          <div className="py-2.5 border-b-2 border-gray-900 space-y-1 text-xs bg-gray-50 p-2 rounded print:bg-transparent print:p-0">
            <div className="flex justify-between font-semibold">
              <span>Payment Mode:</span>
              <span className="uppercase font-bold">
                {order.payment_method || "CASH"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Cash Tendered:</span>
              <span className="font-bold">{formatCurrency(tenderedAmount)}</span>
            </div>
            <div className="flex justify-between font-black text-emerald-800 text-sm pt-0.5 border-t border-dashed border-gray-300">
              <span>CHANGE RETURNED:</span>
              <span>{formatCurrency(changeAmount)}</span>
            </div>
          </div>

          {/* Status Badge */}
          <div className="py-2 flex items-center justify-center gap-1.5 text-emerald-700 font-bold text-xs uppercase tracking-wider">
            <CheckCircle2 className="w-4 h-4" />
            <span>PAID & SETTLED</span>
          </div>

          {/* Receipt Footer */}
          <div className="pt-2 text-center text-[10px] text-gray-500 space-y-1">
            <p className="font-medium">ধন্যবাদ, আবার আসবেন!</p>
            <p>Thank you for dining with us!</p>
            <p className="pt-1 text-[9px] text-gray-400">
              Powered by AmarMenu &bull; amarmenu.com
            </p>
          </div>
        </div>

        {/* Action Controls (Hidden on Print) */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex gap-2 print:hidden">
          <Button variant="outline" onClick={onClose} fullWidth>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={handlePrint}
            fullWidth
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Printer className="w-4 h-4" />
            <span>Print Receipt</span>
          </Button>
        </div>
      </div>
    </div>
  );
};
