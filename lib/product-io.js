// lib/product-io.js
import fs from "node:fs/promises"; // Use promise-based fs
import path from "node:path";
import { deepcopy } from "bun"; // Or use lodash/cloneDeep if not using Bun exclusively

import * as Config from "./config";
import * as Utils from "./utils";
import { addErrorLog } from "./status"; // Import status logging

/**
 * Represents the structure of the local configuration file.
 * @typedef {object} LocalConfig
 * @property {string} title
 * @property {string} subtitle
 * @property {Record<string, {x: number, y: number}>} hotspots
 * @property {Record<string, {name: string, colorValue: string}>} [variants] - Optional: Variant meta might be saved here but isn't strictly needed for processing trigger
 */

/**
 * Lists product folders found in the input directory.
 * @returns {Promise<Array<{name: string, path: string}>>} Array of product folder info.
 */
export async function listProductFolders() {
  /** @type {Array<{name: string, path: string}>} */
  const products = [];
  try {
    const dirents = await fs.readdir(Config.INPUT_DIR, { withFileTypes: true });
    for (const dirent of dirents) {
      // Skip hidden files/folders and the config file itself
      if (
        dirent.isDirectory() &&
        !dirent.name.startsWith(".") &&
        dirent.name !== Config.LOCAL_CONFIG_FILENAME
      ) {
        products.push({
          name: dirent.name,
          path: path.join(Config.INPUT_DIR, dirent.name),
        });
      }
    }
    return products.sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically
  } catch (error) {
    // Check if error is because the directory doesn't exist
    if (error instanceof Error && error.code === "ENOENT") {
      console.warn(`Input directory not found: ${Config.INPUT_DIR}`);
    } else {
      console.error(
        `❌ Error listing product folders in ${Config.INPUT_DIR}:`,
        error
      );
      addErrorLog(
        `Error listing input products: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    return []; // Return empty list on error
  }
}

/**
 * Lists variant folders found within a specific product's input directory.
 * @param {string} productOriginalName The original (un-sanitized) product folder name.
 * @returns {Promise<string[]>} Array of variant folder names.
 */
export async function listVariantFolders(productOriginalName) {
  const productPath = path.join(Config.INPUT_DIR, productOriginalName);
  /** @type {string[]} */
  const variants = [];
  try {
    const dirents = await fs.readdir(productPath, { withFileTypes: true });
    for (const dirent of dirents) {
      // Skip config file and hidden items, ensure it's a directory
      if (
        dirent.isDirectory() &&
        !dirent.name.startsWith(".") &&
        dirent.name !== Config.LOCAL_CONFIG_FILENAME
      ) {
        variants.push(dirent.name);
      }
    }
    // Use localeCompare for potentially better sorting than default
    return variants.sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") {
      console.warn(`Product input directory not found: ${productPath}`);
    } else {
      console.error(
        `❌ Error listing variant folders in ${productPath}:`,
        error
      );
      addErrorLog(
        `Error listing variants for ${productOriginalName}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    return [];
  }
}

/**
 * Loads the local processor configuration file for a product.
 * Returns defaults if the file doesn't exist or is invalid.
 * @param {string} productOriginalName The original product folder name.
 * @returns {Promise<LocalConfig>} The loaded or default configuration.
 */
export async function loadLocalProcessorConfig(productOriginalName) {
  const configPath = Utils.getLocalConfigFilePath(productOriginalName);
  /** @type {LocalConfig} */
  const defaults = {
    title: Config.DEFAULT_TITLE,
    subtitle: Config.DEFAULT_SUBTITLE,
    hotspots: deepcopy(Config.DEFAULT_HOTSPOTS_CONFIG),
    variants: {}, // Variants meta primarily managed by UI state before save
  };

  try {
    const fileExists = await Bun.file(configPath).exists(); // Efficient check
    if (fileExists) {
      const loadedConfig = await Bun.file(configPath).json();

      // Basic validation and merging - prioritize loaded data but ensure structure
      defaults.title =
        typeof loadedConfig.title === "string"
          ? loadedConfig.title
          : defaults.title;
      defaults.subtitle =
        typeof loadedConfig.subtitle === "string"
          ? loadedConfig.subtitle
          : defaults.subtitle;

      // Carefully merge hotspots, ensuring structure and defaults for missing/invalid keys
      if (
        typeof loadedConfig.hotspots === "object" &&
        loadedConfig.hotspots !== null
      ) {
        const loadedHotspots = loadedConfig.hotspots;
        for (const sizeKey of Config.SIZE_KEYS) {
          const hs = loadedHotspots[sizeKey];
          if (
            typeof hs === "object" &&
            hs !== null &&
            typeof hs.x === "number" &&
            typeof hs.y === "number" &&
            hs.x >= 0 &&
            hs.x <= 1 &&
            hs.y >= 0 &&
            hs.y <= 1
          ) {
            // Use loaded valid hotspot
            defaults.hotspots[sizeKey] = { x: hs.x, y: hs.y };
          } else {
            // Use default if loaded is missing or invalid for this key
            // console.debug(`Using default hotspot for '${sizeKey}' in ${productOriginalName} config load.`);
            defaults.hotspots[sizeKey] = deepcopy(Config.DEFAULT_HOTSPOT);
          }
        }
      } else {
        // If loaded "hotspots" isn't a valid object, keep all defaults
        defaults.hotspots = deepcopy(Config.DEFAULT_HOTSPOTS_CONFIG);
        console.warn(
          `Invalid 'hotspots' structure in ${configPath}, using defaults.`
        );
      }
      // We don't deeply merge variants here; the UI uses detected folders
      // and the saved 'variants' part is mostly for reference or if needed later.
      if (
        typeof loadedConfig.variants === "object" &&
        loadedConfig.variants !== null
      ) {
        defaults.variants = loadedConfig.variants;
      }
    }
  } catch (error) {
    // Handle JSON parsing errors or other file read errors
    console.error(`Error loading local config ${configPath}:`, error);
    addErrorLog(
      `Error loading local config for ${productOriginalName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      false
    );
  }
  return defaults; // Return merged/default config
}

/**
 * Saves the processor configuration (title, subtitle, hotspots) locally.
 * @param {string} productOriginalName Original product folder name.
 * @param {Partial<LocalConfig>} configData Data containing title, subtitle, and hotspots to save.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
export async function saveLocalProcessorConfig(
  productOriginalName,
  configData
) {
  const configPath = Utils.getLocalConfigFilePath(productOriginalName);
  const productPath = path.join(Config.INPUT_DIR, productOriginalName);

  // Prepare data to save: only title, subtitle, hotspots are persisted from input
  // Variant details are derived from folders during processing trigger
  /** @type {Omit<LocalConfig, 'variants'>} */
  const dataToSave = {
    title: configData.title ?? Config.DEFAULT_TITLE, // Use provided or default
    subtitle: configData.subtitle ?? Config.DEFAULT_SUBTITLE,
    // Assume hotspots structure was validated before calling save
    hotspots: configData.hotspots ?? deepcopy(Config.DEFAULT_HOTSPOTS_CONFIG),
  };

  try {
    await fs.mkdir(productPath, { recursive: true }); // Ensure product input dir exists
    // Use Bun.write for potentially better performance
    await Bun.write(configPath, JSON.stringify(dataToSave, null, 2));
    console.log(`💾 Saved local config: ${configPath}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to save local config ${configPath}:`, error);
    addErrorLog(
      `Error saving local config for ${productOriginalName}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }
}

/**
 * Saves the final generated JSON (intended for Sanity) to the local output directory.
 * @param {string} productNameSanitized
 * @param {object} data The JSON object data to save.
 * @returns {Promise<void>}
 */
export async function saveOutputJson(productNameSanitized, data) {
  const outputPath = Utils.getOutputJsonPath(productNameSanitized);
  try {
    await fs.mkdir(Config.OUTPUT_JSON_DIR, { recursive: true }); // Ensure output dir exists
    await Bun.write(outputPath, JSON.stringify(data, null, 2)); // Pretty print JSON
    console.log(
      `✅ Saved Sanity JSON for [${productNameSanitized}] to: ${outputPath}`
    );
  } catch (error) {
    console.error(
      `❌ Failed to save output JSON for ${productNameSanitized}:`,
      error
    );
    addErrorLog(
      `Save Output JSON Error (${productNameSanitized}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Represents the structure needed to generate the final Sanity JSON.
 * @typedef {object} ProcessedVariantInfo
 * @property {string} variantNameSanitized
 * @property {string} variantNameOriginal
 * @property {Record<string, string[]>} processedS3UrlsPerSize - e.g., { lg: ["s3://.../img_lg_1.avif", ...], md: [...] }
 */

/**
 * Generates the final JSON object structured for Sanity.
 * @param {string} productNameSanitized
 * @param {string} productOriginalName
 * @param {LocalConfig} localConfig - The loaded local config containing title, subtitle, etc.
 * @param {ProcessedVariantInfo[]} processedVariantsInfo - Array of results from processing variants.
 * @returns {Promise<object>} The final JSON object.
 */
export async function generateSanityJson(
  productNameSanitized,
  productOriginalName, // Needed? Can get title/subtitle from localConfig
  localConfig,
  processedVariantsInfo
) {
  const finalVariants = [];

  for (const variantInfo of processedVariantsInfo) {
    const imageSets = {};
    let variantHasImages = false;

    // Get variant display name and color from the *loaded* local config
    // Fallback to original name if not found in config (though UI should ensure it exists)
    const variantMetaData =
      localConfig.variants?.[variantInfo.variantNameSanitized] ?? {};
    const variantDisplayName =
      variantMetaData.name || variantInfo.variantNameOriginal;
    const variantColorValue =
      variantMetaData.colorValue || Config.DEFAULT_COLOR;

    // Map processed S3 URLs to JSON breakpoints
    for (const bpKey of Config.SORTED_BREAKPOINT_KEYS) {
      const sizeKey = Config.JSON_BREAKPOINTS[bpKey];
      // Get the array of S3 URLs for this sizeKey from the processed data
      const s3Urls = variantInfo.processedS3UrlsPerSize?.[sizeKey] ?? [];
      imageSets[bpKey] = s3Urls;
      if (s3Urls.length > 0) {
        variantHasImages = true;
      }
    }

    if (variantHasImages) {
      finalVariants.push({
        name: variantDisplayName,
        colorValue: variantColorValue,
        imageSets: imageSets,
      });
    } else {
      console.warn(
        `Skipping variant ${variantInfo.variantNameOriginal} in JSON output: No processed images found.`
      );
    }
  }

  const finalJson = {
    title: localConfig.title || Config.DEFAULT_TITLE,
    subtitle: localConfig.subtitle || Config.DEFAULT_SUBTITLE,
    // Do not include hotspots here unless Sanity schema requires them
    variants: finalVariants,
  };

  return finalJson;
}
