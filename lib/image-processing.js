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
// Create the natsort function correctly
const naturalSort = natsort({ insensitive: true });

// Prevent sharp from caching files (useful for development)
sharp.cache(false);

/**
 * @typedef {object} SingleImageSizeResult
 * @property {boolean} success - Whether processing succeeded for this size.
 * @property {string | null} outputPath - The local path if successful, otherwise null.
 * @property {string | null} s3Key - The S3 key for future upload, otherwise null.
 * @property {string} filename - Original input filename.
 * @property {string} sizeKey - The responsive size key (e.g., 'lg').
 * @property {number} width - The width of the processed image.
 * @property {number} height - The height of the processed image.
 */

/**
 * @typedef {Record<string, SingleImageSizeResult | null>} SingleImageResultsPerSize
 * // e.g., { lg: { success: true, outputPath: '...', ... }, md: null }
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
 * @property {Record<string, Array<{width: number, height: number, outputPath: string, s3Key: string}>>} dimensionsPerSize
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
 * @param {Record<string, {x: number, y: number, width: number, height: number}>} hotspots Hotspot config for all sizes.
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

      const targetWidth = Config.RESPONSIVE_SIZES[sizeKey];
      const outputFilename = `${productNameSanitized}_${variantNameSanitized}_${imageIndex}_${sizeKey}.avif`;
      const s3Key = Utils.getS3ImageKey(
        productNameSanitized,
        variantNameSanitized,
        sizeKey,
        outputFilename
      );

      // Get the hotspot data for this size or use default
      const currentHotspot = hotspots[sizeKey] ?? Config.DEFAULT_HOTSPOT;

      try {
        let processor = baseImage.clone();

        // Calculate target output dimensions based on the required aspect ratio
        let targetHeight;

        // For tablet and phone, use portrait orientation (9:16)
        if (sizeKey === "tablet" || sizeKey === "phone") {
          targetHeight = Math.round((targetWidth * 16) / 9); // Portrait 9:16
        } else {
          targetHeight = Math.round((targetWidth * 9) / 16); // Landscape 16:9
        }

        // Check if we have the complete crop info (new format)
        const hasFullCropInfo =
          typeof currentHotspot.width === "number" &&
          typeof currentHotspot.height === "number";

        if (hasFullCropInfo) {
          // Use the user-specified crop area directly
          const cropLeft = Math.round(metadata.width * currentHotspot.x);
          const cropTop = Math.round(metadata.height * currentHotspot.y);
          const cropWidth = Math.round(metadata.width * currentHotspot.width);
          const cropHeight = Math.round(
            metadata.height * currentHotspot.height
          );

          // Make sure we don't try to crop outside the image boundaries
          const validCropLeft = Math.max(
            0,
            Math.min(cropLeft, metadata.width - 1)
          );
          const validCropTop = Math.max(
            0,
            Math.min(cropTop, metadata.height - 1)
          );
          const validCropWidth = Math.max(
            1,
            Math.min(cropWidth, metadata.width - validCropLeft)
          );
          const validCropHeight = Math.max(
            1,
            Math.min(cropHeight, metadata.height - validCropTop)
          );

          // Apply crop using the exact coordinates from the UI
          processor = processor.extract({
            left: validCropLeft,
            top: validCropTop,
            width: validCropWidth,
            height: validCropHeight,
          });
        } else {
          // Legacy hotspot-only format - use old logic to calculate crop area
          const inputAspectRatio = metadata.width / metadata.height;
          const targetAspectRatio = targetWidth / targetHeight;

          let cropWidth,
            cropHeight,
            cropLeft = 0,
            cropTop = 0;

          if (inputAspectRatio > targetAspectRatio) {
            // Input is wider than target: crop width
            cropHeight = metadata.height;
            cropWidth = Math.round(cropHeight * targetAspectRatio);

            // Center crop around hotspot X position
            const hotspotXPosition = Math.round(
              metadata.width * currentHotspot.x
            );
            cropLeft = Math.max(
              0,
              Math.min(
                hotspotXPosition - Math.round(cropWidth / 2),
                metadata.width - cropWidth
              )
            );
          } else {
            // Input is taller than target: crop height
            cropWidth = metadata.width;
            cropHeight = Math.round(cropWidth / targetAspectRatio);

            // Center crop around hotspot Y position
            const hotspotYPosition = Math.round(
              metadata.height * currentHotspot.y
            );
            cropTop = Math.max(
              0,
              Math.min(
                hotspotYPosition - Math.round(cropHeight / 2),
                metadata.height - cropHeight
              )
            );
          }

          // Apply crop based on hotspot
          processor = processor.extract({
            left: cropLeft,
            top: cropTop,
            width: cropWidth,
            height: cropHeight,
          });
        }

        // Then resize to target dimensions
        processor = processor.resize({
          width: targetWidth,
          height: targetHeight,
          fit: sharp.fit.fill,
        });

        // Check if input is already AVIF and skip compression if so
        const isAlreadyAvif = metadata.format === "avif";

        let outputBuffer;
        let outputWidth, outputHeight;

        if (isAlreadyAvif && Config.SKIP_AVIF_RECOMPRESSION) {
          // Just resize without re-encoding if it's already AVIF
          outputBuffer = await processor.toBuffer();
          // Get the dimensions of the resized image
          const resizedInfo = await sharp(outputBuffer).metadata();
          outputWidth = resizedInfo.width;
          outputHeight = resizedInfo.height;
        } else {
          // Apply AVIF compression if not already AVIF or if recompression is allowed
          outputBuffer = await processor
            .avif({
              quality: Config.AVIF_QUALITY,
              effort: 4,
            })
            .toBuffer();
          // Get the dimensions of the processed image
          const processedInfo = await sharp(outputBuffer).metadata();
          outputWidth = processedInfo.width;
          outputHeight = processedInfo.height;
        }

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
          width: outputWidth, // Store the actual width
          height: outputHeight, // Store the actual height
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
          width: 0, // Default value for error case
          height: 0, // Default value for error case
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
        width: 0, // Default value for error case
        height: 0, // Default value for error case
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
    dimensionsPerSize: {}, // Add this to track dimensions
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

    // Fixed: Use sort with the natsort function instead of natsorted
    filePaths = imageFiles
      .sort(naturalSort)
      .map((fname) => path.join(inputVariantDir, fname));
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
                outputPath: null,
                s3Key: null,
                filename: path.basename(filePath),
                sizeKey: sizeKey,
                width: 0,
                height: 0,
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

  // Process dimensions from results
  const dimensionsPerSize = {};
  Config.SIZE_KEYS.forEach((sizeKey) => {
    dimensionsPerSize[sizeKey] = [];
  });

  // Extract dimensions from the results
  filePaths.forEach((fp, idx) => {
    const inputFilename = path.basename(fp);
    const sizeResults = variantResult.imageResults[inputFilename] || {};

    Object.entries(sizeResults).forEach(([sizeKey, result]) => {
      if (
        result?.success &&
        result.width &&
        result.height &&
        result.outputPath
      ) {
        if (!dimensionsPerSize[sizeKey]) dimensionsPerSize[sizeKey] = [];
        dimensionsPerSize[sizeKey][idx] = {
          width: result.width,
          height: result.height,
          outputPath: result.outputPath,
          s3Key: result.s3Key,
        };
      }
    });
  });

  variantResult.dimensionsPerSize = dimensionsPerSize;

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
          const localPathsPerSize = {};
          Config.SIZE_KEYS.forEach((sk) => {
            localPathsPerSize[sk] = [];
          }); // Initialize all size keys

          /** @type {Record<string, Array<{width: number, height: number, outputPath: string, s3Key: string}>>} */
          const dimensionsPerSize = {};
          Config.SIZE_KEYS.forEach((sk) => {
            dimensionsPerSize[sk] = [];
          }); // Initialize all size keys

          // Copy dimensions directly
          for (const sizeKey of Config.SIZE_KEYS) {
            dimensionsPerSize[sizeKey] = vr.dimensionsPerSize[sizeKey] || [];
          }

          // Iterate through results for each INPUT image filename
          Object.values(vr.imageResults).forEach((sizeResultsMap) => {
            // Iterate through results for each SIZE of that input image
            Object.values(sizeResultsMap).forEach((result) => {
              if (result?.success && result.outputPath) {
                // Create a relative path that can be used for local reference
                const relativePath = path.relative(
                  Config.BASE_DIR,
                  result.outputPath
                );
                // Add the local path to the correct size array
                localPathsPerSize[result.sizeKey]?.push(relativePath);
              }
            });
          });

          // Sort paths within each size array naturally based on the original index
          // (assuming filename structure {prod}_{var}_{index}_{size}.avif)
          const pathSortKeyExtractor = (filePath) => {
            const filename = path.basename(filePath);
            const match = filename.match(/_(\d+)_[\w]+\.avif$/);
            return match ? parseInt(match[1], 10) : Infinity;
          };
          for (const sizeKey in localPathsPerSize) {
            localPathsPerSize[sizeKey].sort(
              (a, b) => pathSortKeyExtractor(a) - pathSortKeyExtractor(b)
            );
          }

          return {
            variantNameSanitized: vr.variantNameSanitized,
            variantNameOriginal: vr.variantNameOriginal,
            processedLocalPathsPerSize: localPathsPerSize, // Aggregated local file paths
            dimensionsPerSize: dimensionsPerSize, // Include dimensions
          };
        })
        .filter((info) =>
          Object.values(info.processedLocalPathsPerSize).some(
            (paths) => paths.length > 0
          )
        ); // Ensure variant has *some* images

      // Generate the final JSON structure using the aggregated data
      const sanityJson = await ProductIO.generateSanityJsonLocal(
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
        `   Product processing stopped due to critical errors or shutdown for ${productOriginalName}. Output JSON not generated.`
      );
      return null;
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `❌ Critical error during product processing orchestrator for ${productOriginalName}: ${errMsg}`,
      error
    );
    Status.addErrorLog(
      `Critical Product Error (${productOriginalName}): ${errMsg}`,
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
      `--- Finished Product Processing Orchestration: ${productOriginalName} ---`
    );
  }
}

