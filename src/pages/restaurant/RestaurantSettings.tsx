import React, { useState, useEffect, useRef } from "react";
import {
  Download,
  QrCode as QrCodeIcon,
  ExternalLink,
  Image as ImageIcon,
  Upload,
  Trash2,
  Camera,
  CheckCircle2,
} from "lucide-react";
import { Card, Button, Loading, Alert } from "../../components/ui";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import type { Restaurant } from "../../config/supabase";
import { updateRestaurantLogo } from "../../services/restaurantService";

const RestaurantSettings: React.FC = () => {
  const { restaurant: authRestaurant, restaurantId, refreshProfile } = useAuth();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(authRestaurant || null);
  const [loading, setLoading] = useState(!authRestaurant);
  const [error, setError] = useState("");

  // Logo upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [logoSuccess, setLogoSuccess] = useState<string>("");
  const [logoError, setLogoError] = useState<string>("");

  useEffect(() => {
    if (authRestaurant) {
      setRestaurant(authRestaurant);
      setLoading(false);
    }

    const fetchRestaurant = async () => {
      try {
        const effectiveId = restaurantId || authRestaurant?.id;
        if (!effectiveId) {
          const user = JSON.parse(sessionStorage.getItem("user") || "{}");
          if (!user.restaurant_id) {
            setError("Restaurant ID not found");
            setLoading(false);
            return;
          }
        }

        const { data, error: fetchError } = await supabase.rpc("get_my_restaurant");

        if (fetchError) throw fetchError;
        setRestaurant(data as Restaurant);
      } catch {
        setError("Failed to load restaurant details");
      } finally {
        setLoading(false);
      }
    };

    fetchRestaurant();
  }, [authRestaurant, restaurantId]);

  const downloadQRCode = () => {
    if (!restaurant) return;

    const svg = document.getElementById("qr-code-svg");
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      const pngFile = canvas.toDataURL("image/png");

      const downloadLink = document.createElement("a");
      downloadLink.download = `${restaurant.slug}-qr-code.png`;
      downloadLink.href = pngFile;
      downloadLink.click();
    };

    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !restaurant) return;

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setLogoError("");
    setLogoSuccess("");

    // Validate mime type
    const validMimes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!validMimes.includes(file.type)) {
      setLogoError("Please upload a valid image file (PNG, JPG, or WEBP).");
      return;
    }

    // Validate size (max 2 MB)
    const maxSizeBytes = 2 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      setLogoError("Image size exceeds 2 MB limit. Please select a smaller image.");
      return;
    }

    // Instant local preview
    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);
    setUploading(true);

    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const safeExt = ["png", "jpg", "jpeg", "webp"].includes(ext) ? ext : "png";
      const filePath = `${restaurant.id}/logo-${Date.now()}.${safeExt}`;

      const { error: uploadError } = await supabase.storage
        .from("restaurant-logos")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) {
        throw new Error(uploadError.message || "Failed to upload image to storage");
      }

      const { data: urlData } = supabase.storage
        .from("restaurant-logos")
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl;

      // Update logo via secure RPC (with fallback to direct table update)
      const updateRes = await updateRestaurantLogo(restaurant.id, publicUrl);
      if (!updateRes.success) {
        throw new Error(updateRes.error || "Failed to update restaurant logo URL");
      }

      setRestaurant((prev) => (prev ? { ...prev, logo_url: publicUrl } : prev));
      setPreviewUrl(null);
      setLogoSuccess("Restaurant logo uploaded and saved successfully!");

      if (refreshProfile) {
        await refreshProfile();
      }
    } catch (err: any) {
      setPreviewUrl(null);
      setLogoError(err.message || "Failed to upload restaurant logo.");
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!restaurant) return;
    if (!window.confirm("Are you sure you want to remove your restaurant logo?")) {
      return;
    }

    setUploading(true);
    setLogoError("");
    setLogoSuccess("");

    try {
      if (restaurant.logo_url && restaurant.logo_url.includes("restaurant-logos/")) {
        const parts = restaurant.logo_url.split("restaurant-logos/");
        if (parts[1]) {
          const objectPath = decodeURIComponent(parts[1].split("?")[0]);
          await supabase.storage.from("restaurant-logos").remove([objectPath]);
        }
      }

      // Remove logo via secure RPC (with fallback to direct table update)
      const updateRes = await updateRestaurantLogo(restaurant.id, null);
      if (!updateRes.success) {
        throw new Error(updateRes.error || "Failed to remove logo");
      }

      setRestaurant((prev) => (prev ? { ...prev, logo_url: undefined } : prev));
      setPreviewUrl(null);
      setLogoSuccess("Restaurant logo removed successfully.");

      if (refreshProfile) {
        await refreshProfile();
      }
    } catch (err: any) {
      setLogoError(err.message || "Failed to remove restaurant logo.");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <Loading text="Loading settings..." />;
  }

  if (error || !restaurant) {
    return <Alert type="error" message={error || "Restaurant not found"} />;
  }

  const menuUrl = `${window.location.origin}/menu/${restaurant.slug}`;
  const currentLogoUrl = previewUrl || restaurant.logo_url;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-text mb-2">Settings</h2>
        <p className="text-text-secondary">
          Manage your restaurant branding, QR code, and menu access
        </p>
      </div>

      {/* Restaurant Logo & Branding Section */}
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center font-bold">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-text">Restaurant Logo & Branding</h3>
              <p className="text-text-secondary text-sm">
                Upload your brand logo for Customer QR Menu, POS Receipts, and Staff Sidebar
              </p>
            </div>
          </div>
          <span className="self-start sm:self-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Custom Logo Available
          </span>
        </div>

        {logoSuccess && (
          <div className="mb-4">
            <Alert type="success" message={logoSuccess} />
          </div>
        )}
        {logoError && (
          <div className="mb-4">
            <Alert type="error" message={logoError} />
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center gap-6 p-4 bg-slate-50 border border-slate-200/80 rounded-2xl">
          {/* Logo Preview Box */}
          <div className="relative group flex-shrink-0">
            <div className="w-32 h-32 rounded-2xl border-2 border-dashed border-slate-300 bg-white flex items-center justify-center overflow-hidden shadow-xs">
              {currentLogoUrl ? (
                <img
                  src={currentLogoUrl}
                  alt={restaurant.name}
                  className="w-full h-full object-contain p-2"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-400 p-2 text-center">
                  <Camera className="w-8 h-8 mb-1 text-slate-300" />
                  <span className="text-[11px] font-semibold">No Logo</span>
                </div>
              )}
            </div>
            {uploading && (
              <div className="absolute inset-0 bg-white/85 backdrop-blur-2xs rounded-2xl flex flex-col items-center justify-center">
                <div className="w-7 h-7 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mb-1" />
                <span className="text-[10px] font-bold text-orange-600">Uploading...</span>
              </div>
            )}
          </div>

          {/* Action buttons & requirements */}
          <div className="flex-1 space-y-3 text-center sm:text-left">
            <div>
              <h4 className="font-bold text-gray-900 text-sm">Official Logo</h4>
              <p className="text-xs text-gray-500 mt-0.5">
                PNG, JPG, or WEBP up to 2 MB. Appears on Customer Menus, Thermal Bills, and POS Dashboard.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              onChange={handleFileSelect}
              className="hidden"
            />

            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 pt-1">
              <Button
                type="button"
                variant="primary"
                size="sm"
                icon={<Upload className="w-4 h-4" />}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {currentLogoUrl ? "Change Logo" : "Upload Logo"}
              </Button>

              {currentLogoUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:bg-red-50 hover:border-red-300 border-gray-300"
                  icon={<Trash2 className="w-4 h-4 text-red-500" />}
                  onClick={handleRemoveLogo}
                  disabled={uploading}
                >
                  Remove Logo
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* QR Code Section */}
      <Card>
        <div className="flex items-start space-x-2 mb-4">
          <QrCodeIcon className="w-6 h-6 text-accent" />
          <div>
            <h3 className="text-xl font-bold text-text">Menu QR Code</h3>
            <p className="text-text-secondary text-sm">
              Customers can scan this QR code to access your menu
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* QR Code Display */}
          <div className="flex flex-col items-center space-y-4">
            <div className="bg-white p-6 rounded-lg shadow-md">
              <QRCodeSVG
                id="qr-code-svg"
                value={menuUrl}
                size={256}
                level="H"
                includeMargin={true}
              />
            </div>

            <Button
              icon={<Download className="w-5 h-5" />}
              onClick={downloadQRCode}
              fullWidth
            >
              Download QR Code
            </Button>
          </div>

          {/* QR Code Info */}
          <div className="space-y-4">
            <div>
              <label className="label mb-2">Restaurant Name</label>
              <div className="p-3 bg-bg-subtle rounded-lg text-text font-medium">
                {restaurant.name}
              </div>
            </div>

            <div>
              <label className="label mb-2">Menu URL</label>
              <div className="p-3 bg-bg-subtle rounded-lg break-all text-text-secondary text-sm">
                {menuUrl}
              </div>
              <a
                href={menuUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-1 text-accent hover:text-accent-secondary mt-2 text-sm"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open menu page</span>
              </a>
            </div>

            <div className="bg-accent/10 border border-accent/20 rounded-lg p-4">
              <h4 className="font-semibold text-text mb-2">How to use:</h4>
              <ol className="space-y-2 text-text-secondary text-sm">
                <li>1. Download the QR code image</li>
                <li>2. Print and place it on tables, counter, or entrance</li>
                <li>3. Customers scan with their phone camera</li>
                <li>4. They'll instantly access your live menu</li>
              </ol>
            </div>

            <div className="bg-success/10 border border-success/20 rounded-lg p-4">
              <p className="text-success text-sm">
                ✓ Menu updates automatically reflect in real-time
              </p>
              <p className="text-success text-sm">
                ✓ No app installation required for customers
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Additional Settings Placeholder */}
      <Card className="bg-bg-subtle">
        <h3 className="text-lg font-bold text-text mb-3">
          Additional Settings (Coming Soon)
        </h3>
        <ul className="space-y-2 text-text-secondary text-sm">
          <li>• Update restaurant profile and contact info</li>
          <li>• Upload logo and cover images</li>
          <li>• Customize ordering page theme</li>
          <li>• Set business hours and holidays</li>
          <li>• Configure tax rates and payment methods</li>
          <li>• Change password and security settings</li>
        </ul>
      </Card>
    </div>
  );
};

export default RestaurantSettings;
