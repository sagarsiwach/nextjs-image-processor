// app/page.jsx
import fs from "node:fs/promises";
import path from "node:path";
import * as Config from "@/lib/config"; // Alias should work from jsconfig.json
import * as ProductIO from "@/lib/product-io";
import * as Status from "@/lib/status";
import * as Utils from "@/lib/utils"; // Need sanitizeName if checking status
import { ProductList } from "@/components/product-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button"; // For potential refresh button
import Link from "next/link";

// This page needs fresh data on each load due to processing status
export const dynamic = "force-dynamic";

async function getProductsData() {
  let productsData = [];
  let error = null;
  try {
    const productFolders = await ProductIO.listProductFolders();

    productsData = await Promise.all(
      productFolders.map(async (folder) => {
        const sanitizedName = Utils.sanitizeName(folder.name);
        const config = await ProductIO.loadLocalProcessorConfig(folder.name);
        const isProcessing = Status.isProductProcessing(sanitizedName);
        const configExists = await Bun.file(
          ProductIO.getLocalConfigFilePath(folder.name)
        ).exists();

        return {
          originalName: folder.name,
          sanitizedName: sanitizedName,
          isConfigured: configExists, // Check if local config file exists
          title: config.title || Config.DEFAULT_TITLE, // Use title from loaded config
          isProcessing: isProcessing,
        };
      })
    );
  } catch (err) {
    console.error("Error fetching product data for main page:", err);
    error = `Failed to load product list from ${Config.INPUT_DIR}. Check permissions and console logs.`;
    Status.addErrorLog(
      `Error loading products for page.jsx: ${err.message}`,
      false
    );
  }
  return { productsData, error };
}

export default async function HomePage() {
  const { productsData, error } = await getProductsData();

  return (
    <main className="container mx-auto p-4 py-8 md:p-8">
      <Card className="mb-6 border-blue-200 bg-blue-50/50 shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl text-blue-900">
            Image Processor Control Panel
          </CardTitle>
          <CardDescription className="text-blue-700">
            Configure product variants, set hotspots, and process images for S3
            upload. Generated JSON is saved locally in the{" "}
            <code className="text-xs bg-blue-100 p-0.5 rounded">output/</code>{" "}
            directory.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-blue-800 space-y-1">
          <p>
            <strong className="font-medium">Input Directory:</strong>{" "}
            <code className="bg-blue-100 px-1 rounded text-xs">
              {Config.INPUT_DIR}
            </code>
          </p>
          <p>
            <strong className="font-medium">Output JSON Directory:</strong>{" "}
            <code className="bg-blue-100 px-1 rounded text-xs">
              {Config.OUTPUT_JSON_DIR}
            </code>
          </p>
          <p>
            <strong className="font-medium">Target S3 Bucket:</strong>{" "}
            <code className="bg-blue-100 px-1 rounded text-xs">
              {Config.S3_BUCKET || "Not Set!"}
            </code>
          </p>
          <p className="pt-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/api/status" target="_blank">
                View System Status
              </Link>
            </Button>
          </p>
        </CardContent>
      </Card>

      <h2 className="text-xl font-semibold mb-4 text-gray-700">
        Available Products
      </h2>

      {error && (
        <Card className="mb-4 border-destructive bg-destructive/10">
          <CardHeader>
            <CardTitle className="text-destructive text-lg">
              Error Loading Products
            </CardTitle>
          </CardHeader>
          <CardContent className="text-destructive/90 text-sm">
            {error}
          </CardContent>
        </Card>
      )}

      <ProductList products={productsData} />
    </main>
  );
}
