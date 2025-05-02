// lib/status.js
// Simple status tracking for the local Next.js app.
// NOTE: This in-memory state is *per server process*. If Next.js restarts
// or runs multiple instances (unlikely for local dev), state might be inconsistent.

import { Mutex } from "bun"; // Assuming Bun environment for Mutex
import * as Config from "./config"; // Use relative import

/** @type {'OK' | 'WARNING' | 'ERROR'} */
let systemStatus = "OK";
/** @type {Array<{timestamp: string, message: string, isCritical: boolean}>} */
const recentErrors = [];
/** @type {Map<string, number>} */
const activeProcessingTasks = new Map(); // productNameSanitized -> startTime (nanoseconds)

// Locks
const statusLock = new Mutex();
const errorsLock = new Mutex();
const processingLock = new Mutex();

// --- Status ---
/**
 * Updates the global system status (thread-safe).
 * @param {'OK' | 'WARNING' | 'ERROR'} newStatus
 */
export function updateSystemStatus(newStatus) {
  statusLock.lock();
  try {
    if (newStatus === "ERROR") {
      systemStatus = "ERROR";
    } else if (newStatus === "WARNING" && systemStatus === "OK") {
      systemStatus = "WARNING";
    } else if (newStatus === "OK" && systemStatus !== "ERROR") {
      // Allow reset to OK only if not currently in ERROR state
      systemStatus = "OK";
    }
  } finally {
    statusLock.unlock();
  }
}

/**
 * Gets the current system status.
 * @returns {'OK' | 'WARNING' | 'ERROR'}
 */
export function getSystemStatus() {
  statusLock.lock();
  try {
    return systemStatus;
  } finally {
    statusLock.unlock();
  }
}

// --- Errors ---
/**
 * Adds an error message to the recent errors list.
 * @param {string} message The error message.
 * @param {boolean} [isCritical=true] Whether the error is critical.
 */
export function addErrorLog(message, isCritical = true) {
  const timestamp = new Date().toISOString(); // ISO format is standard
  /** @type {{timestamp: string, message: string, isCritical: boolean}} */
  const logEntry = { timestamp, message, isCritical };

  errorsLock.lock();
  try {
    recentErrors.unshift(logEntry); // Add to the beginning
    // Trim array if it exceeds max length
    if (recentErrors.length > Config.MAX_RECENT_ERRORS) {
      recentErrors.length = Config.MAX_RECENT_ERRORS; // Efficiently truncate
    }
    // Log to console as well
    console.error(
      `[${isCritical ? "ERROR" : "WARN"}] ${timestamp} - ${message}`
    );
  } finally {
    errorsLock.unlock();
  }
  // Update status outside the error lock but based on error added
  updateSystemStatus(isCritical ? "ERROR" : "WARNING");
}

/**
 * Gets a copy of the recent errors.
 * @returns {Array<{timestamp: string, message: string, isCritical: boolean}>}
 */
export function getRecentErrors() {
  errorsLock.lock();
  try {
    return [...recentErrors]; // Return a copy
  } finally {
    errorsLock.unlock();
  }
}

// --- Processing Tasks ---
/**
 * Sets the processing status for a product.
 * @param {string} productNameSanitized
 * @param {boolean} isProcessing
 */
export function setProcessingStatus(productNameSanitized, isProcessing) {
  processingLock.lock();
  try {
    if (isProcessing) {
      if (!activeProcessingTasks.has(productNameSanitized)) {
        // Avoid resetting start time
        activeProcessingTasks.set(productNameSanitized, Bun.nanoseconds());
        console.info(`⏱️ Processing started: ${productNameSanitized}`);
      }
    } else {
      const startTime = activeProcessingTasks.get(productNameSanitized);
      if (activeProcessingTasks.delete(productNameSanitized)) {
        // Only log finish if it was active
        const duration = startTime
          ? ((Bun.nanoseconds() - startTime) / 1_000_000_000).toFixed(2)
          : "N/A";
        console.info(
          `✅ Processing finished: ${productNameSanitized} (Duration: ${duration}s)`
        );
      }
    }
  } finally {
    processingLock.unlock();
  }
}

/**
 * Checks if a product is currently being processed.
 * @param {string} productNameSanitized
 * @returns {boolean}
 */
export function isProductProcessing(productNameSanitized) {
  processingLock.lock();
  try {
    return activeProcessingTasks.has(productNameSanitized);
  } finally {
    processingLock.unlock();
  }
}

/**
 * Gets a list of products currently being processed.
 * @returns {string[]}
 */
export function getActiveProcessingTasks() {
  processingLock.lock();
  try {
    return Array.from(activeProcessingTasks.keys());
  } finally {
    processingLock.unlock();
  }
}

// --- Shutdown Event ---
// Simple flag for local app coordination
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
