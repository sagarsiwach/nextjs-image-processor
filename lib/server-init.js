// lib/server-init.js
// This file contains server-only initialization code
import fs from "node:fs/promises";
import dotenv from "dotenv";
import path from "path";
import * as Config from "./config";

// Load .env file
try {
  const result = dotenv.config();
  if (result.error) {
    console.error("Error loading .env file:", result.error);
  } else {
    console.log("✅ Environment variables loaded from .env file");
  }
} catch (error) {
  console.error("Failed to load .env file:", error);
}

// Log environment variables status
console.log("S3 Environment Variables Status:");
console.log(
  `- S3_ENDPOINT: ${process.env.S3_ENDPOINT ? "✓ Set" : "✗ Missing"}`
);
console.log(`- S3_BUCKET: ${process.env.S3_BUCKET ? "✓ Set" : "✗ Missing"}`);
console.log(
  `- S3_ACCESS_KEY_ID: ${process.env.S3_ACCESS_KEY_ID ? "✓ Set" : "✗ Missing"}`
);
console.log(
  `- S3_SECRET_ACCESS_KEY: ${
    process.env.S3_SECRET_ACCESS_KEY ? "✓ Set (value hidden)" : "✗ Missing"
  }`
);

// Check essential S3 configuration and provide feedback
if (!Config.IS_S3_CONFIGURED) {
  console.error(
    "\n❌ CRITICAL ERROR: Missing one or more required S3 environment variables in .env:"
  );
  console.error(
    "   Ensure S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET are set."
  );
} else {
  // Log basic info if configuration seems okay
  console.log("✅ S3 Configuration loaded");
  try {
    // Attempt to parse endpoint for slightly cleaner logging
    const endpointUrl = new URL(Config.S3_ENDPOINT);
    console.log(`   - Endpoint Host: ${endpointUrl.hostname}`);
  } catch {
    console.log(`   - Endpoint: ${Config.S3_ENDPOINT}`); // Fallback log if URL parsing fails
  }
  console.log(`   - Bucket: ${Config.S3_BUCKET}`);
}
console.log(`⚙️  Max Processing Workers: ${Config.MAX_PROCESSING_WORKERS}`);

// Create required directories if they don't exist
export async function ensureDirectories() {
  try {
    // Create input directory if it doesn't exist
    await fs.mkdir(Config.INPUT_DIR, { recursive: true });
    console.log(`✅ Ensured input directory exists: ${Config.INPUT_DIR}`);

    // Create output directory if it doesn't exist
    await fs.mkdir(Config.OUTPUT_JSON_DIR, { recursive: true });
    console.log(
      `✅ Ensured output directory exists: ${Config.OUTPUT_JSON_DIR}`
    );

    return true;
  } catch (error) {
    console.error("Error creating required directories:", error);
    return false;
  }
}

// Run initialization when imported
ensureDirectories().catch(console.error);
