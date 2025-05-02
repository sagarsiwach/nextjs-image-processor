// lib/config.js
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

// Load .env file from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// --- Core Paths ---
export const BASE_DIR = process.cwd();
export const INPUT_DIR = path.join(BASE_DIR, "input_products");
export const OUTPUT_JSON_DIR = path.join(BASE_DIR, "output"); // For saving JSON output

// --- S3 Config ---
export const S3_ENDPOINT = process.env.S3_ENDPOINT || '';
export const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || '';
export const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || '';
export const S3_BUCKET = process.env.S3_BUCKET || '';
export const S3_REGION = process.env.S3_REGION || 'auto';
// Use configured public base URL or default to empty (helper fn will try to construct)
export const S3_PUBLIC_URL_BASE = process.env.S3_PUBLIC_URL_BASE || '';

// --- Processing Config ---
export const AVIF_QUALITY = 80;
/** @type {Record<string, number>} */
export const RESPONSIVE_SIZES = { lg: 1600, md: 1200, tablet: 768, phone: 430 };
export const SIZE_KEYS = Object.keys(RESPONSIVE_SIZES);
/** @type {Record<string, string>} */
export const JSON_BREAKPOINTS = { "1600": "lg", "1024": "md", "640": "tablet", "0": "phone" };
export const SORTED_BREAKPOINT_KEYS = Object.keys(JSON_BREAKPOINTS).sort((a, b) => parseInt(b) - parseInt(a));
export const VALID_INPUT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tiff', '.bmp']);

// --- Parallel Processing ---
const DEFAULT_MAX_WORKERS = 8; // Limit default workers, adjust as needed
export const MAX_PROCESSING_WORKERS = Math.min(os.cpus()?.length || 1, DEFAULT_MAX_WORKERS);

// --- Defaults ---
export const DEFAULT_TITLE = "Vehicle Overview";
export const DEFAULT_SUBTITLE = "Drag to Interact";
export const DEFAULT_COLOR = "#cccccc";
/** @type {{x: number, y: number}} */
export const DEFAULT_HOTSPOT = { x: 0.5, y: 0.5 };
/** @type {Record<string, {x: number, y: number}>} */
export const DEFAULT_HOTSPOTS_CONFIG = SIZE_KEYS.reduce((acc, key) => {
    acc[key] = { ...DEFAULT_HOTSPOT }; return acc;
}, {}); // Initial value needs type assertion removed or careful JS typing

// --- Local Config ---
export const LOCAL_CONFIG_FILENAME = 'processor.config.json'; // Store all local config here

// Derived S3 base path
export const S3_PROCESSED_BASE_PATH = "processed_images"; // Base "folder" in S3 bucket

// --- Initial Check & Logging ---
let s3ConfigValid = true;
if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_BUCKET) {
    console.error("\n❌ CRITICAL ERROR: Missing one or more required S3 environment variables in .env:");
    console.error("   Ensure S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET are set.");
    s3ConfigValid = false;
} else {
    console.log("✅ S3 Configuration loaded from .env");
    try {
        const endpointUrl = new URL(S3_ENDPOINT);
        console.log(`   - Endpoint Host: ${endpointUrl.hostname}`);
    } catch {
        console.log(`   - Endpoint: ${S3_ENDPOINT}`);
    }
    console.log(`   - Bucket: ${S3_BUCKET}`);
}
console.log(`⚙️  Max Processing Workers: ${MAX_PROCESSING_WORKERS}`);

export const IS_S3_CONFIGURED = s3ConfigValid; // Export flag
```*(Added JSDoc comments for some complex types)*

---

**3. `lib/utils.js`**

```javascript
// lib/utils.js
import path from 'node:path';
import * as Config from './config'; // Use relative import

// Memoize sanitize regex for performance
const NAME_SANITIZE_RE = new RegExp('[^\\w-]+', 'g'); // Allow hyphen, remove others globally
const WHITESPACE_RE = new RegExp('\\s+', 'g');
const MULTI_UNDERSCORE_RE = new RegExp('_+', 'g');
const TRIM_UNDERSCORE_RE = new RegExp('^_|_$', 'g');

/**
 * Cleans names for use in file paths and URLs.
 * Converts to lowercase, replaces spaces with underscores, removes invalid characters.
 * @param {string} name The original name.
 * @returns {string} The sanitized name.
 */
