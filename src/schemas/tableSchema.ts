import { z } from "zod";

export const restaurantTableSchema = z.object({
  table_number: z
    .string()
    .trim()
    .min(1, "Table number is required")
    .max(50, "Table number cannot exceed 50 characters"),
  capacity: z.coerce
    .number()
    .int("Capacity must be an integer")
    .min(1, "Capacity must be at least 1")
    .max(100, "Capacity cannot exceed 100")
    .default(4),
  is_active: z.boolean().default(true),
});

export type RestaurantTableInput = z.infer<typeof restaurantTableSchema>;
