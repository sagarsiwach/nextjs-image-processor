// lib/s3-helpers.js
import * as Config from "./config";
import path from "node:path";
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";


// Simple status logging
function logError(message) {
  console.error(`[R2 Helper Error] ${message}`);
}
function logInfo(message) {
  console.log(`[R2 Helper] ${message}`);
}
function logWarn(message) {
  console.warn(`[R2 Helper Warning] ${message}`);
}

// Initialize R2 Client Lazily
let r2ClientInstance = null;
let r2ClientInitializationError = false;

/**
 * Gets the initialized R2 Client instance. Handles initialization errors.
 * @returns {S3Client | null} The client instance or null if configuration is missing/invalid.
 */
function getR2Client() {
  if (r2ClientInstance) {
    return r2ClientInstance;
  }
  if (r2ClientInitializationError) {
    return null;
  }
  if (
    !Config.S3_ENDPOINT ||
    !Config.S3_ACCESS_KEY_ID ||
    !Config.S3_SECRET_ACCESS_KEY ||
    !Config.S3_BUCKET
  ) {
    logError(
      "Cannot initialize R2 Client: Missing environment variables in .env."
    );
    r2ClientInitializationError = true;
    return null;
  }
  try {
    // Configure client for Cloudflare R2
    r2ClientInstance = new S3Client({
      credentials: {
        accessKeyId: Config.S3_ACCESS_KEY_ID,
        secretAccessKey: Config.S3_SECRET_ACCESS_KEY,
      },
      endpoint: Config.S3_ENDPOINT,
      region: "auto", // R2 uses "auto" for region
      forcePathStyle: true, // Required for R2
    });
    logInfo(`R2 Client initialized for bucket: ${Config.S3_BUCKET}`);
    return r2ClientInstance;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Failed to initialize R2 Client: ${errMsg}`);
    r2ClientInitializationError = true;
    return null;
  }
}

/**
 * Uploads a buffer to the configured R2 bucket.
 * @param {Buffer | ArrayBuffer | Uint8Array} buffer The data buffer to upload.
 * @param {string} s3Key The destination key (path) within the R2 bucket.
 * @param {string} [contentType='image/avif'] The MIME type of the content.
 * @returns {Promise<boolean>} True if upload was successful, false otherwise.
 */
export async function uploadBufferToS3(
  buffer,
  s3Key,
  contentType = "image/avif"
) {
  const client = getR2Client();
  if (!client) return false;
  
  try {
    const command = new PutObjectCommand({
      Bucket: Config.S3_BUCKET,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType,
    });
    
    await client.send(command);
    logInfo(`✅ Uploaded to R2: ${s3Key}`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`❌ Upload failed for ${s3Key}: ${errorMessage}`);
    return false;
  }
}

/**
 * Deletes a single object from the R2 bucket.
 * @param {string} s3Key The key of the object to delete.
 * @returns {Promise<boolean>} True if deletion was successful or object didn't exist, false on error.
 */
export async function deleteS3Object(s3Key) {
  const client = getR2Client();
  if (!client) return false;
  
  try {
    const command = new DeleteObjectCommand({
      Bucket: Config.S3_BUCKET,
      Key: s3Key,
    });
    
    await client.send(command);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`❌ Error deleting ${s3Key}: ${errorMessage}`);
    return false;
  }
}

/**
 * Deletes all objects matching a given prefix in the R2 bucket.
 * Handles pagination automatically.
 * @param {string} prefix The prefix to match (e.g., 'processed_images/product_name/').
 * @returns {Promise<number>} The total number of objects successfully deleted.
 */
export async function deleteS3Prefix(prefix) {
  const client = getR2Client();
  if (!client) return 0;

  let deletedCount = 0;
  let continuationToken = undefined;
  let batchNumber = 1;
  logInfo(`🔍 Starting deletion for prefix: ${prefix}`);

  try {
    do {
      logInfo(`   Fetching batch ${batchNumber}...`);
      
      const listCommand = new ListObjectsV2Command({
        Bucket: Config.S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      
      const result = await client.send(listCommand);
      const contents = result?.Contents ?? [];

      if (contents.length > 0) {
        logInfo(
          `   Found ${contents.length} objects in batch ${batchNumber}. Deleting...`
        );
        const deletePromises = contents
          .filter((obj) => obj.Key)
          .map((obj) =>
            deleteS3Object(obj.Key)
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

      continuationToken = result?.NextContinuationToken;
      batchNumber++;
      if (continuationToken) await new Promise(resolve => setTimeout(resolve, 50)); // Small delay
    } while (continuationToken);

    logInfo(
      `✅ Finished R2 deletion process for prefix '${prefix}'. Total deleted: ${deletedCount}.`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(
      `❌ Error during R2 list/delete operation for prefix ${prefix}: ${errorMessage}`
    );
  }
  return deletedCount;
}