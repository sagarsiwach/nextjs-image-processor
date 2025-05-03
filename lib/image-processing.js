// lib/image-processing.js
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs/promises";
const deepcopy = (obj) => JSON.parse(JSON.stringify(obj));

import * as Config from "./config";
import * as Utils from "./utils";
import * as S3 from "./s3-helpers";
import * as Status from "./status";
import * as ProductIO from "./product-io";

import natsort from "natsort";
const natsorted = natsort({ insensitive: true });

// Prevent sharp from caching files (useful for development)
sharp.cache(false);

/**
 * @typedef {object} SingleImageSizeResult
 * @property {boolean} success - Whether processing succeeded for this size.
 * @property {string | null} s3Key - The S3 key if successful, otherwise null.
 * @property {string} filename - Original input filename.
 * @property {string} sizeKey - The responsive size key (e.g., 'lg').
 */

/**
 * @typedef {Record<string, SingleImageSizeResult | null>} SingleImageResultsPerSize
 * // e.g., { lg: { success: true, s3Key: '...', ... }, md: null }
 */

/**
 * @typedef {Record<string, SingleImageResultsPerSize>} VariantImageResults
 * // e.g., { "001.jpg": { lg: {...}, md: {...} }, "002.jpg": {...} }
 */

/**
 * @typedef {object} VariantResult
 * @property {string} variantNameSanitized
 * @property {string} variantNameOriginal
 * @property {VariantImageResults} imageResults - Detailed results per input image and size.
 * @property {number} imagesWithErrors - Count of input images that had >= 1 size fail.
 * @property {boolean} criticalFailure - True if reading the variant dir failed.
 */

