import { z } from "zod";

export const cashSettlementSchema = z
  .object({
    payment_method: z.enum(["cash", "card", "bkash", "nagad", "other"]).default("cash"),
    tendered_amount: z.number().min(0, "Tendered amount cannot be negative"),
    discount: z.number().min(0, "Discount cannot be negative").default(0),
    notes: z.string().trim().max(500, "Notes cannot exceed 500 characters").optional(),
    payable_total: z.number().min(0),
  })
  .refine(
    (data) => {
      // For cash, tendered amount must cover the discounted payable amount
      const netPayable = Math.max(0, data.payable_total - (data.discount || 0));
      return data.tendered_amount >= netPayable;
    },
    {
      message: "Tendered amount must be greater than or equal to the net payable amount",
      path: ["tendered_amount"],
    }
  );

export type CashSettlementInput = z.infer<typeof cashSettlementSchema>;
