// lib/utils.js
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import path from "node:path";
import * as Config from "./config";

/**
 * Utility function for combining Tailwind CSS classes
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Sanitizes a name to be safe for use in paths and URLs
 * @param {string} name Original name
 * @returns {string} Sanitized name (lowercase, no special chars)
 */
export function sanitizeName(name) {
  if (!name) return "";
  // Convert to lowercase, replace spaces/special chars with underscores
  return name.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

/**
 * Gets the path to the local configuration file for a product
 * @param {string} productOriginalName Original product folder name
 * @returns {string} Full path to config file
 */
export function getLocalConfigFilePath(productOriginalName) {
  return path.join(Config.INPUT_DIR, productOriginalName, Config.LOCAL_CONFIG_FILENAME);
}

/**
 * Gets the path for the output JSON file
 * @param {string} productNameSanitized Sanitized product name
 * @returns {string} Full path to output JSON file
 */
export function getOutputJsonPath(productNameSanitized) {
  return path.join(Config.OUTPUT_JSON_DIR, `${productNameSanitized}.json`);
}

/**
 * Constructs the S3/R2 key for an image
 * @param {string} productNameSanitized Sanitized product name
 * @param {string} variantNameSanitized Sanitized variant name
 * @param {string} sizeKey Size identifier (lg, md, etc.)
 * @param {string} filename Image filename
 * @returns {string} Full S3/R2 key
 */
export function getS3ImageKey(productNameSanitized, variantNameSanitized, sizeKey, filename) {
  return `${Config.S3_PROCESSED_BASE_PATH}/${productNameSanitized}/${variantNameSanitized}/${sizeKey}/${filename}`;
}

/**
 * Gets the base S3/R2 path for a product
 * @param {string} productNameSanitized Sanitized product name
 * @returns {string} Base S3/R2 path for the product
 */
export function getS3ProductBasePath(productNameSanitized) {
  return `${Config.S3_PROCESSED_BASE_PATH}/${productNameSanitized}`;
}

/**
 * Constructs a public URL for an S3/R2 object
 * @param {string} s3Key S3/R2 key
 * @returns {string} Public URL
 */
export function getPublicS3Url(s3Key) {
  // First check if there's a configured public URL base
  if (Config.S3_PUBLIC_URL_BASE) {
    // Remove any trailing slashes from base URL and ensure proper joining
    const baseUrl = Config.S3_PUBLIC_URL_BASE.replace(/\/$/, '');
    // Remove any leading slashes from s3Key for proper joining
    const cleanKey = s3Key.replace(/^\//, '');
    return `${baseUrl}/${cleanKey}`;
  }
  
  // Construct a Cloudflare R2 public URL if possible
  try {
    // Extract host from endpoint - R2 has specific URL patterns
    const endpointUrl = new URL(Config.S3_ENDPOINT);
    
    // Check if it's a Cloudflare R2 endpoint
    if (endpointUrl.hostname.includes('cloudflarestorage.com')) {
      // It's a standard R2 endpoint, construct appropriate public URL
      return `https://${endpointUrl.hostname}/${Config.S3_BUCKET}/${s3Key}`;
    } else {
      // Could be a custom domain setup
      return `${endpointUrl.origin}/${s3Key}`;
    }
  } catch (error) {
    console.error("Error constructing R2 public URL:", error);
    // Fallback to a simple join
    return `${Config.S3_ENDPOINT}/${Config.S3_BUCKET}/${s3Key}`;
  }
}