/**
 * Processes a single input image for all target responsive sizes.
 * @param {string} inputPath Full path to the local input image.
 * @param {string} productNameSanitized
 * @param {string} variantNameSanitized
 * @param {number} imageIndex 1-based index of the image within its variant sequence.
 * @param {Record<string, number>} targetSizes Map of size key to target width.
 * @param {Record<string, {x: number, y: number}>} hotspots Hotspot config for all sizes.
 * @returns {Promise<SingleImageResultsPerSize>} Results for all sizes of this single image.
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
  /** @type {SingleImageResultsPerSize} */
  const resultsForThisImage = {};
  let baseImage = null;
  /** @type {sharp.Metadata | undefined} */
  let metadata;

  try {
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
        let processor = baseImage.clone();

        // --- Optional Cropping Logic ---
        // if (cropping_needed) { processor = processor.extract(cropRegion); }
        // --- End Cropping ---

        processor = processor.resize({
          width: targetWidth,
          fit: sharp.fit.inside,
          withoutEnlargement: true,
        });

        const outputBuffer = await processor
          .avif({
            quality: Config.AVIF_QUALITY,
            effort: 4,
          })
          .toBuffer();

        const uploadSuccess = await S3.uploadBufferToS3(
          outputBuffer,
          s3Key,
          "image/avif"
        );

        resultsForThisImage[sizeKey] = {
          success: uploadSuccess,
          s3Key: uploadSuccess ? s3Key : null,
          filename: inputFilename, // Keep original filename for reference
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

    return resultsForThisImage; // Results for this image across all sizes
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Failed to load base image ${inputFilename}: ${errMsg}`);
    Status.addErrorLog(
      `Load Error (${productNameSanitized}/${variantNameSanitized}/${inputFilename}): ${errMsg}`,
      true
    );
    // Return failure structure for all sizes for this image
    const failedResults = {};
    for (const sizeKey of Config.SIZE_KEYS) {
      failedResults[sizeKey] = {
        success: false,
        s3Key: null,
        filename: inputFilename,
        sizeKey: sizeKey,
      };
    }
    return failedResults;
  }
}

/**
 * Processes all valid images within a specific variant directory.
 * Uses parallel processing up to MAX_PROCESSING_WORKERS.
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
    `   Processing ${filePaths.length} images for variant: ${variantNameOriginal} (Concurrency: ${Config.MAX_PROCESSING_WORKERS})...`
  );

  // --- Parallel Processing Logic ---
  const resultsMap = new Map(); // Store results keyed by input path
  const concurrency = Config.MAX_PROCESSING_WORKERS;
  let inflight = 0;
  let currentIndex = 0;
  let imagesWithErrorCount = 0;
  const totalImages = filePaths.length;

  await new Promise((resolve, reject) => {
    function runNext() {
      if (Status.shutdown_event.isSet()) {
        console.warn("   Shutdown requested, stopping task submission.");
        // If already shutting down, resolve early? Or let inflight finish?
        // Let's resolve to ensure finally blocks run.
        if (inflight === 0) resolve(undefined);
        return;
      }

      while (inflight < concurrency && currentIndex < totalImages) {
        const filePath = filePaths[currentIndex];
        const imageIndex = currentIndex + 1; // 1-based index
        inflight++;
        currentIndex++;

        // Log start
        console.log(
          `      [${imageIndex}/${totalImages}] Starting: ${path.basename(
            filePath
          )}`
        );

        processSingleImage(
          filePath,
          productNameSanitized,
          variantNameSanitized,
          imageIndex,
          Config.RESPONSIVE_SIZES,
          hotspots
        )
          .then((result) => {
            resultsMap.set(filePath, result); // Store result associated with input path
            // Check if any size failed for this image
            if (Object.values(result).some((res) => res?.success === false)) {
              imagesWithErrorCount++;
              console.warn(
                `      [${imageIndex}/${totalImages}] Finished ${path.basename(
                  filePath
                )} with ERRORS.`
              );
            } else {
              console.log(
                `      [${imageIndex}/${totalImages}] Finished ${path.basename(
                  filePath
                )} successfully.`
              );
            }
          })
          .catch((err) => {
            // Catch errors from processSingleImage itself if it throws unexpectedly
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(
              `   💥 UNEXPECTED error processing image ${path.basename(
                filePath
              )}: ${errMsg}`
            );
            Status.addErrorLog(
              `Unexpected Image Proc Error (${path.basename(
                filePath
              )}): ${errMsg}`,
              true
            );
            imagesWithErrorCount++; // Count as error
            // Store a failure indication
            const failedResults = {};
            for (const sizeKey of Config.SIZE_KEYS) {
              failedResults[sizeKey] = {
                success: false,
                s3Key: null,
                filename: path.basename(filePath),
                sizeKey: sizeKey,
              };
            }
            resultsMap.set(filePath, failedResults);
          })
          .finally(() => {
            inflight--;
            // If all tasks are submitted and all inflight tasks are done, resolve
            if (currentIndex === totalImages && inflight === 0) {
              resolve(undefined);
            } else {
              // Otherwise, try to run the next task
              runNext();
            }
          });
      } // end while loop

      // If all tasks submitted but some still running, the finally block will handle resolution
      if (currentIndex === totalImages && inflight === 0) {
        resolve(undefined);
      }
    }
    runNext(); // Start the first batch
  }); // End Promise

  // Aggregate final results after parallel execution
  variantResult.imagesWithErrors = imagesWithErrorCount;
  filePaths.forEach((fp) => {
    const inputFilename = path.basename(fp);
    variantResult.imageResults[inputFilename] = resultsMap.get(fp) || {}; // Add results to the final structure
  });

  console.log(
    `   Finished variant ${variantNameOriginal}. Images with errors: ${variantResult.imagesWithErrors}`
  );
  if (variantResult.imagesWithErrors > 0) Status.updateSystemStatus("WARNING");
  return variantResult;
}

/**
 * Orchestrates processing for all variants of a product.
 * Reads local config, processes variants in parallel, generates final JSON, saves JSON.
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
  // Ensure status is marked as processing *before* async operations
  Status.setProcessingStatus(productNameSanitized, true);

  try {
    // 1. Load local config (includes hotspots)
    const localConfig = await ProductIO.loadLocalProcessorConfig(
      productOriginalName
    );
    const hotspots = localConfig.hotspots;

    // 2. Find variant directories
    const variantNames = await ProductIO.listVariantFolders(
      productOriginalName
    );
    if (variantNames.length === 0) {
      console.warn(
        `⚠️ No variant subdirectories found in ${productInputPath}.`
      );
      // Set status to finished even if no variants found
      Status.setProcessingStatus(productNameSanitized, false);
      return null;
    }
    console.log(
      `   Found ${variantNames.length} variants: [${variantNames.join(
        ", "
      )}]. Processing...`
    );

    // 3. Process Variants (Sequentially for now, internal parallelism handles images)
    // TODO: Could parallelize variant processing itself if needed (more complex state management)
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

    // 4. Generate and Save JSON if successful
    if (!productLevelCriticalError && !Status.shutdown_event.isSet()) {
      console.log(
        `   Aggregating results and generating final JSON for Sanity...`
      );

      /** @type {ProductIO.ProcessedVariantInfo[]} */
      const processedVariantsInfo = allVariantResults
        .filter((vr) => !vr.criticalFailure) // Filter out variants that failed critically
        .map((vr) => {
          /** @type {Record<string, string[]>} */
          const s3UrlsPerSize = {};
          Config.SIZE_KEYS.forEach((sk) => {
            s3UrlsPerSize[sk] = [];
          }); // Initialize all size keys

          // Iterate through results for each INPUT image filename
          Object.values(vr.imageResults).forEach((sizeResultsMap) => {
            // Iterate through results for each SIZE of that input image
            Object.values(sizeResultsMap).forEach((result) => {
              if (result?.success && result.s3Key) {
                // Add the public URL to the correct size array
                s3UrlsPerSize[result.sizeKey]?.push(
                  Utils.getPublicS3Url(result.s3Key)
                );
              }
            });
          });

          // Sort URLs within each size array naturally based on the original index
          // (assuming filename structure {prod}_{var}_{index}_{size}.avif)
          const urlSortKeyExtractor = (url) => {
            const match = url.match(/_(\d+)_[\w]+\.avif$/);
            return match ? parseInt(match[1], 10) : Infinity;
          };
          for (const sizeKey in s3UrlsPerSize) {
            s3UrlsPerSize[sizeKey].sort(
              (a, b) => urlSortKeyExtractor(a) - urlSortKeyExtractor(b)
            );
          }

          return {
            variantNameSanitized: vr.variantNameSanitized,
            variantNameOriginal: vr.variantNameOriginal,
            processedS3UrlsPerSize: s3UrlsPerSize, // Aggregated S3 URLs
          };
        })
        .filter((info) =>
          Object.values(info.processedS3UrlsPerSize).some(
            (urls) => urls.length > 0
          )
        ); // Ensure variant has *some* images

      // Generate the final JSON structure using the aggregated data
      const sanityJson = await ProductIO.generateSanityJson(
        productNameSanitized,
        productOriginalName,
        localConfig, // Pass loaded config for title/subtitle/variant meta
        processedVariantsInfo // Pass aggregated & structured results
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
      `❌ Critical error during product processing orchestrator for ${productNameOriginal}: ${errMsg}`,
      error
    );
    Status.addErrorLog(
      `Critical Product Error (${productNameOriginal}): ${errMsg}`,
      true
    );
    productLevelCriticalError = true;
    return null; // Indicate failure
  } finally {
    // Ensure status is *always* cleared, regardless of success/failure/shutdown
    Status.setProcessingStatus(productNameSanitized, false);
    // Update system status based on whether critical errors occurred *during this run*
    if (productLevelCriticalError) Status.updateSystemStatus("ERROR");
    // Warnings are handled within processVariant
    console.log(
      `--- Finished Product Processing Orchestration: ${productNameOriginal} ---`
    );
  }
}

/**
 * Clears the S3 cache for a specific product and its local config file.
 * @param {string} productOriginalName The original product folder name.
 * @returns {Promise<void>}
 */
export async function clearProductCache(productOriginalName) {
  const productNameSanitized = Utils.sanitizeName(productOriginalName);
  console.warn(
    `🗑️ Clearing cache for product: ${productOriginalName} (${productNameSanitized})...`
  );

  // Delete S3 objects with the product prefix
  const s3Prefix = Utils.getS3ProductBasePath(productNameSanitized) + "/"; // Ensure trailing slash
  const deletedCount = await S3.deleteS3Prefix(s3Prefix);
  console.log(
    `   Deleted ${deletedCount} objects from S3 for ${productOriginalName}.`
  );

  // Delete local config file associated with the product
  const localConfigPath = Utils.getLocalConfigFilePath(productOriginalName);
  try {
    const exists = await Bun.file(localConfigPath).exists();
    if (exists) {
      await fs.unlink(localConfigPath);
      console.log(`   Deleted local config file: ${localConfigPath}`);
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
