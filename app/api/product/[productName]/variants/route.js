// src/app/api/product/[productName]/variants/route.js
import { NextResponse } from "next/server";
import * as ProductIO from "@/lib/product-io"; // Use alias
import path from "node:path";
import fs from "node:fs/promises"; // Added missing import
import * as Config from "@/lib/config";

// Force dynamic evaluation for filesystem access
export const dynamic = "force-dynamic";

/**
 * GET handler to list variant folders for a given product.
 * @param {Request} _request - The incoming request (unused).
 * @param {{ params: { productName: string } }} context - Route parameters.
 */
export async function POST(request, { params }) {
  const productOriginalName = (await params).productName; // Use original name

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
      return NextResponse.json(
        { error: "Product directory not found" },
        { status: 404 }
      );
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      return NextResponse.json(
        { error: "Product directory not found" },
        { status: 404 }
      );
    }
    console.error(`Error accessing product directory ${productPath}:`, err);
    return NextResponse.json(
      { error: "Error accessing product directory" },
      { status: 500 }
    );
  }

  try {
    const variants = await ProductIO.listVariantFolders(productOriginalName);
    return NextResponse.json({ variants });
  } catch (error) {
    console.error(`Error listing variants for ${productOriginalName}:`, error);
    return NextResponse.json(
      { error: "Failed to list variants" },
      { status: 500 }
    );
  }
}
