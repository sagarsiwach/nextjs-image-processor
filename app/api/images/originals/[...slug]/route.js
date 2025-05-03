// src/app/api/images/originals/[...slug]/route.js
import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import * as Config from "@/lib/config";
import * as Utils from "@/lib/utils";
import { lookup } from "mime-types"; // Need to install mime-types: bun add mime-types @types/mime-types

export const dynamic = "force-dynamic";

/**
 * GET handler to serve original image files for UI previews.
 * Slug should be [productNameOriginal, variantNameOriginal, filename]
 * @param {Request} _request
 * @param {{ params: { slug: string[] } }} context
 */
export async function GET(_request, { params }) {
  const slug = (await params).slug;

  if (!slug || slug.length !== 3) {
    return new Response("Invalid image path format", { status: 400 });
  }

  const [productNameOriginal, variantNameOriginal, filename] = slug;

  // Basic sanitization/validation - prevent directory traversal!
  // Use basename to ensure filename doesn't contain path elements
  const safeFilename = path.basename(filename);
  if (
    !productNameOriginal ||
    !variantNameOriginal ||
    !safeFilename ||
    safeFilename === "." ||
    safeFilename === ".."
  ) {
    return new Response("Invalid path components", { status: 400 });
  }
  // Double check against invalid chars just in case (though basename helps)
  if (
    /[\\/]|\.\./.test(productNameOriginal) ||
    /[\\/]|\.\./.test(variantNameOriginal)
  ) {
    return new Response("Invalid path components", { status: 400 });
  }

  const imagePath = path.join(
    Config.INPUT_DIR,
    productNameOriginal,
    variantNameOriginal,
    safeFilename
  );

  // IMPORTANT: Verify the resolved path is still within the INPUT_DIR to prevent traversal
  const resolvedPath = path.resolve(imagePath);
  const resolvedInputDir = path.resolve(Config.INPUT_DIR);
  if (!resolvedPath.startsWith(resolvedInputDir)) {
    console.warn(
      `Access denied for original image (path traversal attempt?): ${imagePath}`
    );
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const stats = await fs.stat(resolvedPath);
    if (!stats.isFile()) {
      return new Response("Not a file", { status: 404 });
    }

    const fileBuffer = await fs.readFile(resolvedPath);
    const contentType = lookup(safeFilename) || "application/octet-stream"; // Determine MIME type

    // Add cache headers for browser caching during configuration
    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "public, max-age=3600"); // Cache for 1 hour

    return new Response(fileBuffer, { status: 200, headers });
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") {
      return new Response("Image not found", { status: 404 });
    }
    console.error(`Error serving original image ${imagePath}:`, error);
    return new Response("Internal server error", { status: 500 });
  }
}
