// app/api/product/[productName]/clear-cache/route.js
import { NextResponse } from "next/server";
import * as ImageProcessor from "@/lib/image-processing";
import * as Utils from "@/lib/utils";

/**
 * POST handler to clear both local and S3 files for a product.
 * @param {Request} _request
 * @param {{ params: { productName: string } }} context
 */
export async function POST(_request, { params }) {
  const productOriginalName = (await params).productName;

  if (!productOriginalName) {
    return NextResponse.json(
      { error: "Product name missing" },
      { status: 400 }
    );
  }

  try {
    // Call the function to clear both local files and S3 objects
    const deletedCount = await ImageProcessor.clearProductCache(
      productOriginalName
    );

    return NextResponse.json({
      message: `Successfully cleared cache for ${productOriginalName}`,
      deletedCount: deletedCount,
    });
  } catch (error) {
    console.error(`Error clearing cache for ${productOriginalName}:`, error);
    return NextResponse.json(
      { error: "Failed to clear cache" },
      { status: 500 }
    );
  }
}