export function sanitizeName(name) {
    if (!name) return "unnamed";
    const sanitized = name
        .toLowerCase()
        .replace(WHITESPACE_RE, '_')
        .replace(NAME_SANITIZE_RE, '')
        .replace(MULTI_UNDERSCORE_RE, '_')
        .replace(TRIM_UNDERSCORE_RE, '');
    return sanitized || "unnamed";
}

// --- S3 Key Construction ---
/**
 * Gets the base S3 prefix for a product's processed files.
 * @param {string} productNameSanitized
 * @returns {string} e.g., "processed_images/my_product"
 */
export function getS3ProductBasePath(productNameSanitized) {
    const cleanBase = Config.S3_PROCESSED_BASE_PATH.replace(/^\/|\/$/g, '');
    return `${cleanBase}/${productNameSanitized}`;
}

/**
 * Gets the base S3 prefix for a specific variant within a product.
 * @param {string} productNameSanitized
 * @param {string} variantNameSanitized
 * @returns {string} e.g., "processed_images/my_product/my_variant"
 */
export function getS3VariantBasePath(productNameSanitized, variantNameSanitized) {
    return `${getS3ProductBasePath(productNameSanitized)}/${variantNameSanitized}`;
}

/**
 * Gets the base S3 prefix for a specific size within a variant.
 * @param {string} productNameSanitized
 * @param {string} variantNameSanitized
 * @param {string} sizeKey e.g., "lg", "md"
 * @returns {string} e.g., "processed_images/my_product/my_variant/lg"
 */
export function getS3SizeBasePath(productNameSanitized, variantNameSanitized, sizeKey) {
    return `${getS3VariantBasePath(productNameSanitized, variantNameSanitized)}/${sizeKey}`;
}

/**
 * Constructs the full S3 key for a processed image file.
 * @param {string} productNameSanitized
 * @param {string} variantNameSanitized
 * @param {string} sizeKey
 * @param {string} outputFilename e.g., "my_product_my_variant_1_lg.avif"
 * @returns {string} The full S3 object key.
 */
export function getS3ImageKey(productNameSanitized, variantNameSanitized, sizeKey, outputFilename) {
     const cleanFilename = outputFilename.startsWith('/') ? outputFilename.substring(1) : outputFilename;
     return `${getS3SizeBasePath(productNameSanitized, variantNameSanitized, sizeKey)}/${cleanFilename}`;
}

// --- Local Config Path ---
/**
 * Gets the full local path for the processor configuration file for a product.
 * @param {string} productNameOriginal The original (un-sanitized) product folder name.
 * @returns {string} The absolute file path.
 */
export function getLocalConfigFilePath(productNameOriginal) {
    // Store config inside the *input* product folder
    return path.join(Config.INPUT_DIR, productNameOriginal, Config.LOCAL_CONFIG_FILENAME);
}

// --- Output JSON Path ---
/**
 * Gets the full local path for the generated Sanity JSON file for a product.
 * @param {string} productNameSanitized
 * @returns {string} The absolute file path.
 */
export function getOutputJsonPath(productNameSanitized) {
    return path.join(Config.OUTPUT_JSON_DIR, `${productNameSanitized}.sanity.json`);
}

// --- Public S3 URL Construction ---
/**
 * Constructs the public URL for an S3 object key.
 * Uses S3_PUBLIC_URL_BASE from config if available, otherwise attempts to construct.
 * @param {string} s3Key The S3 object key.
 * @returns {string} The public URL.
 */
export function getPublicS3Url(s3Key) {
    if (Config.S3_PUBLIC_URL_BASE) {
        const cleanedBase = Config.S3_PUBLIC_URL_BASE.endsWith('/')
            ? Config.S3_PUBLIC_URL_BASE
            : Config.S3_PUBLIC_URL_BASE + '/';
        const cleanedKey = s3Key.startsWith('/') ? s3Key.substring(1) : s3Key;
        return `${cleanedBase}${cleanedKey}`;
    }
    if (Config.S3_ENDPOINT && Config.S3_BUCKET) {
         try {
             const endpointHost = Config.S3_ENDPOINT.replace(/^https?:\/\//, '');
             return `https://${Config.S3_BUCKET}.${endpointHost}/${s3Key}`;
         } catch (e) {
              console.warn(`⚠️ Could not parse S3_ENDPOINT ('${Config.S3_ENDPOINT}') to construct URL.`);
         }
    }
    console.warn(`⚠️ Cannot construct public S3 URL for ${s3Key}. Check S3_PUBLIC_URL_BASE or S3_ENDPOINT/S3_BUCKET config.`);
    return `s3://${Config.S3_BUCKET || 'MISSING_BUCKET'}/${s3Key}`;
}