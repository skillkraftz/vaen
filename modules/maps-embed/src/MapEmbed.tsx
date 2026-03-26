import React from "react";

export interface MapEmbedProps {
  address: string;
  zoom?: number;
  height?: number;
  width?: string;
  className?: string;
}

export function MapEmbed({
  address,
  zoom = 15,
  height = 400,
  width = "100%",
  className,
}: MapEmbedProps) {
  const src = `https://maps.google.com/maps?q=${encodeURIComponent(address)}&z=${zoom}&output=embed`;

  return (
    <div
      className={className}
      style={{
        borderRadius: "0.75rem",
        overflow: "hidden",
        width,
      }}
    >
      <iframe
        src={src}
        width="100%"
        height={height}
        style={{ border: 0 }}
        allowFullScreen
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title={`Map showing ${address}`}
      />
    </div>
  );
}
