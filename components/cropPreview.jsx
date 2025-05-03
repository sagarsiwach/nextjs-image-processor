// components/CropPreview.jsx
"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactCrop, { centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

/**
 * A component for displaying an image preview with hotspot selection
 * @param {{
 *  sizeKey: string;
 *  sizeWidth: number;
 *  imageUrl: string | null;
 *  initialHotspot: {x: number, y: number};
 *  onHotspotChange: (sizeKey: string, hotspot: {x: number, y: number}) => void;
 * }} props
 */
export function CropPreview({
  sizeKey,
  sizeWidth,
  imageUrl,
  initialHotspot,
  onHotspotChange,
}) {
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState();
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const imgRef = useRef(null);

  // Determine if this is a portrait orientation (tablet/phone)
  const isPortrait = sizeKey === "tablet" || sizeKey === "phone";

  // Calculate aspect ratio based on orientation
  const aspect = isPortrait ? 9 / 16 : 16 / 9;

  // Handle image loaded - create initial centered crop
  const onImageLoad = useCallback(
    (e) => {
      const { naturalWidth: width, naturalHeight: height } = e.currentTarget;

      // Calculate dimensions for display
      if (isPortrait) {
        // Portrait orientation (9:16)
        setDimensions({
          width: sizeWidth,
          height: Math.round((sizeWidth * 16) / 9),
        });
      } else {
        // Landscape orientation (16:9)
        setDimensions({
          width: sizeWidth,
          height: Math.round((sizeWidth * 9) / 16),
        });
      }

      // Set initial crop centered on the initial hotspot
      let cropX = initialHotspot.x * 100 - 25; // Center 50% width crop around hotspot
      let cropY = initialHotspot.y * 100 - 25; // Center 50% height crop around hotspot

      // Make sure crop stays within bounds
      cropX = Math.max(0, Math.min(cropX, 100 - 50));
      cropY = Math.max(0, Math.min(cropY, 100 - 50));

      // Create a centered crop
      let newCrop = {
        unit: "%",
        x: cropX,
        y: cropY,
        width: 50,
        height: 50 / aspect, // Maintain aspect ratio
      };

      // Use the react-image-crop utility functions
      newCrop = centerCrop(
        makeAspectCrop(newCrop, aspect, width, height),
        width,
        height
      );

      setCrop(newCrop);
      setCompletedCrop(newCrop);
    },
    [initialHotspot, isPortrait, sizeWidth, aspect]
  );

  // When crop changes, update hotspot
  useEffect(() => {
    if (completedCrop && imgRef.current) {
      // Calculate center point of crop as hotspot
      const hotspot = {
        x: (completedCrop.x + completedCrop.width / 2) / 100,
        y: (completedCrop.y + completedCrop.height / 2) / 100,
      };

      // Notify parent about hotspot change
      onHotspotChange(sizeKey, hotspot);
    }
  }, [completedCrop, onHotspotChange, sizeKey]);

  // Container style based on aspect ratio
  const containerStyle = {
    aspectRatio: isPortrait ? "9/16" : "16/9",
    maxWidth: "300px",
    margin: "0 auto",
  };

  // If no image, show placeholder
  if (!imageUrl) {
    return (
      <div className="border p-3 rounded bg-gray-50 text-center flex flex-col">
        <h4 className="font-semibold mb-2 text-sm">
          {sizeKey.toUpperCase()}{" "}
          <span className="font-normal text-xs">({sizeWidth}px)</span>
        </h4>
        <div
          style={containerStyle}
          className="border border-muted bg-muted/30 flex items-center justify-center"
        >
          <div className="text-red-600 text-xs p-2">No sample image</div>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          <span>X:0.500 Y:0.500</span>
          <div className="font-medium mt-1">
            <span>
              {dimensions.width}×{dimensions.height}
            </span>
            <span className="ml-2 text-muted">px</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border p-3 rounded bg-gray-50 text-center flex flex-col">
      <h4 className="font-semibold mb-2 text-sm">
        {sizeKey.toUpperCase()}{" "}
        <span className="font-normal text-xs">({sizeWidth}px)</span>
      </h4>

      <div style={containerStyle} className="crop-container">
        <ReactCrop
          crop={crop}
          onChange={(c) => setCrop(c)}
          onComplete={(c) => setCompletedCrop(c)}
          aspect={aspect}
          minWidth={30}
          minHeight={30 / aspect}
          className="max-w-full h-auto"
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt={`Preview for ${sizeKey}`}
            onLoad={onImageLoad}
            className="max-w-full h-auto object-contain"
          />
        </ReactCrop>
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        <span>
          X:
          {(completedCrop?.x !== undefined
            ? (completedCrop.x + completedCrop.width / 2) / 100
            : initialHotspot.x
          ).toFixed(3)}
        </span>
        <span className="ml-2">
          Y:
          {(completedCrop?.y !== undefined
            ? (completedCrop.y + completedCrop.height / 2) / 100
            : initialHotspot.y
          ).toFixed(3)}
        </span>
        <div className="font-medium mt-1">
          <span>
            {dimensions.width}×{dimensions.height}
          </span>
          <span className="ml-2 text-muted">px</span>
        </div>
      </div>
    </div>
  );
}
