// lib/image-processing.js
import sharp from "sharp";
import { natsorted } from "natsort";
import path from "node:path";
import fs from "node:fs/promises";
import { deepcopy } from "bun";

import * as Config from "./config";
import * as Utils from "./utils";
import * as S3 from "./s3-helpers";
import * as Status from "./status";
import * as ProductIO from "./product-io"; // Import product IO functions

// Prevent sharp from caching files between runs (useful for dev)
sharp.cache(false);

/**
 * Processes a single input image for all target responsive sizes.
 * Resizes, converts to AVIF, and uploads to S3.
 * @param {string} inputPath Full path to the local input image.
 * @param {string} productNameSanitized
 * @param {string} variantNameSanitized
 * @param {number} imageIndex 1-based index of the image within its variant sequence.
 * @param {Record<string, number>} targetSizes Map of size key ('lg', 'md'...) to target width.
 * @param {Record<string, {x: number, y: number}>} hotspots Hotspot config for all sizes.
 * @returns {Promise<{ [inputFilename: string]: Record<string, { success: boolean; s3Key: string | null; filename: string; sizeKey: string } | null> }>}
 *          An object keyed by the input filename, containing results per size key.
 */
async function processSingleImage(
  inputPath,
  productNameSanitized,
  variantNameSanitized,
  imageIndex,
  targetSizes,
  hotspots
) {
  const inputFilename = path.basename(inputPath);
  /** @type {Record<string, { success: boolean; s3Key: string | null; filename: string; sizeKey: string } | null>} */
  const resultsForThisImage = {};
  let baseImage = null;
  /** @type {sharp.Metadata | undefined} */
  let metadata;

  try {
    // Load base image *once*
    baseImage = sharp(inputPath);
    metadata = await baseImage.metadata();
    if (!metadata?.width || !metadata?.height) {
      throw new Error(`Could not read metadata for ${inputFilename}`);
    }
    // Sharp handles EXIF orientation automatically by default

    for (const sizeKey of Config.SIZE_KEYS) {
      if (Status.shutdown_event.isSet()) throw new Error("Shutdown requested");

      const targetWidth = targetSizes[sizeKey];
      const outputFilename = `${productNameSanitized}_${variantNameSanitized}_${imageIndex}_${sizeKey}.avif`;
      const s3Key = Utils.getS3ImageKey(
        productNameSanitized,
        variantNameSanitized,
        sizeKey,
        outputFilename
      );
      const currentHotspot = hotspots[sizeKey] ?? Config.DEFAULT_HOTSPOT;

      try {
        let processor = baseImage.clone(); // Start from the original oriented image

        // --- Optional Cropping Placeholder ---
        // Calculate cropRegion = { left, top, width, height } based on hotspot, metadata...
        // if (needs_crop) { processor = processor.extract(cropRegion); }
        // --- End Placeholder ---

        // Resize
        processor = processor.resize({
          width: targetWidth,
          fit: sharp.fit.inside, // Fit entirely within dimensions, preserve aspect ratio
          withoutEnlargement: true, // Don't scale up small images
          // position: sharp.strategy.attention // Example: focus on 'interesting' area
        });

        // Convert to AVIF buffer
        const outputBuffer = await processor
          .avif({
            quality: Config.AVIF_QUALITY,
            effort: 4, // Lower effort = faster encode (0-9)
          })
          .toBuffer();

        // Upload buffer to S3
        const uploadSuccess = await S3.uploadBufferToS3(
          outputBuffer,
          s3Key,
          "image/avif"
        );

        resultsForThisImage[sizeKey] = {
          success: uploadSuccess,
          s3Key: uploadSuccess ? s3Key : null,
          filename: inputFilename, // Keep original filename for reference if needed
          sizeKey: sizeKey,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `   ❌ Error processing size '${sizeKey}' for ${inputFilename}: ${errMsg}`
        );
        Status.addErrorLog(
          `Processing Error (${productNameSanitized}/${variantNameSanitized}/${sizeKey}/${inputFilename}): ${errMsg}`,
          false
        );
        resultsForThisImage[sizeKey] = {
          success: false,
          s3Key: null,
          filename: inputFilename,
          sizeKey: sizeKey,
        };
      }
    } // End size loop

    return { [inputFilename]: resultsForThisImage };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Failed to load base image ${inputFilename}: ${errMsg}`);
    Status.addErrorLog(
      `Load Error (${productNameSanitized}/${variantNameSanitized}/${inputFilename}): ${errMsg}`,
      true
    );
    // Return failure structure for all sizes
    const failedResults = {};
    for (const sizeKey of Config.SIZE_KEYS) {
      failedResults[sizeKey] = {
        success: false,
        s3Key: null,
        filename: inputFilename,
        sizeKey: sizeKey,
      };
    }
    return { [inputFilename]: failedResults };
  }
}

/**
 * Processes all valid images within a specific variant directory.
 * @param {string} productNameSanitized
 * @param {string} variantNameOriginal
 * @param {string} inputVariantDir Full path to the variant's input directory.
 * @param {Record<string, {x: number, y: number}>} hotspots Hotspot config for all sizes.
 * @returns {Promise<VariantResult>} Results including errors and processed file info.
 */
export async function processVariant(
  productNameSanitized,
  variantNameOriginal,
  inputVariantDir,
  hotspots
) {
  const variantNameSanitized = Utils.sanitizeName(variantNameOriginal);
  /** @type {VariantResult} */
  const variantResult = {
    variantNameSanitized,
    variantNameOriginal,
    imageResults: {},
    imagesWithErrors: 0,
    criticalFailure: false,
  };
  let filePaths = [];

  try {
    const dirents = await fs.readdir(inputVariantDir, { withFileTypes: true });
    const imageFiles = dirents
      .filter(
        (d) =>
          d.isFile() &&
          Config.VALID_INPUT_EXTENSIONS.has(path.extname(d.name).toLowerCase())
      )
      .map((d) => d.name);

    if (imageFiles.length === 0) {
      console.warn(
        `   ⚠️ No valid source images found in ${variantNameOriginal}`
      );
      return variantResult;
    }
    filePaths = natsorted(imageFiles).map((fname) =>
      path.join(inputVariantDir, fname)
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(
      `❌ Failed to read input directory ${inputVariantDir}: ${errMsg}`
    );
    Status.addErrorLog(
      `Directory Read Error (${variantNameOriginal}): ${errMsg}`,
      true
    );
    variantResult.criticalFailure = true;
    return variantResult;
  }

  console.log(
    `   Processing ${filePaths.length} images for variant: ${variantNameOriginal}...`
  );

  // --- Parallel Processing Setup ---
  const resultsArray = []; // Collect results from promises
  const concurrency = Config.MAX_PROCESSING_WORKERS;
  let processingIndex = 0; // Keep track of overall index for naming

  // Function to run a single processing task
  const runTask = async (filePath, index) => {
    if (Status.shutdown_event.isSet()) return null; // Skip if shutting down
    console.log(
      `      [${index + 1}/${filePaths.length}] Processing: ${path.basename(
        filePath
      )}`
    );
    return processSingleImage(
      filePath,
      productNameSanitized,
      variantNameSanitized,
      index + 1, // 1-based index
      Config.RESPONSIVE_SIZES,
      hotspots
    );
  };

  // Create and manage promises with limited concurrency
  const executing = new Set();
  for (const filePath of filePaths) {
    if (Status.shutdown_event.isSet()) {
      console.warn("   Shutdown requested, stopping variant task submission.");
      break;
    }

    // Wait if concurrency limit is reached
    while (executing.size >= concurrency) {
      await Promise.race(executing); // Wait for *any* promise to finish
    }

    const promise = runTask(filePath, processingIndex).then((result) => {
      executing.delete(promise); // Remove promise from executing set when done
      return result; // Pass result along
    });

    executing.add(promise); // Add new promise to tracking set
    resultsArray.push(promise); // Store promise to await all later
    processingIndex++;
  }

  // Wait for all remaining promises to complete
  const allResults = await Promise.all(resultsArray);

  // Aggregate results and count errors
  allResults.forEach((imgResult) => {
    if (imgResult) {
      // Check if task was skipped due to shutdown
      Object.assign(variantResult.imageResults, imgResult);
      const filename = Object.keys(imgResult)[0];
      const sizes = imgResult[filename];
      // Check if *any* size failed for this image
      if (Object.values(sizes).some((res) => res?.success === false)) {
        variantResult.imagesWithErrors++;
      }
    }
  });

  console.log(
    `   Finished variant ${variantNameOriginal}. Images with errors: ${variantResult.imagesWithErrors}`
  );
  if (variantResult.imagesWithErrors > 0) Status.updateSystemStatus("WARNING");
  return variantResult;
}

/**
 * Orchestrates processing for all variants of a product.
 * Reads local config, processes variants, generates final JSON, saves JSON.
 * @param {string} productOriginalName The original product folder name.
 * @returns {Promise<object | null>} The generated Sanity JSON object, or null on critical failure.
 */
export async function processProduct(productOriginalName) {
  const productNameSanitized = Utils.sanitizeName(productOriginalName);
  const productInputPath = path.join(Config.INPUT_DIR, productOriginalName);
  /** @type {VariantResult[]} */
  const allVariantResults = [];
  let productLevelCriticalError = false;

  console.log(`\n--- Processing Product: ${productOriginalName} ---`);
  Status.setProcessingStatus(productNameSanitized, true);

  try {
    // Load local configuration (title, subtitle, hotspots)
    const localConfig = await ProductIO.loadLocalProcessorConfig(
      productOriginalName
    );
    const hotspots = localConfig.hotspots;

    // Find variant directories
    const variantNames = await ProductIO.listVariantFolders(
      productOriginalName
    );
    if (variantNames.length === 0) {
      console.warn(
        `⚠️ No variant subdirectories found in ${productInputPath}.`
      );
      return null; // Nothing to process
    }
    console.log(`   Found ${variantNames.length} variants. Processing...`);

    // Process variants sequentially (to avoid overwhelming resources further)
    // Could be parallelized too, but start simpler.
    for (const variantName of variantNames) {
      if (Status.shutdown_event.isSet()) {
        console.warn("   Shutdown requested...");
        productLevelCriticalError = true;
        break;
      }

      const variantInputPath = path.join(productInputPath, variantName);
      const result = await processVariant(
        productNameSanitized,
        variantName,
        variantInputPath,
        hotspots
      );
      allVariantResults.push(result);
      if (result.criticalFailure) {
        productLevelCriticalError = true;
      }
    }

    // Proceed only if no critical errors and not shut down
    if (!productLevelCriticalError && !Status.shutdown_event.isSet()) {
      console.log(`   Generating final JSON for Sanity...`);

      // --- Aggregate S3 URLs for JSON generation ---
      /** @type {ProductIO.ProcessedVariantInfo[]} */
      const processedVariantsInfo = allVariantResults
        .map((vr) => {
          /** @type {Record<string, string[]>} */
          const s3UrlsPerSize = {};
          for (const sizeKey of Config.SIZE_KEYS) {
            s3UrlsPerSize[sizeKey] = []; // Initialize array for each size
          }

          // Iterate through results for each *input image*
          Object.values(vr.imageResults).forEach((sizeResults) => {
            // Iterate through results for each *size* of that input image
            Object.values(sizeResults).forEach((result) => {
              if (result?.success && result.s3Key) {
                s3UrlsPerSize[result.sizeKey].push(
                  Utils.getPublicS3Url(result.s3Key)
                );
              }
            });
          });

          // Natural sort the URLs within each size array based on the original index embedded in the key/filename
          for (const sizeKey in s3UrlsPerSize) {
            s3UrlsPerSize[sizeKey] = natsorted(s3UrlsPerSize[sizeKey]);
          }

          return {
            variantNameSanitized: vr.variantNameSanitized,
            variantNameOriginal: vr.variantNameOriginal,
            processedS3UrlsPerSize: s3UrlsPerSize,
          };
        })
        .filter((info) =>
          Object.values(info.processedS3UrlsPerSize).some(
            (urls) => urls.length > 0
          )
        ); // Filter out variants with zero successful images

      // Generate the final JSON payload
      const sanityJson = await ProductIO.generateSanityJson(
        productNameSanitized,
        productOriginalName,
        localConfig, // Pass loaded config for title/subtitle
        processedVariantsInfo // Pass aggregated results
      );

      // Save the generated JSON locally
      await ProductIO.saveOutputJson(productNameSanitized, sanityJson);
      return sanityJson; // Return the generated JSON
    } else {
      console.error(
        `   Product processing stopped due to critical errors or shutdown for ${productNameOriginal}. Output JSON not generated.`
      );
      return null;
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `❌ Critical error processing product ${productNameOriginal}: ${errMsg}`,
      error
    );
    Status.addErrorLog(
      `Critical Product Error (${productOriginalName}): ${errMsg}`,
      true
    );
    productLevelCriticalError = true; // Ensure error status is set
    return null;
  } finally {
    Status.setProcessingStatus(productNameSanitized, false);
    if (productLevelCriticalError) Status.updateSystemStatus("ERROR");
    console.log(`--- Finished Product Processing: ${productNameOriginal} ---`);
  }
}

/**
 * Clears the S3 cache for a specific product and its local config file.
 * @param {string} productOriginalName The original product folder name.
 */
export async function clearProductCache(productOriginalName) {
  const productNameSanitized = Utils.sanitizeName(productOriginalName);
  console.warn(
    `🗑️ Clearing cache for product: ${productOriginalName} (${productNameSanitized})...`
  );

  // Delete S3 objects
  const s3Prefix = Utils.getS3ProductBasePath(productNameSanitized) + "/";
  const deletedCount = await S3.deleteS3Prefix(s3Prefix);
  console.log(
    `   Deleted ${deletedCount} objects from S3 for ${productOriginalName}.`
  );

  // Delete local config file
  const localConfigPath = Utils.getLocalConfigFilePath(productOriginalName);
  try {
    const exists = await Bun.file(localConfigPath).exists();
    if (exists) {
      await fs.unlink(localConfigPath);
      console.log(`   Deleted local config file: ${localConfigPath}`);
    } else {
      // console.log(`   Local config file not found, nothing to delete: ${localConfigPath}`);
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(
      `   Failed to delete local config file ${localConfigPath}: ${errMsg}`
    );
    Status.addErrorLog(
      `Cache Clear Error (Local Config - ${productOriginalName}): ${errMsg}`,
      false
    );
  }
}
