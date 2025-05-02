// lib/s3-helpers.js
import { S3Client } from "bun"; // Use Bun's built-in S3 client
import * as Config from "./config";
import path from "node:path";

// Simple status logging
function logError(message) {
  console.error(`[S3 Helper Error] ${message}`);
}
function logInfo(message) {
  console.log(`[S3 Helper] ${message}`);
}
function logWarn(message) {
  console.warn(`[S3 Helper Warning] ${message}`);
}

// Initialize S3 Client Lazily
let s3ClientInstance = null;
let s3ClientInitializationError = false;

/**
 * Gets the initialized S3 Client instance. Handles initialization errors.
 * @returns {S3Client | null} The client instance or null if configuration is missing/invalid.
 */
function getS3Client() {
  if (s3ClientInstance) {
    return s3ClientInstance;
  }
  if (s3ClientInitializationError) {
    return null;
  }
  if (
    !Config.S3_ENDPOINT ||
    !Config.S3_ACCESS_KEY_ID ||
    !Config.S3_SECRET_ACCESS_KEY ||
    !Config.S3_BUCKET
  ) {
    logError(
      "Cannot initialize S3 Client: Missing environment variables in .env."
    );
    s3ClientInitializationError = true;
    return null;
  }
  try {
    s3ClientInstance = new S3Client({
      accessKeyId: Config.S3_ACCESS_KEY_ID,
      secretAccessKey: Config.S3_SECRET_ACCESS_KEY,
      bucket: Config.S3_BUCKET,
      endpoint: Config.S3_ENDPOINT,
      region: Config.S3_REGION,
    });
    logInfo(`S3 Client initialized for bucket: ${Config.S3_BUCKET}`);
    return s3ClientInstance;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Failed to initialize S3Client: ${errMsg}`);
    s3ClientInitializationError = true;
    return null;
  }
}

/**
 * Uploads a buffer to the configured S3 bucket.
 * @param {Buffer | ArrayBuffer | Uint8Array} buffer The data buffer to upload.
 * @param {string} s3Key The destination key (path) within the S3 bucket.
 * @param {string} [contentType='image/avif'] The MIME type of the content.
 * @returns {Promise<boolean>} True if upload was successful, false otherwise.
 */
export async function uploadBufferToS3(
  buffer,
  s3Key,
  contentType = "image/avif"
) {
  const client = getS3Client();
  if (!client) return false;
  try {
    await client.write(s3Key, buffer, { type: contentType });
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`❌ Upload failed for ${s3Key}: ${errorMessage}`);
    // Consider adding to central status log if implemented
    return false;
  }
}

/**
 * Deletes a single object from the S3 bucket.
 * @param {string} s3Key The key of the object to delete.
 * @returns {Promise<boolean>} True if deletion was successful or object didn't exist, false on error.
 */
export async function deleteS3Object(s3Key) {
  const client = getS3Client();
  if (!client) return false;
  try {
    await client.delete(s3Key);
    // logInfo(`🗑️ Deleted S3 object (or didn't exist): ${s3Key}`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`❌ Error deleting ${s3Key}: ${errorMessage}`);
    return false;
  }
}

/**
 * Deletes all objects matching a given prefix in the S3 bucket.
 * Handles pagination automatically.
 * @param {string} prefix The prefix to match (e.g., 'processed_images/product_name/').
 * @returns {Promise<number>} The total number of objects successfully deleted.
 */
export async function deleteS3Prefix(prefix) {
  const client = getS3Client();
  if (!client) return 0;

  let deletedCount = 0;
  let continuationToken = undefined;
  let batchNumber = 1;
  logInfo(`🔍 Starting deletion for prefix: ${prefix}`);

  try {
    do {
      logInfo(`   Fetching batch ${batchNumber}...`);
      /** @type {{ prefix: string, continuationToken?: string, maxKeys?: number }} */
      const listParams = { prefix: prefix };
      if (continuationToken) {
        listParams.continuationToken = continuationToken;
      }

      const result = await client.list(listParams);
      const contents = result?.contents ?? [];

      if (contents.length > 0) {
        logInfo(
          `   Found ${contents.length} objects in batch ${batchNumber}. Deleting...`
        );
        const deletePromises = contents
          .filter((obj) => obj.key)
          .map((obj) =>
            deleteS3Object(obj.key) // Use non-null assertion removed - check filter
              .then((success) => (success ? 1 : 0))
          );
        const results = await Promise.all(deletePromises);
        const batchDeletedCount = results.reduce(
          (sum, count) => sum + count,
          0
        );
        deletedCount += batchDeletedCount;
        logInfo(
          `   Deleted ${batchDeletedCount} objects from batch ${batchNumber}.`
        );
      } else if (!continuationToken) {
        logInfo(`   No objects found with prefix: ${prefix}`);
      }

      continuationToken = result?.nextContinuationToken;
      batchNumber++;
      if (continuationToken) await Bun.sleep(50); // Small delay
    } while (continuationToken);

    logInfo(
      `✅ Finished S3 deletion process for prefix '${prefix}'. Total deleted: ${deletedCount}.`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(
      `❌ Error during S3 list/delete operation for prefix ${prefix}: ${errorMessage}`
    );
  }
  return deletedCount;
}
