import React from "react";
import { Printer, X, AlertTriangle } from "lucide-react";
import type { Order, OrderItem } from "../../config/supabase";
import { formatDateTime } from "../../utils/helpers";
import { Button } from "../ui";

interface KOTReceiptProps {
  order: Order;
  restaurantName: string;
  onClose: () => void;
  onPrint?: () => void;
}

export const KOTReceipt: React.FC<KOTReceiptProps> = ({
  order,
  restaurantName,
  onClose,
  onPrint,
}) => {
  const handlePrint = () => {
    if (onPrint) onPrint();
    window.print();
  };

  const isReprint = (order.kot_print_count || 0) > 0;
  const totalItemQuantity = order.items?.reduce(
    (sum: number, item: OrderItem) => sum + item.quantity,
    0
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      {/* Modal Card (Screen Only) */}
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden print:shadow-none print:max-w-none print:w-auto">
        {/* Screen Header Controls (Hidden on Print) */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white print:hidden">
          <div className="flex items-center gap-2">
            <Printer className="w-4 h-4 text-accent" />
            <span className="font-bold text-xs uppercase tracking-wider">
              KOT Print Preview (80mm)
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Printable Thermal Receipt Content */}
        <div
          id="kot-print-area"
          className="p-6 bg-white font-mono text-gray-900 text-xs selection:bg-none print:p-0 print:m-0 print:w-[80mm]"
        >
          {/* Reprint Banner */}
          {isReprint && (
            <div className="text-center font-bold border-2 border-dashed border-gray-900 py-1 mb-3 text-sm">
              *** DUPLICATE / REPRINT #{order.kot_print_count} ***
            </div>
          )}

          {/* Restaurant & Ticket Header */}
          <div className="text-center border-b border-dashed border-gray-400 pb-3">
            <h2 className="text-base font-black tracking-tight uppercase">
              {restaurantName}
            </h2>
            <p className="text-[11px] font-bold tracking-widest mt-0.5">
              -- KITCHEN ORDER TICKET --
            </p>
          </div>

          {/* Ticket Metadata */}
          <div className="py-2.5 border-b border-dashed border-gray-400 space-y-1">
            <div className="flex justify-between items-center text-sm font-extrabold">
              <span>ORDER:</span>
              <span>#{order.order_number}</span>
            </div>
            <div className="flex justify-between text-[11px] text-gray-700">
              <span>DATE/TIME:</span>
              <span>{formatDateTime(order.created_at)}</span>
            </div>
            {order.customer_name && (
              <div className="flex justify-between text-[11px] text-gray-700">
                <span>CUSTOMER:</span>
                <span>{order.customer_name}</span>
              </div>
            )}
          </div>

          {/* Big Table / Type Callout for Kitchen Staff */}
          <div className="py-2.5 border-b-2 border-gray-900 text-center bg-gray-50 print:bg-transparent">
            {order.table_number ? (
              <div className="text-xl font-black tracking-wide">
                TABLE: {order.table_number}
              </div>
            ) : (
              <div className="text-lg font-black tracking-wide">
                {order.order_type === "counter"
                  ? "TAKEAWAY / PARCEL"
                  : order.order_type.toUpperCase()}
              </div>
            )}
          </div>

          {/* Line Items */}
          <div className="py-3 border-b-2 border-gray-900">
            <div className="flex justify-between font-bold text-[11px] pb-1.5 border-b border-gray-300">
              <span>QTY & ITEM</span>
            </div>

            <div className="divide-y divide-dashed divide-gray-200 mt-1">
              {order.items?.map((item: OrderItem, idx: number) => (
                <div key={idx} className="py-2">
                  <div className="flex items-start justify-between font-bold text-sm">
                    <span>
                      [{item.quantity}x] {item.name}
                    </span>
                  </div>

                  {/* Size Variant */}
                  {item.selected_size && (
                    <div className="pl-4 text-[11px] font-semibold text-gray-700">
                      › Size: {item.selected_size.name}
                    </div>
                  )}

                  {/* Add-ons */}
                  {item.selected_addons && item.selected_addons.length > 0 && (
                    <div className="pl-4 text-[11px] text-gray-600">
                      + {item.selected_addons.map((a) => a.name).join(", ")}
                    </div>
                  )}

                  {/* Special Instructions */}
                  {item.special_instructions && (
                    <div className="mt-1 p-1 bg-gray-100 rounded text-[11px] font-bold border border-gray-300">
                      ** {item.special_instructions} **
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Order Level Special Instructions */}
          {order.customer_notes && (
            <div className="my-2.5 p-2 border-2 border-black rounded text-[11px]">
              <div className="font-black uppercase tracking-wider flex items-center gap-1 mb-0.5">
                <AlertTriangle className="w-3 h-3" />
                <span>KITCHEN NOTE:</span>
              </div>
              <div className="font-bold">{order.customer_notes}</div>
            </div>
          )}

          {/* Footer Summary */}
          <div className="pt-2 text-center text-[10px] text-gray-500 space-y-0.5">
            <div className="flex justify-between font-bold text-gray-900 text-xs">
              <span>TOTAL ITEMS:</span>
              <span>{totalItemQuantity}</span>
            </div>
            <p className="pt-2">-- END OF TICKET --</p>
          </div>
        </div>

        {/* Action Buttons (Screen Only) */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex gap-2 print:hidden">
          <Button variant="outline" onClick={onClose} fullWidth>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={handlePrint}
            fullWidth
            className="flex items-center justify-center gap-2 bg-accent text-white"
          >
            <Printer className="w-4 h-4" />
            <span>Print KOT</span>
          </Button>
        </div>
      </div>
    </div>
  );
};
