// components/hotspot-selector.jsx
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
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const containerRef = useRef(null);
  const imageRef = useRef(null);
  const [imageSrc, setImageSrc] = useState(imageUrl);

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

      // Add timestamp parameter to force the image to reload with the new hotspot position
      if (imageUrl) {
        const timestamp = Date.now();
        let newSrc = imageUrl;
        if (imageUrl.includes("?")) {
          newSrc = imageUrl.split("?")[0] + `?hotspot=${timestamp}`;
        } else {
          newSrc = imageUrl + `?hotspot=${timestamp}`;
        }
        setImageSrc(newSrc);
      }
    },
    [onHotspotChange, sizeKey, imageUrl]
  );

  // Function to calculate proper dimensions based on aspect ratio
  const calculateDimensions = useCallback(() => {
    const isTabletOrPhone = sizeKey === "tablet" || sizeKey === "phone";
    let width, height;

    if (isTabletOrPhone) {
      // Portrait orientation (9:16)
      width = sizeWidth;
      height = Math.round((width * 16) / 9);
    } else {
      // Landscape orientation (16:9)
      width = sizeWidth;
      height = Math.round((width * 9) / 16);
    }

    setDimensions({ width, height });
  }, [sizeKey, sizeWidth]);

  // Update dimensions when image loads and handle natural dimensions
  const handleImageLoad = useCallback(() => {
    if (imageRef.current) {
      calculateDimensions();
    }
  }, [calculateDimensions]);

  // Initialize dimensions on mount
  useEffect(() => {
    calculateDimensions();
  }, [calculateDimensions]);

  // Effect to update internal state if initialHotspot prop changes
  useEffect(() => {
    setHotspot(initialHotspot || { x: 0.5, y: 0.5 });
  }, [initialHotspot]);

  // Effect to update image URL when the imageUrl prop changes
  useEffect(() => {
    setImageSrc(imageUrl);
  }, [imageUrl]);

  // Determine if this size uses portrait orientation
  const isPortrait = sizeKey === "tablet" || sizeKey === "phone";

  return (
    <div className="border p-3 rounded bg-gray-50 text-center flex flex-col">
      <h4 className="font-semibold mb-2 text-sm">
        {sizeKey.toUpperCase()}{" "}
        <span className="font-normal text-xs">({sizeWidth}px)</span>
      </h4>
      <div
        ref={containerRef}
        className="hotspot-container relative cursor-crosshair w-full max-w-[300px] mx-auto border border-muted bg-muted/30 overflow-hidden"
        style={{
          aspectRatio: isPortrait ? "9/16" : "16/9",
        }}
        onClick={handleClick}
        title="Click to set hotspot"
      >
        {imageSrc ? (
          <img
            ref={imageRef}
            id={`hotspot-image-${sizeKey}`}
            src={imageSrc}
            alt={`Sample image for ${sizeKey}`}
            className="block w-full h-full object-cover" // Changed to object-cover
            draggable="false"
            onLoad={handleImageLoad}
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-red-600 text-xs p-2">
            No sample image
          </div>
        )}
        {imageSrc && (
          <div
            id={`hotspot-marker-${sizeKey}`}
            className="hotspot-marker absolute w-[15px] h-[15px] rounded-full bg-red-600/80 border border-white shadow-md"
            style={markerStyle}
          ></div>
        )}
      </div>
      <div className="mt-2 text-xs text-muted-foreground space-y-1">
        <div>
          <span>X:</span>
          <span id={`hotspot-x-display-${sizeKey}`}>
            {hotspot.x.toFixed(3)}
          </span>
          <span className="ml-2">Y:</span>
          <span id={`hotspot-y-display-${sizeKey}`}>
            {hotspot.y.toFixed(3)}
          </span>
        </div>
        <div className="font-medium">
          <span>
            {dimensions.width}×{dimensions.height}
          </span>
          <span className="ml-2 text-muted">px</span>
        </div>
      </div>
    </div>
  );
}
