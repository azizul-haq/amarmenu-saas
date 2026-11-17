import { z } from "zod";

export const openShiftSchema = z.object({
  opening_float: z
    .number()
    .min(0, "Opening float cannot be negative")
    .default(0),
  notes: z.string().trim().max(500, "Notes cannot exceed 500 characters").optional(),
});

export type OpenShiftInput = z.infer<typeof openShiftSchema>;

export const closeShiftSchema = z.object({
  closing_count: z
    .number()
    .min(0, "Closing cash count cannot be negative"),
  notes: z.string().trim().max(500, "Notes cannot exceed 500 characters").optional(),
});

export type CloseShiftInput = z.infer<typeof closeShiftSchema>;
