// lib/status.js
// Simple status tracking for the local Next.js app.
// NOTE: This in-memory state is per server process. Locks removed for simplicity
// in a typical single-process local dev environment.

import * as Config from "./config";

/** @type {'OK' | 'WARNING' | 'ERROR'} */
let systemStatus = "OK";
/** @type {Array<{timestamp: string, message: string, isCritical: boolean}>} */
const recentErrors = [];
/** @type {Map<string, number>} */
const activeProcessingTasks = new Map(); // productNameSanitized -> startTime (nanoseconds)

// --- Status ---
/**
 * Updates the global system status.
 * @param {'OK' | 'WARNING' | 'ERROR'} newStatus
 */
export function updateSystemStatus(newStatus) {
  // No lock needed for simple assignment in single process dev server
  if (newStatus === "ERROR") {
    systemStatus = "ERROR";
  } else if (newStatus === "WARNING" && systemStatus === "OK") {
    systemStatus = "WARNING";
  } else if (newStatus === "OK" && systemStatus !== "ERROR") {
    systemStatus = "OK";
  }
}

/**
 * Gets the current system status.
 * @returns {'OK' | 'WARNING' | 'ERROR'}
 */
export function getSystemStatus() {
  return systemStatus;
}

// --- Errors ---
/**
 * Adds an error message to the recent errors list.
 * @param {string} message The error message.
 * @param {boolean} [isCritical=true] Whether the error is critical.
 */
export function addErrorLog(message, isCritical = true) {
  const timestamp = new Date().toISOString();
  /** @type {{timestamp: string, message: string, isCritical: boolean}} */
  const logEntry = { timestamp, message, isCritical };

  // Simple array push/slice (not strictly thread-safe, but okay for this context)
  recentErrors.unshift(logEntry);
  if (recentErrors.length > Config.MAX_RECENT_ERRORS) {
    recentErrors.length = Config.MAX_RECENT_ERRORS;
  }
  console.error(`[${isCritical ? "ERROR" : "WARN"}] ${timestamp} - ${message}`);

  // Update status based on error severity
  updateSystemStatus(isCritical ? "ERROR" : "WARNING");
}

/**
 * Gets a copy of the recent errors.
 * @returns {Array<{timestamp: string, message: string, isCritical: boolean}>}
 */
export function getRecentErrors() {
  // Return a shallow copy
  return [...recentErrors];
}

// --- Processing Tasks ---
/**
 * Sets the processing status for a product.
 * @param {string} productNameSanitized
 * @param {boolean} isProcessing
 */
export function setProcessingStatus(productNameSanitized, isProcessing) {
  // Simple map operations
  if (isProcessing) {
    if (!activeProcessingTasks.has(productNameSanitized)) {
      // Use performance.now() for high-resolution timing available in Node/Browser
      activeProcessingTasks.set(productNameSanitized, performance.now()); // Store start time in milliseconds
      console.info(`⏱️ Processing started: ${productNameSanitized}`);
    }
  } else {
    const startTimeMs = activeProcessingTasks.get(productNameSanitized);
    if (activeProcessingTasks.delete(productNameSanitized)) {
      const duration = startTimeMs
        ? ((performance.now() - startTimeMs) / 1000).toFixed(2)
        : "N/A"; // Duration in seconds
      console.info(
        `✅ Processing finished: ${productNameSanitized} (Duration: ${duration}s)`
      );
    }
  }
}

/**
 * Checks if a product is currently being processed.
 * @param {string} productNameSanitized
 * @returns {boolean}
 */
export function isProductProcessing(productNameSanitized) {
  return activeProcessingTasks.has(productNameSanitized);
}

/**
 * Gets a list of products currently being processed.
 * @returns {string[]}
 */
export function getActiveProcessingTasks() {
  return Array.from(activeProcessingTasks.keys());
}

// --- Shutdown Event ---
let _shutdownTriggered = false;
export const shutdown_event = {
  isSet: () => _shutdownTriggered,
  set: () => {
    if (!_shutdownTriggered) {
      console.log("Shutdown signal received by status module.");
      _shutdownTriggered = true;
    }
  },
};
