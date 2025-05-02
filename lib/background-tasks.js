// lib/background-tasks.js
// Manages a queue for processing products asynchronously in the background.
// NOTE: This simple in-memory queue works for a single server process (local dev).
// It does NOT persist across server restarts. For production/robustness,
// consider a dedicated job queue system (e.g., BullMQ with Redis).

import { Mutex } from 'bun'; // For basic locking
import * as Processor from './image-processing';
import * as Status from './status';
import * as Utils from './utils'; // Needed to sanitize name if needed

/** @type {string[]} */
const processingQueue = []; // Stores ORIGINAL product names
const queueLock = new Mutex();
let isProcessorLoopRunning = false;
let stopProcessingLoop = false; // Flag to signal loop exit

function log(message) {
    // Add timestamp for clarity in logs
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[BG Task ${timestamp}] ${message}`);
}

/** Takes one item off the queue and processes it */
async function processQueueItem() {
    let productOriginalName;

    // Dequeue safely
    await queueLock.lock(); // Use await with Bun's async mutex lock
    try {
        if (processingQueue.length > 0) {
            productOriginalName = processingQueue.shift(); // Get the next item
        }
    } finally {
        queueLock.unlock();
    }

    if (productOriginalName) {
        const sanitizedName = Utils.sanitizeName(productOriginalName); // Sanitize for status check
        log(`Dequeued: ${productOriginalName}. Starting processing...`);
        try {
            // Check status again right before processing, in case it was triggered elsewhere
             if (Status.isProductProcessing(sanitizedName)) {
                log(`Skipping ${productOriginalName} - already marked as processing.`);
                return; // Skip this item
             }
            // Mark as processing ONLY if not already marked
            Status.setProcessingStatus(sanitizedName, true); // Mark before await

            await Processor.processProduct(productOriginalName); // Call the main processing function

        } catch (error) {
            log(`ERROR processing ${productOriginalName}: ${error}`);
            Status.addErrorLog(`Background processing error for ${productOriginalName}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            // Ensure status is always cleared after attempting processing for this item
            // This handles cases where processProduct might throw before its own finally block
            if (Status.isProductProcessing(sanitizedName)) {
                 Status.setProcessingStatus(sanitizedName, false);
            }
            log(`Finished task attempt for: ${productOriginalName}`);
        }
    }
}

/** The main loop that checks the queue and processes items */
async function processingLoop() {
    log("Processing loop started.");
    isProcessorLoopRunning = true;
    while (!stopProcessingLoop && !Status.shutdown_event.isSet()) {
        await queueLock.lock(); // Lock to check length
        const queueNotEmpty = processingQueue.length > 0;
        queueLock.unlock(); // Unlock before potentially long operation or sleep

        if (queueNotEmpty) {
            await processQueueItem(); // Process one item
            await Bun.sleep(200); // Short delay between items to prevent tight loops
        } else {
            // Wait longer if the queue is empty
            await Bun.sleep(2000); // Check queue every 2 seconds
        }
    }
    isProcessorLoopRunning = false;
    log(`Processing loop stopped (Stop flag: ${stopProcessingLoop}, Shutdown: ${Status.shutdown_event.isSet()}).`);
}

/**
 * Adds a product (by original name) to the processing queue.
 * Starts the processing loop if it's not already running.
 * @param {string} productOriginalName
 * @returns {boolean} True if enqueued successfully, false otherwise.
 */
export function enqueueProductProcessing(productOriginalName) {
    if (!productOriginalName) {
        log("Attempted to enqueue empty product name.");
        return false;
    }
    const sanitizedName = Utils.sanitizeName(productOriginalName); // For status check

    // Check if already processing before even queueing
    if (Status.isProductProcessing(sanitizedName)) {
         log(`Cannot enqueue ${productOriginalName}: Processing is already active.`);
         return false; // Indicate not queued because already running
    }


    let wasEnqueued = false;
    queueLock.lock(); // Use synchronous lock for queue modification
    try {
        // Prevent adding duplicates if already waiting in the queue
        if (!processingQueue.includes(productOriginalName)) {
            processingQueue.push(productOriginalName);
            log(`Enqueued: ${productOriginalName}. Queue size: ${processingQueue.length}`);
            wasEnqueued = true;
        } else {
            log(`Product ${productOriginalName} is already in the queue.`);
            // Still return true as the request is acknowledged, even if already queued
            wasEnqueued = true;
        }
    } finally {
        queueLock.unlock();
    }

     // Start the loop if it's not already running and not stopping
     // Do this outside the lock
     if (wasEnqueued && !isProcessorLoopRunning && !stopProcessingLoop) {
         log("Processor loop not running, starting it now.");
         // Start loop asynchronously, don't await it here
         processingLoop().catch(err => {
              log(`FATAL PROCESSING LOOP ERROR: ${err}`);
              isProcessorLoopRunning = false; // Ensure flag is reset on loop crash
              Status.addErrorLog(`Fatal background processing loop error: ${err instanceof Error ? err.message : String(err)}`);
              Status.updateSystemStatus("ERROR"); // Mark system as errored if loop dies
          });
     }

    return wasEnqueued; // Return true if item is now definitely in the queue (or was already)
}

/** Signals the processing loop to stop after the current item */
export function stopProcessing() {
    log("Signal received to stop background processing loop.");
    stopProcessingLoop = true;
    // Note: This doesn't cancel the *currently running* item, only prevents starting new ones.
}

/** Returns the current queue length */
export function getQueueLength() {
    queueLock.lock();
    try {
        return processingQueue.length;
    } finally {
        queueLock.unlock();
    }
}