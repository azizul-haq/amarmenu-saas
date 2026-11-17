import { z } from "zod";

export const voidOrderSchema = z.object({
  manager_pin: z
    .string()
    .trim()
    .regex(/^\d{4,6}$/, "Manager PIN must be between 4 and 6 numeric digits"),
  reason: z
    .string()
    .trim()
    .min(3, "Reason is mandatory and must be at least 3 characters")
    .max(500, "Reason cannot exceed 500 characters"),
});

export type VoidOrderInput = z.infer<typeof voidOrderSchema>;

export const updateManagerPinSchema = z.object({
  staff_id: z.string().uuid("Invalid staff ID"),
  new_pin: z
    .string()
    .trim()
    .regex(/^\d{4,6}$/, "New PIN must be between 4 and 6 numeric digits"),
});

export type UpdateManagerPinInput = z.infer<typeof updateManagerPinSchema>;
