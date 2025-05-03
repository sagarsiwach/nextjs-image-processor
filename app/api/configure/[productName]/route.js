// app/api/configure/[productName]/route.js
import { NextResponse } from "next/server";
import * as ProductIO from "@/lib/product-io";
import * as BackgroundTasks from "@/lib/background-tasks";
import * as Status from "@/lib/status";
// Remove the Mutex import from Bun
import * as Utils from "@/lib/utils";

/**
 * POST handler to save configuration and trigger background processing.
 * Expects productNameOriginal in the URL.
 * Expects JSON body with { title, subtitle, hotspots, variants }
 * @param {Request} request
 * @param {{ params: { productName: string } }} context
 */
export async function POST(request, { params }) {
  const { productName: productOriginalName } = params; // Use original name

  if (!productOriginalName) {
    return NextResponse.json(
      { error: "Product name missing" },
      { status: 400 }
    );
  }

  const sanitizedName = Utils.sanitizeName(productOriginalName);

  // Prevent triggering if already processing
  if (Status.isProductProcessing(sanitizedName)) {
    return NextResponse.json(
      { error: "Processing already in progress for this product." },
      { status: 409 }
    ); // 409 Conflict
  }

  let configData;
  try {
    configData = await request.json();
    // TODO: Add validation here using Zod or manual checks
    // Ensure title, subtitle are strings, hotspots is object with size keys and valid x,y etc.
    if (
      !configData ||
      typeof configData.hotspots !== "object" ||
      !configData.variants
    ) {
      throw new Error("Invalid configuration data format.");
    }
  } catch (error) {
    return NextResponse.json(
      { error: `Invalid request body: ${error.message}` },
      { status: 400 }
    );
  }

  try {
    // Save the relevant parts (title, subtitle, hotspots) to the local config file
    const saved = await ProductIO.saveLocalProcessorConfig(
      productOriginalName,
      {
        title: configData.title,
        subtitle: configData.subtitle,
        hotspots: configData.hotspots,
        // variants are NOT saved here, they are just for context if needed later
      }
    );

    if (!saved) {
      throw new Error("Failed to save local configuration file.");
    }

    // Enqueue the background processing task using the ORIGINAL name
    const enqueued =
      BackgroundTasks.enqueueProductProcessing(productOriginalName);

    if (enqueued) {
      return NextResponse.json(
        { message: "Configuration saved and processing started." },
        { status: 202 }
      ); // 202 Accepted
    } else {
      // This might happen if it was *just* enqueued by another request
      return NextResponse.json(
        {
          message:
            "Configuration saved, but processing was already queued or running.",
        },
        { status: 200 }
      );
    }
  } catch (error) {
    console.error(`Error in configure POST for ${productOriginalName}:`, error);
    Status.addErrorLog(
      `Configure API Error (${productOriginalName}): ${error.message}`
    );
    return NextResponse.json(
      {
        error: `Failed to save configuration or start processing: ${error.message}`,
      },
      { status: 500 }
    );
  }
}
