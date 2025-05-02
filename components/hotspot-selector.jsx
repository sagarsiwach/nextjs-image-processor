// src/components/hotspot-selector.jsx
"use client"; // This component needs client-side interaction

import React, { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image"; // Use Next.js Image for optimization if applicable locally? Maybe basic img is better here.

/**
 * Component for selecting a hotspot on a preview image.
 * @param {{
 *  sizeKey: string;
 *  sizeWidth: number;
 *  imageUrl: string | null;
 *  initialHotspot: {x: number, y: number};
 *  onHotspotChange: (sizeKey: string, hotspot: {x: number, y: number}) => void;
 * }} props
 */
export function HotspotSelector({
  sizeKey,
  sizeWidth,
  imageUrl,
  initialHotspot,
  onHotspotChange,
}) {
  const [hotspot, setHotspot] = useState(initialHotspot || { x: 0.5, y: 0.5 });
  const containerRef = useRef(null);
  const imageRef = useRef(null);

  // Update marker position visually
  const markerStyle = {
    left: `${hotspot.x * 100}%`,
    top: `${hotspot.y * 100}%`,
    display: imageUrl ? "block" : "none", // Only show if image exists
  };

  // Function to handle click and update hotspot
  const handleClick = useCallback(
    (event) => {
      if (!imageRef.current || !containerRef.current) return;

      const img = imageRef.current;
      const rect = img.getBoundingClientRect(); // Use getBoundingClientRect for accuracy

      // Calculate click relative to the image element itself
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;

      // Calculate relative coordinates, clamping between 0 and 1
      const relativeX = Math.max(0, Math.min(1, offsetX / img.clientWidth));
      const relativeY = Math.max(0, Math.min(1, offsetY / img.clientHeight));

      const newHotspot = { x: relativeX, y: relativeY };
      setHotspot(newHotspot);
      onHotspotChange(sizeKey, newHotspot); // Notify parent
    },
    [onHotspotChange, sizeKey]
  );

  // Effect to update internal state if initialHotspot prop changes
  useEffect(() => {
    setHotspot(initialHotspot || { x: 0.5, y: 0.5 });
  }, [initialHotspot]);

  return (
    <div className="border p-3 rounded bg-gray-50 text-center flex flex-col">
      <h4 className="font-semibold mb-2 text-sm">
        {sizeKey.toUpperCase()}{" "}
        <span className="font-normal text-xs">({sizeWidth}px)</span>
      </h4>
      <div
        ref={containerRef}
        className="hotspot-container relative cursor-crosshair w-full max-w-[300px] mx-auto border border-muted aspect-[4/3] bg-muted/30 overflow-hidden" // Added aspect ratio and bg
        onClick={handleClick}
        title="Click to set hotspot"
      >
        {imageUrl ? (
          <img
            ref={imageRef}
            id={`hotspot-image-${sizeKey}`}
            src={imageUrl} // Use basic img tag for local previews
            alt={`Sample image for ${sizeKey}`}
            className="block w-full h-full object-contain" // Ensure image fits
            draggable="false" // Prevent dragging image itself
            // Add error handling if needed
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-red-600 text-xs p-2">
            No sample image
          </div>
        )}
        {imageUrl && (
          <div
            id={`hotspot-marker-${sizeKey}`}
            className="hotspot-marker absolute w-[15px] h-[15px] rounded-full bg-red-600/80 border border-white shadow-md"
            style={markerStyle}
          ></div>
        )}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        <span>X:</span>
        <span id={`hotspot-x-display-${sizeKey}`}>{hotspot.x.toFixed(3)}</span>
        <span className="ml-2">Y:</span>
        <span id={`hotspot-y-display-${sizeKey}`}>{hotspot.y.toFixed(3)}</span>
        {/* Hidden inputs will be handled by the parent form state */}
      </div>
    </div>
  );
}
