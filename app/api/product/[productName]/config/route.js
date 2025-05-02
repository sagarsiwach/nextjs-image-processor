// src/app/api/product/[productName]/config/route.js
import { NextResponse } from "next/server";
import * as ProductIO from "@/lib/product-io";
import path from "node:path";
import * as Config from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET handler to load the local configuration file for a product.
 * @param {Request} _request
 * @param {{ params: { productName: string } }} context
 */
export async function GET(_request, { params }) {
  const { productName: productOriginalName } = params; // Expecting original name

  if (!productOriginalName) {
    return NextResponse.json(
      { error: "Product name missing" },
      { status: 400 }
    );
  }

  // Basic check: Does the product directory exist?
  const productPath = path.join(Config.INPUT_DIR, productOriginalName);
  try {
    const stats = await fs.stat(productPath);
    if (!stats.isDirectory()) {
      // Return default config structure if dir doesn't exist? Or 404?
      // Let's return defaults so UI can still load initially. loadLocalProcessorConfig handles defaults.
      console.warn(
        `Product dir not found for config GET: ${productPath}, returning defaults.`
      );
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      // Ignore not found, handle other errors
      console.error(`Error accessing product directory ${productPath}:`, err);
      return NextResponse.json(
        { error: "Error accessing product directory" },
        { status: 500 }
      );
    }
    // If ENOENT, loadLocalProcessorConfig will return defaults anyway
  }

  try {
    const configData = await ProductIO.loadLocalProcessorConfig(
      productOriginalName
    );
    return NextResponse.json(configData);
  } catch (error) {
    console.error(
      `Error loading local config for ${productOriginalName}:`,
      error
    );
    return NextResponse.json(
      { error: "Failed to load configuration" },
      { status: 500 }
    );
  }
}
