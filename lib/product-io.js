// lib/product-io.js
import fs from "node:fs/promises"; // Use promise-based fs
import path from "node:path";
import * as Utils from "./utils"; // Added import for Utils

// Replace Bun's deepcopy with JSON method or lodash
// Option 1: Simple JSON method (usually fine for config)
const deepcopy = (obj) => JSON.parse(JSON.stringify(obj));
// Option 2: Using lodash (install first: bun add lodash)
// import { cloneDeep as deepcopy } from 'lodash';

import * as Config from "./config";
import { addErrorLog } from "./status"; // Import status logging

// Add re-export of the function for compatibility
export const getLocalConfigFilePath = Utils.getLocalConfigFilePath;

/**
 * Represents the structure of the local configuration file.
 * @typedef {object} LocalConfig
 * @property {string} title
 * @property {string} subtitle
 * @property {Record<string, {x: number, y: number}>} hotspots
 * @property {Record<string, {name: string, colorValue: string}>} [variants]
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
    return products.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
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
    return [];
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
      if (
        dirent.isDirectory() &&
        !dirent.name.startsWith(".") &&
        dirent.name !== Config.LOCAL_CONFIG_FILENAME
      ) {
        variants.push(dirent.name);
      }
    }
    return variants.sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") {
      // Don't log error if product dir just doesn't exist yet
      // console.warn(`Product input directory not found for listing variants: ${productPath}`);
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
 * Checks if a file exists using Node.js fs.access.
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads the local processor configuration file for a product.
 * Returns defaults if the file doesn't exist or is invalid.
 * @param {string} productOriginalName The original product folder name.
 * @returns {Promise<LocalConfig>} The loaded or default configuration.
 */
