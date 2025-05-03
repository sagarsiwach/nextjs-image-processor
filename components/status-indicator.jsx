// components/status-indicator.jsx
"use client"; // Add this to make it a client component

/**
 * Simple component to show Idle or Processing status.
 * @param {{isProcessing: boolean}} props
 */
export function StatusIndicator({ isProcessing }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`h-2 w-2 rounded-full ${
          isProcessing ? "bg-orange-500 animate-pulse" : "bg-green-500"
        }`}
      ></span>
      <span
        className={`text-xs font-medium ${
          isProcessing ? "text-orange-600" : "text-green-700"
        }`}
      >
        {isProcessing ? "Processing" : "Idle"}
      </span>
    </div>
  );
}