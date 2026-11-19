import { z } from "zod";

const PIN_BLOCKLIST = new Set(["1212", "2580", "1122", "121212", "112233"]);

export const validateNonTrivialPin = (pin: string): boolean => {
  const trimmed = pin.trim();
  if (!/^\d{4,6}$/.test(trimmed)) return false;

  // 1. Repeating digits (e.g. 0000, 1111)
  if (/^(\d)\1+$/.test(trimmed)) return false;

  // 2. Algorithmic sequential ascending or descending (including wrap e.g. 7890, 0987)
  let isAsc = true;
  let isDesc = true;
  for (let i = 0; i < trimmed.length - 1; i++) {
    const d1 = parseInt(trimmed[i], 10);
    const d2 = parseInt(trimmed[i + 1], 10);
    if (!(d2 - d1 === 1 || (d1 === 9 && d2 === 0))) {
      isAsc = false;
    }
    if (!(d2 - d1 === -1 || (d1 === 0 && d2 === 9))) {
      isDesc = false;
    }
  }
  if (isAsc || isDesc) return false;

  // 3. Short blocklist of common keypad or repeating paired patterns
  if (PIN_BLOCKLIST.has(trimmed)) return false;

  return true;
};

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
    .regex(/^\d{4,6}$/, "New PIN must be between 4 and 6 numeric digits")
    .refine(
      validateNonTrivialPin,
      "Manager PIN is too simple. Repeating (e.g. 0000) or sequential (e.g. 1234, 4321) digits are not allowed."
    ),
});

export type UpdateManagerPinInput = z.infer<typeof updateManagerPinSchema>;
