// lib/config.js
import path from "path";
import os from "os";

// --- Core Paths ---
export const BASE_DIR = process.cwd();
export const INPUT_DIR = path.join(BASE_DIR, "input_products");
export const OUTPUT_JSON_DIR = path.join(BASE_DIR, "output"); // For saving JSON output

// --- S3 Config ---
// Read from environment variables, provide empty strings as fallback
export const S3_ENDPOINT = process.env.S3_ENDPOINT || "";
export const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || "";
export const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || "";
export const S3_BUCKET = process.env.S3_BUCKET || "";
export const S3_REGION = process.env.S3_REGION || "auto";
export const S3_PUBLIC_URL_BASE = process.env.S3_PUBLIC_URL_BASE || "";

// --- Processing Config ---
export const AVIF_QUALITY = parseInt(process.env.AVIF_QUALITY || "80", 10); // Quality setting for AVIF output (0-100)
export const SKIP_AVIF_RECOMPRESSION =
  process.env.SKIP_AVIF_RECOMPRESSION !== "false"; // Default to true
export const ENABLE_CACHE_CLEARING =
  process.env.ENABLE_CACHE_CLEARING !== "false"; // Default to true

// Adjusted responsive sizes with proper aspect ratios
/** @type {Record<string, number>} */
export const RESPONSIVE_SIZES = {
  lg: 1920, // Full HD width (16:9)
  md: 1600, // Custom width (16:9)
  tablet: 768, // Tablet width (9:16 portrait)
  phone: 430, // iPhone Pro Max width (9:16 portrait)
};

// Calculate heights based on aspect ratios
/** @type {Record<string, {width: number, height: number, aspectRatio: string}>} */
export const RESPONSIVE_DIMENSIONS = {
  lg: {
    width: RESPONSIVE_SIZES.lg,
    height: Math.round((RESPONSIVE_SIZES.lg * 9) / 16), // 1080 (16:9)
    aspectRatio: "16:9",
  },
  md: {
    width: RESPONSIVE_SIZES.md,
    height: Math.round((RESPONSIVE_SIZES.md * 9) / 16), // 900 (16:9)
    aspectRatio: "16:9",
  },
  tablet: {
    width: RESPONSIVE_SIZES.tablet,
    height: Math.round((RESPONSIVE_SIZES.tablet * 16) / 9), // 1365 (9:16)
    aspectRatio: "9:16",
  },
  phone: {
    width: RESPONSIVE_SIZES.phone,
    height: Math.round((RESPONSIVE_SIZES.phone * 16) / 9), // 764 (9:16)
    aspectRatio: "9:16",
  },
};

export const SIZE_KEYS = Object.keys(RESPONSIVE_SIZES); // ['lg', 'md', 'tablet', 'phone']

/** @type {Record<string, string>} */
export const JSON_BREAKPOINTS = {
  1920: "lg",
  1600: "md",
  768: "tablet",
  430: "phone",
}; // min-width -> sizeKey
export const SORTED_BREAKPOINT_KEYS = Object.keys(JSON_BREAKPOINTS).sort(
  (a, b) => parseInt(b) - parseInt(a)
); // ['1920', '1600', '768', '430']

// Set of valid input image file extensions (lowercase)
export const VALID_INPUT_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".tiff",
  ".bmp",
  ".avif", // Added AVIF support for input
]);

// --- Parallel Processing ---
const DEFAULT_MAX_WORKERS = 8; // Sensible default limit for parallel image processing tasks

// Optimize thread count for M1 Mac
// For M1/M2 Macs, we can use more efficient threading
// Apple Silicon has a mix of efficiency and performance cores
const isAppleSilicon =
  process.platform === "darwin" && process.arch === "arm64";
const recommendedWorkers = isAppleSilicon
  ? Math.min(os.cpus()?.length, 10) // Use more threads on Apple Silicon
  : Math.min(os.cpus()?.length || 1, DEFAULT_MAX_WORKERS);

// Read from env or use default, ensuring it's a positive number
const envWorkers = parseInt(process.env.MAX_PROCESSING_WORKERS || "", 10);
export const MAX_PROCESSING_WORKERS =
  isNaN(envWorkers) || envWorkers <= 0
    ? recommendedWorkers
    : Math.max(1, envWorkers);

// --- Status & Logging ---
export const MAX_RECENT_ERRORS = 30; // Max errors stored for /status endpoint

// --- Defaults for Configuration UI and Fallbacks ---
export const DEFAULT_TITLE = "Vehicle Overview";
export const DEFAULT_SUBTITLE = "Drag to Interact";
export const DEFAULT_COLOR = "#cccccc"; // Default swatch color
/** @type {{x: number, y: number}} */
export const DEFAULT_HOTSPOT = { x: 0.5, y: 0.5 }; // Center hotspot

// Creates the default structure for storing hotspots for each size
/** @type {Record<string, {x: number, y: number}>} */
export const DEFAULT_HOTSPOTS_CONFIG = SIZE_KEYS.reduce((acc, key) => {
  acc[key] = { ...DEFAULT_HOTSPOT }; // Create a copy for each size key
  return acc;
}, {}); // Start with an empty object

// --- Local Config ---
// Filename used for storing configuration (title, subtitle, hotspots) locally within input product folders
export const LOCAL_CONFIG_FILENAME = "processor.config.json";

// Derived S3 base path (prefix) within the bucket for all processed images
export const S3_PROCESSED_BASE_PATH = "processed_images";

// Export a flag indicating if essential S3 config seems present
export const IS_S3_CONFIGURED = !!(
  S3_ENDPOINT &&
  S3_ACCESS_KEY_ID &&
  S3_SECRET_ACCESS_KEY &&
  S3_BUCKET
);
