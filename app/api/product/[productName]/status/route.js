// app/api/product/[productName]/status/route.js
import { NextResponse } from "next/server";
import * as Status from "@/lib/status";
import * as Utils from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * GET handler to check the processing status of a product.
 * @param {Request} _request
 * @param {{ params: { productName: string } }} context
 */
export async function GET(_request, { params }) {
  const { productName } = params; // This might be original name from URL
  
  if (!productName) {
    return NextResponse.json(
      { error: "Product name missing" },
      { status: 400 }
    );
  }

  try {
    // Sanitize the name since status module uses sanitized names
    const sanitizedName = Utils.sanitizeName(productName);
    const isProcessing = Status.isProductProcessing(sanitizedName);
    
    // Get any recent errors for this product (optional enhancement)
    const recentErrors = Status.getRecentErrors()
      .filter(err => err.message.includes(productName) || err.message.includes(sanitizedName))
      .slice(0, 5); // Limit to 5 most recent errors
    
    return NextResponse.json({ 
      isProcessing,
      recentErrors: recentErrors.length > 0 ? recentErrors : undefined
    });
  } catch (error) {
    console.error(`Error checking processing status for ${productName}:`, error);
    return NextResponse.json(
      { error: "Failed to check processing status" },
      { status: 500 }
    );
  }
}