/**
 * Deletes all processed files for a specific product from the local output directory.
 * @param {string} productOriginalName The original product folder name.
 * @returns {Promise<number>} The number of files deleted.
 */
export async function clearLocalProductFiles(productOriginalName) {
  const productNameSanitized = Utils.sanitizeName(productOriginalName);
  const productOutputPath = path.join(Config.OUTPUT_DIR, productNameSanitized);
  let deletedCount = 0;

  console.warn(
    `🗑️ Clearing local files for product: ${productOriginalName} (${productNameSanitized})...`
  );

  try {
    // Check if directory exists before attempting to delete
    try {
      await fs.access(productOutputPath);

      // Delete the entire product directory recursively
      await fs.rm(productOutputPath, { recursive: true, force: true });

      console.log(`   Deleted local output directory: ${productOutputPath}`);
      deletedCount = 1; // Count the directory as 1 deletion
    } catch (e) {
      if (e.code === "ENOENT") {
        console.log(
          `   Local output directory doesn't exist: ${productOutputPath}`
        );
      } else {
        throw e;
      }
    }

    // Delete local config file associated with the product
    const localConfigPath = Utils.getLocalConfigFilePath(productOriginalName);
    try {
      await fs.access(localConfigPath);
      await fs.unlink(localConfigPath);
      console.log(`   Deleted local config file: ${localConfigPath}`);
      deletedCount++;
    } catch (e) {
      if (e.code === "ENOENT") {
        console.log(`   Local config file doesn't exist: ${localConfigPath}`);
      } else {
        throw e;
      }
    }

    return deletedCount;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(
      `   Failed to delete local files for ${productOriginalName}: ${errMsg}`
    );
    Status.addErrorLog(
      `Local File Clear Error (${productOriginalName}): ${errMsg}`,
      false
    );
    return deletedCount;
  }
}

/**
 * Clears both local files and S3 cache for a specific product.
 * @param {string} productOriginalName The original product folder name.
 * @returns {Promise<{local: number, s3: number}>} Count of deleted items locally and in S3.
 */
export async function clearProductCache(productOriginalName) {
  const productNameSanitized = Utils.sanitizeName(productOriginalName);
  console.warn(
    `🗑️ Clearing cache for product: ${productOriginalName} (${productNameSanitized})...`
  );

  // Delete local files first
  const localDeleteCount = await clearLocalProductFiles(productOriginalName);

  // Then delete S3 objects with the product prefix
  const s3Prefix = Utils.getS3ProductBasePath(productNameSanitized) + "/"; // Ensure trailing slash
  const s3DeleteCount = await S3.deleteS3Prefix(s3Prefix);
  console.log(
    `   Deleted ${s3DeleteCount} objects from S3 for ${productOriginalName}.`
  );

  return {
    local: localDeleteCount,
    s3: s3DeleteCount,
  };
}
