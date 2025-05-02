// app/configure/[productName]/page.jsx
import path from "node:path";
import fs from "node:fs/promises"; // Needed for checking product dir existence
import { notFound } from "next/navigation";
import Link from "next/link";
import { natsorted } from "natsort"; // Import natsort

import * as Config from "@/lib/config";
import * as ProductIO from "@/lib/product-io";
import * as Utils from "@/lib/utils";
import * as Status from "@/lib/status";
import { ConfigureForm } from "@/components/configure-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Revalidate frequently to pick up status changes
export const revalidate = 5;
// OR force dynamic rendering if revalidate doesn't work as expected
// export const dynamic = 'force-dynamic';

async function getInitialData(productOriginalName) {
  const sanitizedProductName = Utils.sanitizeName(productOriginalName);
  let error = null;
  let initialConfig = null;
  let initialVariantsRaw = [];
  let initialVariants = [];
  let sampleImageUrl = null;
  let isInitiallyProcessing = false;

  // 1. Validate product existence first
  const productPath = path.join(Config.INPUT_DIR, productOriginalName);
  try {
    const stats = await fs.stat(productPath);
    if (!stats.isDirectory()) throw new Error("Not a directory");
  } catch (err) {
    if (err.code === "ENOENT") {
      return {
        error: `Product input directory not found: ${productOriginalName}`,
      };
    }
    console.error(`Error accessing product directory ${productPath}:`, err);
    return { error: "Error accessing product directory." };
  }

  try {
    // 2. Load existing config or defaults
    initialConfig = await ProductIO.loadLocalProcessorConfig(
      productOriginalName
    );

    // 3. List variant folders
    initialVariantsRaw = await ProductIO.listVariantFolders(
      productOriginalName
    );

    // 4. Map raw variants to form structure, using saved meta if available
    initialVariants = initialVariantsRaw.map((originalName) => {
      const sanitizedVarName = Utils.sanitizeName(originalName);
      // Use variant metadata from the *just loaded* config
      const savedMeta = initialConfig.variants?.[sanitizedVarName] ?? {};
      return {
        original_name: originalName,
        display_name: savedMeta.name || originalName,
        colorValue: savedMeta.colorValue || Config.DEFAULT_COLOR,
      };
    });

    // 5. Find a sample image URL for hotspot previews
    if (initialVariantsRaw.length > 0) {
      const firstVariantDir = path.join(productPath, initialVariantsRaw[0]);
      try {
        const files = await fs.readdir(firstVariantDir);
        const sortedImageFiles = natsorted(
          // Use natsorted
          files.filter((f) =>
            Config.VALID_INPUT_EXTENSIONS.has(path.extname(f).toLowerCase())
          )
        );
        if (sortedImageFiles.length > 0) {
          const firstImageFile = sortedImageFiles[0];
          // Construct URL pointing to our API route for originals
          sampleImageUrl = `/api/images/originals/${encodeURIComponent(
            productOriginalName
          )}/${encodeURIComponent(initialVariantsRaw[0])}/${encodeURIComponent(
            firstImageFile
          )}`;
        } else {
          console.warn(
            `No valid images found in first variant folder: ${firstVariantDir}`
          );
        }
      } catch (imgErr) {
        console.warn(
          `Could not load sample image for ${productOriginalName}/${initialVariantsRaw[0]}: ${imgErr.message}`
        );
      }
    }

    // 6. Get current processing status using SANITIZED name
    isInitiallyProcessing = Status.isProductProcessing(sanitizedProductName);
  } catch (err) {
    console.error(
      `Error getting initial data for ${productOriginalName}:`,
      err
    );
    error = `Failed to load initial configuration or variant data. Check console logs.`;
    Status.addErrorLog(
      `Error loading initial data for ${productOriginalName}: ${err.message}`,
      false
    );
  }

  return {
    initialConfig, // This now contains title, subtitle, hotspots, variants meta
    initialVariants, // This is structured for the form iteration
    sampleImageUrl,
    isInitiallyProcessing,
    error, // Pass any critical error during data fetching
  };
}

export default async function ConfigureProductPage({ params }) {
  // Get original name from URL, decode it
  const productOriginalName = decodeURIComponent(params.productName);

  if (!productOriginalName) {
    notFound();
  }

  const {
    initialConfig,
    initialVariants,
    sampleImageUrl,
    isInitiallyProcessing,
    error,
  } = await getInitialData(productOriginalName);

  // Handle critical errors during data fetching
  if (error || !initialConfig) {
    // Check if initialConfig is null too
    return (
      <div className="container mx-auto p-8">
        <Card className="border-destructive bg-destructive/10">
          <CardHeader>
            <CardTitle className="text-destructive text-xl">
              Error Loading Configuration
            </CardTitle>
            <CardDescription className="text-destructive/90">
              Could not load necessary data for product: {productOriginalName}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-destructive/90 text-sm">
            <p>{error || "Failed to load configuration data."}</p>
            <Button variant="outline" size="sm" className="mt-4" asChild>
              <Link href="/">Back to Product List</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render the client component form, passing all fetched data
  return (
    <div className="container mx-auto p-4 py-6 md:p-8 max-w-6xl">
      <div className="mb-6 flex justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">
            {productOriginalName}
          </h1>
          <p className="text-sm text-gray-500">Configure Processing Settings</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/">← Back to List</Link>
        </Button>
      </div>

      <ConfigureForm
        productOriginalName={productOriginalName}
        // Pass sanitized name for client-side status polling if needed
        productSanitizedName={Utils.sanitizeName(productOriginalName)}
        initialConfig={initialConfig} // Includes title, subtitle, hotspots, variants meta
        initialVariants={initialVariants} // Structured list for form iteration
        sampleImageUrl={sampleImageUrl}
        isInitiallyProcessing={isInitiallyProcessing}
      />
    </div>
  );
}