export async function loadLocalProcessorConfig(productOriginalName) {
  const configPath = Utils.getLocalConfigFilePath(productOriginalName); // Use Utils directly
  /** @type {LocalConfig} */
  const defaults = {
    title: Config.DEFAULT_TITLE,
    subtitle: Config.DEFAULT_SUBTITLE,
    hotspots: deepcopy(Config.DEFAULT_HOTSPOTS_CONFIG),
    variants: {},
  };

  try {
    // Replace Bun.file().exists()
    if (await fileExists(configPath)) {
      // Replace Bun.file().json()
      const fileContent = await fs.readFile(configPath, "utf-8");
      const loadedConfig = JSON.parse(fileContent);

      // --- Validation and Merging (same logic as before) ---
      defaults.title =
        typeof loadedConfig.title === "string"
          ? loadedConfig.title
          : defaults.title;
      defaults.subtitle =
        typeof loadedConfig.subtitle === "string"
          ? loadedConfig.subtitle
          : defaults.subtitle;

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
            defaults.hotspots[sizeKey] = { x: hs.x, y: hs.y };
          } else {
            defaults.hotspots[sizeKey] = deepcopy(Config.DEFAULT_HOTSPOT);
          }
        }
      } else {
        defaults.hotspots = deepcopy(Config.DEFAULT_HOTSPOTS_CONFIG);
      }
      if (
        typeof loadedConfig.variants === "object" &&
        loadedConfig.variants !== null
      ) {
        defaults.variants = loadedConfig.variants;
      }
      // --- End Validation ---
    }
  } catch (error) {
    console.error(`Error loading local config ${configPath}:`, error);
    addErrorLog(
      `Error loading local config for ${productOriginalName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      false
    );
  }
  return defaults;
}

/**
 * Saves the processor configuration (title, subtitle, hotspots) locally.
 * @param {string} productOriginalName Original product folder name.
 * @param {Partial<Pick<LocalConfig, 'title' | 'subtitle' | 'hotspots'>>} configData Data containing title, subtitle, and hotspots to save.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
export async function saveLocalProcessorConfig(
  productOriginalName,
  configData
) {
  const configPath = Utils.getLocalConfigFilePath(productOriginalName); // Use Utils directly
  const productPath = path.join(Config.INPUT_DIR, productOriginalName);

  /** @type {Pick<LocalConfig, 'title' | 'subtitle' | 'hotspots'>} */
  const dataToSave = {
    title: configData.title ?? Config.DEFAULT_TITLE,
    subtitle: configData.subtitle ?? Config.DEFAULT_SUBTITLE,
    hotspots: configData.hotspots ?? deepcopy(Config.DEFAULT_HOTSPOTS_CONFIG),
    // Note: We explicitly DO NOT save the 'variants' part here from the input `configData`.
    // The variants structure in the saved file might be useful for reference,
    // but the processing should rely on actually detected folders.
  };

  // --- Hotspot Validation before save --- (Optional but recommended)
  if (typeof dataToSave.hotspots === "object" && dataToSave.hotspots !== null) {
    for (const sizeKey of Config.SIZE_KEYS) {
      const hs = dataToSave.hotspots[sizeKey];
      if (
        !(
          typeof hs === "object" &&
          hs !== null &&
          typeof hs.x === "number" &&
          typeof hs.y === "number" &&
          hs.x >= 0 &&
          hs.x <= 1 &&
          hs.y >= 0 &&
          hs.y <= 1
        )
      ) {
        console.warn(
          `Correcting invalid hotspot data for '${sizeKey}' before saving config for ${productOriginalName}.`
        );
        dataToSave.hotspots[sizeKey] = deepcopy(Config.DEFAULT_HOTSPOT);
      }
    }
  } else {
    console.warn(
      `Invalid 'hotspots' structure during save for ${productOriginalName}, saving defaults.`
    );
    dataToSave.hotspots = deepcopy(Config.DEFAULT_HOTSPOTS_CONFIG);
  }
  // --- End Validation ---

  try {
    await fs.mkdir(productPath, { recursive: true }); // Ensure product input dir exists
    // Replace Bun.write()
    await fs.writeFile(configPath, JSON.stringify(dataToSave, null, 2)); // Pretty print
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
 * Represents the aggregated info needed to generate the final JSON.
 * @typedef {object} ProcessedVariantInfo
 * @property {string} variantNameSanitized
 * @property {string} variantNameOriginal
 * @property {Record<string, string[]>} processedS3UrlsPerSize - e.g., { lg: ["https://.../img_lg_1.avif", ...], md: [...] }
 */

/**
 * Generates the final JSON object structured for Sanity.
 * @param {string} productNameSanitized
 * @param {string} productOriginalName
 * @param {LocalConfig} localConfig - The loaded local config containing title, subtitle, variant meta etc.
 * @param {ProcessedVariantInfo[]} processedVariantsInfo - Array of results containing aggregated S3 URLs per size.
 * @returns {Promise<object>} The final JSON object.
 */
export async function generateSanityJson(
  productNameSanitized,
  productOriginalName,
  localConfig,
  processedVariantsInfo
) {
  const finalVariants = [];

  for (const variantInfo of processedVariantsInfo) {
    const imageSets = {};
    let variantHasImages = false;

    // Get variant display name and color from the *loaded* local config for consistency
    const variantMetaData =
      localConfig.variants?.[variantInfo.variantNameSanitized] ?? {};
    const variantDisplayName =
      variantMetaData.name || variantInfo.variantNameOriginal;
    const variantColorValue =
      variantMetaData.colorValue || Config.DEFAULT_COLOR;

    // Map processed S3 URLs (passed in processedVariantsInfo) to JSON breakpoints
    for (const bpKey of Config.SORTED_BREAKPOINT_KEYS) {
      const sizeKey = Config.JSON_BREAKPOINTS[bpKey];
      const s3Urls = variantInfo.processedS3UrlsPerSize?.[sizeKey] ?? [];
      imageSets[bpKey] = s3Urls; // Assign the list of URLs
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
        `Skipping variant ${variantInfo.variantNameOriginal} in JSON output: No processed images found after aggregation.`
      );
    }
  }

  // Use title/subtitle from the loaded local config
  const finalJson = {
    title: localConfig.title || Config.DEFAULT_TITLE,
    subtitle: localConfig.subtitle || Config.DEFAULT_SUBTITLE,
    variants: finalVariants,
  };

  return finalJson;
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
    // Replace Bun.write()
    await fs.writeFile(outputPath, JSON.stringify(data, null, 2)); // Pretty print JSON
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
