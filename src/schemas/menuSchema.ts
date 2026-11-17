import { z } from "zod";

export const sizeVariantSchema = z.object({
  name: z.string().min(1, "Size name is required (e.g. Regular, Large)"),
  name_bn: z.string().optional(),
  price: z.number().min(0, "Size price must be 0 or greater"),
});

export type SizeVariant = z.infer<typeof sizeVariantSchema>;

export const addonVariantSchema = z.object({
  name: z.string().min(1, "Add-on name is required (e.g. Extra Cheese)"),
  name_bn: z.string().optional(),
  price: z.number().min(0, "Add-on price must be 0 or greater"),
});

export type AddonVariant = z.infer<typeof addonVariantSchema>;

export const menuCategorySchema = z.object({
  name: z.string().min(2, "Category name must be at least 2 characters"),
  name_bn: z.string().optional(),
  display_order: z.number().int().min(0).default(0),
});

export type MenuCategoryInput = z.infer<typeof menuCategorySchema>;

export const menuItemSchema = z.object({
  name: z.string().min(2, "Menu item name must be at least 2 characters"),
  name_bn: z.string().optional(),
  description: z.string().optional(),
  description_bn: z.string().optional(),
  category_id: z.string().uuid("Valid category is required").optional().nullable(),
  base_price: z.number().min(0, "Base price cannot be negative"),
  image_url: z.string().url("Must be a valid image URL").optional().or(z.literal("")),
  is_available: z.boolean().default(true),
  is_featured: z.boolean().default(false),
  sizes: z.array(sizeVariantSchema).default([]),
  addons: z.array(addonVariantSchema).default([]),
});

export type MenuItemInput = z.infer<typeof menuItemSchema>;
