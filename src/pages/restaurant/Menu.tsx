import React, { useEffect, useState, useRef } from "react";
import {
  Plus,
  Edit,
  Trash2,
  Search,
  Package,
  FolderPlus,
  Layers,
  Sparkles,
  UploadCloud,
  Image as ImageIcon,
  X as XIcon,
  Loader2,
} from "lucide-react";
import { supabase } from "../../config/supabase";
import {
  Card,
  Button,
  Input,
  Badge,
  Modal,
  Loading,
  Alert,
  Textarea,
  Select,
} from "../../components/ui";
import {
  subscribeToMenuItems,
  subscribeToCategories,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  toggleMenuItemAvailability,
  createCategory,
  deleteCategory,
} from "../../services/restaurantService";
import type { MenuItem, MenuCategory } from "../../config/supabase";
import { formatCurrency } from "../../utils/helpers";
import { useAuth } from "../../context/AuthContext";
import { usePermissions } from "../../hooks/usePermissions";
import {
  menuItemSchema,
  menuCategorySchema,
  type SizeVariant,
  type AddonVariant,
} from "../../schemas/menuSchema";

const Menu: React.FC = () => {
  const { restaurantId } = useAuth();
  const { canEditMenu, canDeleteMenu, canToggleAvailability } = usePermissions();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);

  // Modals
  const [showItemModal, setShowItemModal] = useState(false);
  const [itemModalMode, setItemModalMode] = useState<"add" | "edit">("add");
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;

    const itemSub = subscribeToMenuItems(restaurantId, (items) => {
      setMenuItems(items);
      setLoading(false);
    });

    const catSub = subscribeToCategories(restaurantId, (cats) => {
      setCategories(cats);
    });

    return () => {
      itemSub.unsubscribe();
      catSub.unsubscribe();
    };
  }, [restaurantId]);

  const filteredItems = menuItems.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.name_bn && item.name_bn.includes(searchTerm));
    const matchesCategory =
      categoryFilter === "all" ||
      item.category_id === categoryFilter ||
      item.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const handleToggleAvailability = async (item: MenuItem) => {
    await toggleMenuItemAvailability(item.id, !item.is_available);
  };

  const handleOpenAdd = () => {
    setSelectedItem(null);
    setItemModalMode("add");
    setShowItemModal(true);
  };

  const handleOpenEdit = (item: MenuItem) => {
    setSelectedItem(item);
    setItemModalMode("edit");
    setShowItemModal(true);
  };

  const handleOpenDelete = (item: MenuItem) => {
    setSelectedItem(item);
    setShowDeleteModal(true);
  };

  if (loading) {
    return <Loading text="Loading menu..." />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text mb-1">
            Menu Management / মেনু ব্যবস্থাপনা
          </h2>
          <p className="text-text-secondary text-sm">
            Manage your bilingual menu items, sizes, add-ons & categories
          </p>
        </div>
        {canEditMenu && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              icon={<FolderPlus className="w-4 h-4" />}
              onClick={() => setShowCategoryModal(true)}
            >
              Categories
            </Button>
            <Button icon={<Plus className="w-5 h-5" />} onClick={handleOpenAdd}>
              Add Item
            </Button>
          </div>
        )}
      </div>

      {/* Real-time Indicator */}
      <div className="flex items-center space-x-2 text-xs text-success bg-success/5 border border-success/20 px-3 py-1.5 rounded-lg w-fit">
        <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
        <span>Live Tenant Menu • Availability changes reflect instantly to customers</span>
      </div>

      {/* Search and Category Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder="Search items by English or বাংলা..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            icon={<Search className="w-5 h-5" />}
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => setCategoryFilter("all")}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap text-sm transition-colors ${
              categoryFilter === "all"
                ? "bg-accent text-white"
                : "bg-white border border-border text-text-secondary hover:bg-bg-subtle"
            }`}
          >
            All Items ({menuItems.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap text-sm transition-colors ${
                categoryFilter === cat.id
                  ? "bg-accent text-white"
                  : "bg-white border border-border text-text-secondary hover:bg-bg-subtle"
              }`}
            >
              {cat.name} {cat.name_bn ? `(${cat.name_bn})` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* Menu Items Grid */}
      {filteredItems.length === 0 ? (
        <Card className="text-center py-12">
          <Package className="w-16 h-16 text-text-secondary mx-auto mb-4 opacity-40" />
          <h3 className="text-lg font-semibold text-text mb-1">
            No Menu Items Found
          </h3>
          <p className="text-text-secondary text-sm mb-4">
            {searchTerm || categoryFilter !== "all"
              ? "Try adjusting your filters"
              : "Add your first delicious food item to your menu"}
          </p>
          <Button icon={<Plus className="w-4 h-4" />} onClick={handleOpenAdd}>
            Add First Item
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredItems.map((item) => (
            <Card key={item.id} className="overflow-hidden flex flex-col justify-between">
              <div>
                {/* Item Image */}
                {item.image_url ? (
                  <div className="relative h-44 -mx-6 -mt-6 mb-4 bg-bg-subtle overflow-hidden">
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                    <div className="absolute top-3 right-3 flex gap-1">
                      <Badge variant={item.is_available ? "success" : "neutral"}>
                        {item.is_available ? "Available" : "Sold Out"}
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between mb-3">
                    <Badge variant={item.is_available ? "success" : "neutral"}>
                      {item.is_available ? "Available" : "Sold Out"}
                    </Badge>
                  </div>
                )}

                {/* Title & Bilingual Name */}
                <div className="mb-2">
                  <h3 className="text-lg font-bold text-text">{item.name}</h3>
                  {item.name_bn && (
                    <p className="text-sm font-medium text-accent">
                      {item.name_bn}
                    </p>
                  )}
                </div>

                {/* Description */}
                {(item.description || item.description_bn) && (
                  <p className="text-text-secondary text-xs line-clamp-2 mb-3">
                    {item.description || item.description_bn}
                  </p>
                )}

                {/* Sizes and Addons badges */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {item.sizes && item.sizes.length > 0 && (
                    <span className="inline-flex items-center text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
                      <Layers className="w-3 h-3 mr-1" />
                      {item.sizes.length} Sizes
                    </span>
                  )}
                  {item.addons && item.addons.length > 0 && (
                    <span className="inline-flex items-center text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-200">
                      <Sparkles className="w-3 h-3 mr-1" />
                      {item.addons.length} Add-ons
                    </span>
                  )}
                </div>
              </div>

              {/* Price & Actions */}
              <div className="pt-3 border-t border-border mt-auto">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-text-secondary">Base Price</span>
                  <span className="text-lg font-bold text-text">
                    {formatCurrency(item.base_price)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {canToggleAvailability && (
                    <Button
                      size="sm"
                      variant={item.is_available ? "outline" : "primary"}
                      onClick={() => handleToggleAvailability(item)}
                      fullWidth
                    >
                      {item.is_available ? "Sold Out" : "Enable"}
                    </Button>
                  )}
                  {canEditMenu && (
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<Edit className="w-3.5 h-3.5" />}
                      onClick={() => handleOpenEdit(item)}
                      fullWidth
                    >
                      Edit
                    </Button>
                  )}
                  {canDeleteMenu && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-error hover:bg-error/10 hover:border-error"
                      icon={<Trash2 className="w-3.5 h-3.5" />}
                      onClick={() => handleOpenDelete(item)}
                      fullWidth
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Item Modal */}
      <ItemModal
        isOpen={showItemModal}
        item={selectedItem}
        categories={categories}
        restaurantId={restaurantId || ""}
        mode={itemModalMode}
        onClose={() => {
          setShowItemModal(false);
          setSelectedItem(null);
        }}
      />

      {/* Categories Management Modal */}
      <CategoriesModal
        isOpen={showCategoryModal}
        categories={categories}
        restaurantId={restaurantId || ""}
        onClose={() => setShowCategoryModal(false)}
      />

      {/* Soft Delete Modal */}
      {selectedItem && (
        <DeleteConfirmModal
          isOpen={showDeleteModal}
          item={selectedItem}
          onClose={() => {
            setShowDeleteModal(false);
            setSelectedItem(null);
          }}
        />
      )}
    </div>
  );
};

// ============================================================================
// Item Form Modal (Add/Edit) with Zod Validation
// ============================================================================
interface ItemModalProps {
  isOpen: boolean;
  item: MenuItem | null;
  categories: MenuCategory[];
  restaurantId: string;
  mode: "add" | "edit";
  onClose: () => void;
}

const ItemModal: React.FC<ItemModalProps> = ({
  isOpen,
  item,
  categories,
  restaurantId,
  mode,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    name: "",
    name_bn: "",
    description: "",
    description_bn: "",
    category_id: "",
    base_price: "",
    image_url: "",
    is_available: true,
  });

  const [sizes, setSizes] = useState<SizeVariant[]>([]);
  const [newSize, setNewSize] = useState({ name: "", name_bn: "", price: "" });

  const [addons, setAddons] = useState<AddonVariant[]>([]);
  const [newAddon, setNewAddon] = useState({ name: "", name_bn: "", price: "" });

  const [uploadingImage, setUploadingImage] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [imageTab, setImageTab] = useState<"upload" | "url">("upload");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file (PNG, JPG, WEBP).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image size exceeds 5MB limit.");
      return;
    }

    setUploadingImage(true);
    setError("");

    try {
      const ext = file.name.split(".").pop() || "jpg";
      const filePath = `items/${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${ext}`;

      const { data, error: uploadErr } = await supabase.storage
        .from("menu-images")
        .upload(filePath, file, { cacheControl: "3600", upsert: true });

      if (!uploadErr && data) {
        const { data: pubData } = supabase.storage.from("menu-images").getPublicUrl(filePath);
        setFormData((prev) => ({ ...prev, image_url: pubData.publicUrl }));
      } else {
        // Fallback to base64
        const reader = new FileReader();
        reader.onload = () => {
          setFormData((prev) => ({ ...prev, image_url: reader.result as string }));
        };
        reader.readAsDataURL(file);
      }
    } catch {
      const reader = new FileReader();
      reader.onload = () => {
        setFormData((prev) => ({ ...prev, image_url: reader.result as string }));
      };
      reader.readAsDataURL(file);
    } finally {
      setUploadingImage(false);
    }
  };

  useEffect(() => {
    if (mode === "edit" && item) {
      setFormData({
        name: item.name || "",
        name_bn: item.name_bn || "",
        description: item.description || "",
        description_bn: item.description_bn || "",
        category_id: item.category_id || "",
        base_price: item.base_price?.toString() || "",
        image_url: item.image_url || "",
        is_available: item.is_available ?? true,
      });
      setSizes(item.sizes || []);
      setAddons(item.addons || []);
    } else {
      setFormData({
        name: "",
        name_bn: "",
        description: "",
        description_bn: "",
        category_id: categories[0]?.id || "",
        base_price: "",
        image_url: "",
        is_available: true,
      });
      setSizes([]);
      setAddons([]);
    }
    setError("");
    setFieldErrors({});
  }, [mode, item, isOpen, categories]);

  const handleAddSize = () => {
    if (!newSize.name || !newSize.price) return;
    const priceNum = parseFloat(newSize.price);
    if (isNaN(priceNum) || priceNum < 0) return;

    setSizes([...sizes, { name: newSize.name, name_bn: newSize.name_bn || undefined, price: priceNum }]);
    setNewSize({ name: "", name_bn: "", price: "" });
  };

  const handleRemoveSize = (index: number) => {
    setSizes(sizes.filter((_, i) => i !== index));
  };

  const handleAddAddon = () => {
    if (!newAddon.name || !newAddon.price) return;
    const priceNum = parseFloat(newAddon.price);
    if (isNaN(priceNum) || priceNum < 0) return;

    setAddons([...addons, { name: newAddon.name, name_bn: newAddon.name_bn || undefined, price: priceNum }]);
    setNewAddon({ name: "", name_bn: "", price: "" });
  };

  const handleRemoveAddon = (index: number) => {
    setAddons(addons.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    const rawData = {
      name: formData.name.trim(),
      name_bn: formData.name_bn.trim() || undefined,
      description: formData.description.trim() || undefined,
      description_bn: formData.description_bn.trim() || undefined,
      category_id: formData.category_id || null,
      base_price: parseFloat(formData.base_price || "0"),
      image_url: formData.image_url.trim() || undefined,
      is_available: formData.is_available,
      sizes,
      addons,
    };

    // Zod Schema Validation
    const parsed = menuItemSchema.safeParse(rawData);
    if (!parsed.success) {
      const errMap: Record<string, string> = {};
      parsed.error.issues.forEach((issue) => {
        const path = issue.path.join(".");
        errMap[path] = issue.message;
      });
      setFieldErrors(errMap);
      setError("Please fix the validation errors below.");
      return;
    }

    setLoading(true);

    try {
      const payload: Partial<MenuItem> = {
        ...parsed.data,
        restaurant_id: restaurantId,
      };

      if (mode === "add") {
        const res = await createMenuItem(payload);
        if (!res.success) throw new Error(res.error || "Failed to add menu item");
      } else if (item) {
        const res = await updateMenuItem(item.id, payload);
        if (!res.success) throw new Error(res.error || "Failed to update menu item");
      }

      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error saving menu item";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === "add" ? "Add Menu Item (মেনু আইটেম যোগ করুন)" : "Edit Menu Item (আইটেম সম্পাদনা)"}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <Alert type="error" message={error} />}

        {/* Bilingual Names */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Item Name (English)*"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Enter food item name"
            required
            error={fieldErrors["name"]}
          />
          <Input
            label="আইটেমের নাম (বাংলা)"
            value={formData.name_bn}
            onChange={(e) => setFormData({ ...formData, name_bn: e.target.value })}
            placeholder="খাবারের নাম লিখুন"
            error={fieldErrors["name_bn"]}
          />
        </div>

        {/* Category & Base Price */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Category"
            value={formData.category_id}
            onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
            options={categories.map((c) => ({
              value: c.id,
              label: `${c.name} ${c.name_bn ? `(${c.name_bn})` : ""}`,
            }))}
          />
          <Input
            label="Base Price (মূল মূল্য ৳)*"
            type="number"
            step="0.01"
            value={formData.base_price}
            onChange={(e) => setFormData({ ...formData, base_price: e.target.value })}
            placeholder="0.00"
            required
            error={fieldErrors["base_price"]}
          />
        </div>

        {/* Bilingual Descriptions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Textarea
            label="Description (English)"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Ingredients, taste, spices..."
            rows={2}
          />
          <Textarea
            label="বিবরণ (বাংলা)"
            value={formData.description_bn}
            onChange={(e) => setFormData({ ...formData, description_bn: e.target.value })}
            placeholder="আইটেমের বিবরণ..."
            rows={2}
          />
        </div>

        {/* Item Image (Upload & URL) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-text flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4 text-accent" />
              <span>Food Image (খাবারের ছবি)</span>
            </label>
            <div className="flex bg-bg-subtle p-0.5 rounded-lg border border-border text-xs">
              <button
                type="button"
                onClick={() => setImageTab("upload")}
                className={`px-3 py-1 rounded-md font-medium transition-all ${
                  imageTab === "upload"
                    ? "bg-white text-text shadow-sm"
                    : "text-text-secondary hover:text-text"
                }`}
              >
                Upload / Drop
              </button>
              <button
                type="button"
                onClick={() => setImageTab("url")}
                className={`px-3 py-1 rounded-md font-medium transition-all ${
                  imageTab === "url"
                    ? "bg-white text-text shadow-sm"
                    : "text-text-secondary hover:text-text"
                }`}
              >
                Image URL
              </button>
            </div>
          </div>

          {/* Image Preview if present */}
          {formData.image_url ? (
            <div className="relative border border-border rounded-xl p-3 bg-bg-subtle flex items-center gap-4">
              <img
                src={formData.image_url}
                alt="Preview"
                className="w-20 h-20 object-cover rounded-lg border border-border bg-white shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).src =
                    "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&auto=format&fit=crop";
                }}
              />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-success flex items-center gap-1">
                  Image Ready
                </span>
                <p className="text-xs text-text-secondary truncate font-mono mt-0.5">
                  {formData.image_url.startsWith("data:")
                    ? "Embedded image data"
                    : formData.image_url}
                </p>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, image_url: "" })}
                  className="mt-2 text-xs text-error font-semibold hover:underline flex items-center gap-1"
                >
                  <XIcon className="w-3.5 h-3.5" /> Remove Image
                </button>
              </div>
            </div>
          ) : imageTab === "upload" ? (
            /* Drag and Drop Box */
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleImageFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                isDragging
                  ? "border-accent bg-accent/5 scale-[0.99]"
                  : "border-border hover:border-accent hover:bg-bg-subtle/50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageFile(file);
                }}
              />
              {uploadingImage ? (
                <div className="flex flex-col items-center justify-center gap-2 py-2">
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                  <span className="text-xs text-text-secondary font-medium">
                    Uploading image...
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                    <UploadCloud className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-text">
                      Click to upload
                    </span>{" "}
                    <span className="text-xs text-text-secondary">or drag and drop</span>
                  </div>
                  <span className="text-[11px] text-text-secondary">
                    PNG, JPG, WEBP up to 5MB
                  </span>
                </div>
              )}
            </div>
          ) : (
            /* Image URL Input */
            <div className="space-y-2">
              <Input
                label="Direct Image Link (HTTPS)"
                value={formData.image_url}
                onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                placeholder="https://images.unsplash.com/photo-..."
                error={fieldErrors["image_url"]}
              />
            </div>
          )}
        </div>

        {/* Size Variants Builder */}
        <div className="border border-border rounded-lg p-4 bg-bg-subtle/50">
          <label className="text-sm font-bold text-text block mb-2">
            Size Variants (সাইজ অপশন)
          </label>
          <div className="space-y-2 mb-3">
            {sizes.map((s, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between bg-white p-2.5 rounded border border-border text-sm"
              >
                <div>
                  <span className="font-semibold text-text">{s.name}</span>
                  {s.name_bn && <span className="text-accent text-xs ml-2">({s.name_bn})</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-text">৳{s.price}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveSize(idx)}
                    className="text-error hover:opacity-80 text-xs font-semibold"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              placeholder="Size (e.g. Regular)"
              value={newSize.name}
              onChange={(e) => setNewSize({ ...newSize, name: e.target.value })}
            />
            <Input
              placeholder="সাইজ (যেমন: হাফ)"
              value={newSize.name_bn}
              onChange={(e) => setNewSize({ ...newSize, name_bn: e.target.value })}
            />
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="Price (৳)"
                value={newSize.price}
                onChange={(e) => setNewSize({ ...newSize, price: e.target.value })}
              />
              <Button type="button" variant="outline" size="sm" onClick={handleAddSize}>
                Add
              </Button>
            </div>
          </div>
        </div>

        {/* Add-ons Builder */}
        <div className="border border-border rounded-lg p-4 bg-bg-subtle/50">
          <label className="text-sm font-bold text-text block mb-2">
            Add-ons (অতিরিক্ত টপিংস ও আইটেম)
          </label>
          <div className="space-y-2 mb-3">
            {addons.map((a, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between bg-white p-2.5 rounded border border-border text-sm"
              >
                <div>
                  <span className="font-semibold text-text">{a.name}</span>
                  {a.name_bn && <span className="text-accent text-xs ml-2">({a.name_bn})</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-text">+৳{a.price}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAddon(idx)}
                    className="text-error hover:opacity-80 text-xs font-semibold"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              placeholder="Add-on (e.g. Cheese)"
              value={newAddon.name}
              onChange={(e) => setNewAddon({ ...newAddon, name: e.target.value })}
            />
            <Input
              placeholder="টপিং (যেমন: বোরহানি)"
              value={newAddon.name_bn}
              onChange={(e) => setNewAddon({ ...newAddon, name_bn: e.target.value })}
            />
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="Price (৳)"
                value={newAddon.price}
                onChange={(e) => setNewAddon({ ...newAddon, price: e.target.value })}
              />
              <Button type="button" variant="outline" size="sm" onClick={handleAddAddon}>
                Add
              </Button>
            </div>
          </div>
        </div>

        {/* Availability Switch */}
        <div className="flex items-center justify-between p-3 bg-bg-subtle rounded-lg">
          <div>
            <p className="font-semibold text-sm text-text">Available for Orders</p>
            <p className="text-xs text-text-secondary">Shows to customers immediately</p>
          </div>
          <input
            type="checkbox"
            checked={formData.is_available}
            onChange={(e) => setFormData({ ...formData, is_available: e.target.checked })}
            className="w-5 h-5 rounded text-accent cursor-pointer"
          />
        </div>

        <div className="flex gap-3 justify-end pt-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {mode === "add" ? "Save Menu Item" : "Update Menu Item"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

// ============================================================================
// Categories Management Modal
// ============================================================================
interface CategoriesModalProps {
  isOpen: boolean;
  categories: MenuCategory[];
  restaurantId: string;
  onClose: () => void;
}

const CategoriesModal: React.FC<CategoriesModalProps> = ({
  isOpen,
  categories,
  restaurantId,
  onClose,
}) => {
  const [name, setName] = useState("");
  const [nameBn, setNameBn] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const parsed = menuCategorySchema.safeParse({
      name: name.trim(),
      name_bn: nameBn.trim() || undefined,
      display_order: categories.length + 1,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Invalid category name");
      return;
    }

    setLoading(true);
    const res = await createCategory({
      restaurant_id: restaurantId,
      name: parsed.data.name,
      name_bn: parsed.data.name_bn,
      display_order: parsed.data.display_order,
      is_active: true,
    });
    setLoading(false);

    if (res.success) {
      setName("");
      setNameBn("");
    } else {
      setError(res.error || "Failed to create category");
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (confirm("Are you sure you want to remove this category?")) {
      await deleteCategory(id);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Manage Categories (ক্যাটাগরি সমূহ)" size="md">
      <div className="space-y-5">
        {error && <Alert type="error" message={error} />}

        {/* Existing Categories List */}
        <div className="space-y-2 max-h-56 overflow-y-auto">
          {categories.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between p-3 bg-white rounded-lg border border-border"
            >
              <div>
                <p className="font-semibold text-text text-sm">{c.name}</p>
                {c.name_bn && <p className="text-xs text-accent font-medium">{c.name_bn}</p>}
              </div>
              <button
                type="button"
                onClick={() => handleDeleteCategory(c.id)}
                className="text-error hover:opacity-80 p-1 text-xs"
              >
                Delete
              </button>
            </div>
          ))}
          {categories.length === 0 && (
            <p className="text-center text-text-secondary text-sm py-4">
              No categories added yet.
            </p>
          )}
        </div>

        {/* Add Category Form */}
        <form onSubmit={handleCreateCategory} className="border-t border-border pt-4 space-y-3">
          <h4 className="font-bold text-sm text-text">Add New Category</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              placeholder="English (e.g. Platters)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Input
              placeholder="বাংলা (যেমন: প্ল্যাটার)"
              value={nameBn}
              onChange={(e) => setNameBn(e.target.value)}
            />
          </div>
          <Button type="submit" loading={loading} fullWidth size="sm">
            Add Category
          </Button>
        </form>
      </div>
    </Modal>
  );
};

// ============================================================================
// Soft Delete Confirmation Modal
// ============================================================================
interface DeleteConfirmModalProps {
  isOpen: boolean;
  item: MenuItem;
  onClose: () => void;
}

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  item,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);

  const handleConfirmDelete = async () => {
    setLoading(true);
    await deleteMenuItem(item.id);
    setLoading(false);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Delete Menu Item" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Are you sure you want to remove <strong>{item.name}</strong>?
        </p>
        <p className="text-xs text-text-secondary bg-bg-subtle p-3 rounded">
          ℹ️ This item will be safely soft-deleted from your menu. Past customer order receipts will continue to display this item name.
        </p>
        <div className="flex gap-3 justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-error hover:bg-error/90 text-white"
            onClick={handleConfirmDelete}
            loading={loading}
          >
            Soft Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default Menu;
