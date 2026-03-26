import React from "react";

export interface Testimonial {
  name: string;
  text: string;
  rating?: number;
  source?: string;
}

export interface TestimonialsSectionProps {
  testimonials: Testimonial[];
  layout?: "grid" | "carousel";
  maxDisplay?: number;
  className?: string;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div style={{ color: "#f59e0b", fontSize: "1.25rem", marginBottom: "0.75rem" }}>
      {"★".repeat(rating)}
      {"☆".repeat(5 - rating)}
    </div>
  );
}

export function TestimonialsSection({
  testimonials,
  maxDisplay,
  className,
}: TestimonialsSectionProps) {
  const displayed = maxDisplay
    ? testimonials.slice(0, maxDisplay)
    : testimonials;

  return (
    <div
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        gap: "2rem",
      }}
    >
      {displayed.map((testimonial, i) => (
        <div
          key={i}
          style={{
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "0.75rem",
            padding: "2rem",
          }}
        >
          {testimonial.rating && <StarRating rating={testimonial.rating} />}
          <blockquote
            style={{
              fontStyle: "italic",
              color: "#4b5563",
              marginBottom: "1rem",
              lineHeight: 1.7,
            }}
          >
            &ldquo;{testimonial.text}&rdquo;
          </blockquote>
          <div style={{ fontWeight: 600, color: "#111827" }}>
            &mdash; {testimonial.name}
          </div>
          {testimonial.source && (
            <div style={{ fontSize: "0.875rem", color: "#9ca3af", marginTop: "0.25rem" }}>
              via {testimonial.source}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
