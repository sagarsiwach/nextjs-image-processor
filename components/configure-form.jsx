// components/configure-form.jsx
"use client";

import React, { useState, useEffect, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation"; // Use for redirection
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
// Note: Fieldset is not a Shadcn component, use HTML tags
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner"; // Import sonner for notifications
import { CropPreview } from "./cropPreview";
import * as Config from "@/lib/config"; // Import config for defaults and sizes

/**
 * The main form for configuring a product.
 * @param {{
 *  productOriginalName: string;
 *  productSanitizedName: string;
 *  initialConfig: object; // Loaded config (title, subtitle, hotspots)
 *  initialVariants: Array<{ original_name: string; display_name: string; colorValue: string }>;
 *  sampleImageUrl: string | null;
 *  isInitiallyProcessing: boolean;
 * }} props
 */
export function ConfigureForm({
  productOriginalName,
  productSanitizedName,
  initialConfig,
  initialVariants,
  sampleImageUrl,
  isInitiallyProcessing,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition(); // For loading state during submission
  const [isProcessing, setIsProcessing] = useState(isInitiallyProcessing);
  const [clearCache, setClearCache] = useState(false);

  // Form State
  const [title, setTitle] = useState(
    initialConfig?.title || Config.DEFAULT_TITLE
  );
  const [subtitle, setSubtitle] = useState(
    initialConfig?.subtitle || Config.DEFAULT_SUBTITLE
  );
  const [variants, setVariants] = useState(initialVariants || []);
  const [hotspots, setHotspots] = useState(
    initialConfig?.hotspots || deepClone(Config.DEFAULT_HOTSPOTS_CONFIG)
  ); // Use deepClone

  // Helper for deep cloning defaults safely in JS
  function deepClone(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      console.error("Deep clone failed:", e);
      return {};
    }
  }

  // Callback for CropPreview component
  const handleHotspotChange = useCallback((sizeKey, newHotspot) => {
    setHotspots((prev) => ({
      ...prev,
      [sizeKey]: newHotspot,
    }));
  }, []);

  // Callback for variant detail changes
  const handleVariantChange = (index, field, value) => {
    setVariants((prev) => {
      const newVariants = [...prev];
      if (newVariants[index]) {
        newVariants[index] = { ...newVariants[index], [field]: value };
      }
      return newVariants;
    });
  };

  // Form Submission Handler
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isProcessing || isPending) return; // Prevent double submission

    startTransition(async () => {
      // Prepare data payload
      const payload = {
        title,
        subtitle,
        hotspots,
        variants: variants.map((v) => ({
          // Send necessary variant data for saving/reference if needed by API
          original_name: v.original_name, // Keep track of original name
          display_name: v.display_name,
          colorValue: v.colorValue,
        })),
        clearCache, // Include the clearCache flag
      };

      try {
        const response = await fetch(
          `/api/configure/${encodeURIComponent(productOriginalName)}`,
          {
            // Use ORIGINAL name in URL to save config correctly
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.error || `HTTP error! status: ${response.status}`
          );
        }

        toast.success(
          `Configuration saved for ${productOriginalName}. Processing started...`
        );
        setIsProcessing(true); // Update local state to show processing
        // Optionally redirect back to home page after a delay or immediately
        // router.push('/');
        // Or just let the user see the processing state on this page
        // Start polling status? (More advanced)
      } catch (error) {
        console.error("Configuration save/process error:", error);
        toast.error(`Failed to save/process: ${error.message}`);
        setIsProcessing(false); // Reset processing state on error
      }
    });
  };

  // Optional: Poll for processing status if needed
  useEffect(() => {
    let intervalId;
    if (isProcessing) {
      // console.log(`Polling status for ${productSanitizedName}...`);
      intervalId = setInterval(async () => {
        try {
          const res = await fetch(
            `/api/product/${encodeURIComponent(productSanitizedName)}/status`
          ); // Poll using SANITIZED name
          if (res.ok) {
            const data = await res.json();
            if (!data.isProcessing) {
              // console.log(`Polling detected processing finished for ${productSanitizedName}.`);
              setIsProcessing(false);
              toast.info(`Processing complete for ${productOriginalName}.`);
              clearInterval(intervalId);
            }
          } else {
            // Handle API error during polling? Maybe stop polling.
            console.warn("Status polling failed:", res.status);
            // clearInterval(intervalId); // Optional: stop on error
          }
        } catch (err) {
          console.error("Error during status poll:", err);
          // clearInterval(intervalId); // Optional: stop on error
        }
      }, 5000); // Poll every 5 seconds
    }

    // Cleanup interval on component unmount or when processing finishes
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isProcessing, productSanitizedName, productOriginalName]); // Re-run effect if processing state or product changes

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white p-4 md:p-6 rounded shadow-md space-y-6"
    >
      {/* General Config */}
      <fieldset className="border p-4 rounded border-border">
        {" "}
        {/* Use border-border for consistency */}
        <legend className="text-lg font-semibold px-2 mb-2 text-foreground">
          General
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="title" className="text-sm font-medium mb-1 block">
              Title
            </Label>
            <Input
              id="title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={Config.DEFAULT_TITLE}
              required
            />
          </div>
          <div>
            <Label
              htmlFor="subtitle"
              className="text-sm font-medium mb-1 block"
            >
              Subtitle
            </Label>
            <Input
              id="subtitle"
              name="subtitle"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder={Config.DEFAULT_SUBTITLE}
            />
          </div>
        </div>
      </fieldset>

      {/* Hotspot Config */}
      <fieldset className="border p-4 rounded border-border">
        <legend className="text-lg font-semibold px-2 mb-2 text-foreground">
          Hotspot Selection Per Size
        </legend>
        <p className="text-sm text-muted-foreground mb-4">
          Click on the image for each size group to set its focal point.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Config.SIZE_KEYS.map((sizeKey) => (
            <CropPreview
              key={sizeKey}
              sizeKey={sizeKey}
              sizeWidth={Config.RESPONSIVE_SIZES[sizeKey]}
              imageUrl={sampleImageUrl}
              initialHotspot={hotspots[sizeKey] || Config.DEFAULT_HOTSPOT}
              onHotspotChange={handleHotspotChange}
            />
          ))}
        </div>
        {!sampleImageUrl && (
          <p className="text-destructive text-sm mt-4">
            Cannot select hotspots: No sample image found.
          </p>
        )}
      </fieldset>

      {/* Variants Config */}
      <fieldset className="border p-4 rounded border-border">
        <legend className="text-lg font-semibold px-2 mb-2 text-foreground">
          Variants Configuration
        </legend>
        <p className="text-sm text-muted-foreground mb-4">
          Configure display names and color swatches for detected variants.
        </p>
        <div className="space-y-3">
          {variants.length > 0 ? (
            variants.map((variant, index) => (
              <div
                key={variant.original_name}
                className="grid grid-cols-[1fr,auto,auto] sm:grid-cols-[1fr,2fr,auto] items-center gap-3 border-b pb-2 last:border-b-0 border-border"
              >
                <Label
                  htmlFor={`variant-name-${index}`}
                  className="text-sm font-medium text-foreground truncate pr-2"
                  title={variant.original_name}
                >
                  {variant.original_name}
                </Label>
                {/* Hidden input to track original name during POST */}
                <input
                  type="hidden"
                  name={`variants[${index}][original_name]`}
                  value={variant.original_name}
                />
                <Input
                  id={`variant-name-${index}`}
                  name={`variants[${index}][display_name]`}
                  value={variant.display_name}
                  onChange={(e) =>
                    handleVariantChange(index, "display_name", e.target.value)
                  }
                  placeholder="Display Name"
                  className="text-sm"
                  required
                />
                <Input
                  type="color"
                  name={`variants[${index}][colorValue]`}
                  value={variant.colorValue}
                  onChange={(e) =>
                    handleVariantChange(index, "colorValue", e.target.value)
                  }
                  title="Select color"
                  className="p-0 h-8 w-8 border-none rounded-md cursor-pointer appearance-none bg-transparent" // Basic styling for color input
                  style={{ backgroundColor: variant.colorValue }} // Show color visually
                />
              </div>
            ))
          ) : (
            <p className="text-destructive text-sm">
              No variant subdirectories found in the input folder.
            </p>
          )}
        </div>
      </fieldset>

      {/* Cache Clearing Option */}
      <div className="mt-4 flex items-center space-x-2 border-t pt-4 border-border">
        <Switch
          id="clear-cache"
          checked={clearCache}
          onCheckedChange={setClearCache}
        />
        <Label
          htmlFor="clear-cache"
          className="text-sm font-medium text-foreground"
        >
          Clear existing files from S3 before uploading
        </Label>
      </div>

      {/* Submit Button */}
      <div className="mt-6 pt-4 border-t border-border">
        <Button
          type="submit"
          className="w-full"
          disabled={isProcessing || isPending} // Disable while processing or submitting
        >
          {isProcessing
            ? "Processing..."
            : isPending
            ? "Saving..."
            : "Save Configuration & Start Processing"}
        </Button>
        {isProcessing && (
          <p className="text-xs text-orange-600 mt-2 text-center">
            Processing running... You can leave this page. Check console or
            status API for updates.
          </p>
        )}
      </div>
    </form>
  );
}
