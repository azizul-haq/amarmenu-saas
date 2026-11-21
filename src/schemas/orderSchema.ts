import { z } from "zod";
import { isValidPhone } from "../utils/helpers";

export const customerCheckoutSchema = z
  .object({
    customer_name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name cannot exceed 100 characters"),
    customer_phone: z
      .string()
      .trim()
      .refine((val) => isValidPhone(val), {
        message: "Please enter a valid Bangladeshi mobile number (e.g. 01712345678)",
      }),
    order_type: z.enum(["qr", "table", "counter", "takeaway", "dine_in"]),
    table_number: z.string().trim().optional(),
    customer_notes: z.string().trim().max(500, "Notes cannot exceed 500 characters").optional(),
  })
  .refine(
    (data) => {
      if (data.order_type === "table" && (!data.table_number || data.table_number.trim() === "")) {
        return false;
      }
      return true;
    },
    {
      message: "Please enter a table number for dine-in orders",
      path: ["table_number"],
    }
  );

export type CustomerCheckoutInput = z.infer<typeof customerCheckoutSchema>;
