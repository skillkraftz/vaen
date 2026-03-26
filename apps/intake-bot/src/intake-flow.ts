/**
 * Intake flow — step-by-step conversational intake.
 *
 * Models the intake as a state machine: each step collects a section of
 * the client request (business info, contact, services, branding, etc.).
 *
 * In v0 this is a type-level model. In v1 each step maps to a Discord
 * conversation turn powered by OpenClaw.
 */

import type { ClientRequest } from "@vaen/schemas";
import type { TargetState } from "@vaen/shared";

// ── Intake steps ─────────────────────────────────────────────────────

export type IntakeStep =
  | "business_info"
  | "contact_info"
  | "services"
  | "branding"
  | "content"
  | "features"
  | "preferences"
  | "review"
  | "confirmed";

export const INTAKE_STEPS: IntakeStep[] = [
  "business_info",
  "contact_info",
  "services",
  "branding",
  "content",
  "features",
  "preferences",
  "review",
  "confirmed",
];

/** Human-readable prompts for each step. */
export const STEP_PROMPTS: Record<IntakeStep, string> = {
  business_info: "Tell me about your business — name, type, and a brief description.",
  contact_info: "What's the best way for customers to reach you? (phone, email, address)",
  services: "What services do you offer? List each with a brief description and price if applicable.",
  branding: "Do you have brand colors, font preferences, or a logo? Share what you have.",
  content: "Share your 'about us' story, any testimonials, and gallery images you'd like featured.",
  features: "Which features would you like? Maps, contact form, testimonials, gallery, booking?",
  preferences: "Any preferences for template style, domain name, or other notes?",
  review: "Here's a summary of what I've collected. Does everything look correct?",
  confirmed: "Your intake is complete and ready for site generation.",
};

// ── Intake context ───────────────────────────────────────────────────

export interface IntakeContext {
  /** Target slug for this intake */
  slug: string;
  /** Current step in the intake flow */
  currentStep: IntakeStep;
  /** Collected data so far (partial client request) */
  collected: Partial<ClientRequest>;
  /** ISO timestamp when intake started */
  startedAt: string;
  /** Corresponding target lifecycle state */
  targetState: TargetState;
}

/**
 * Create a new intake context for a target.
 */
export function createIntakeContext(slug: string): IntakeContext {
  return {
    slug,
    currentStep: "business_info",
    collected: {},
    startedAt: new Date().toISOString(),
    targetState: "intake_received",
  };
}

/**
 * Advance the intake to the next step after collecting data.
 * Returns the updated context, or null if already at the end.
 */
export function advanceIntake(
  ctx: IntakeContext,
  stepData: Partial<ClientRequest>,
): IntakeContext | null {
  const currentIndex = INTAKE_STEPS.indexOf(ctx.currentStep);
  if (currentIndex === -1 || currentIndex >= INTAKE_STEPS.length - 1) {
    return null; // already at end
  }

  const nextStep = INTAKE_STEPS[currentIndex + 1];
  return {
    ...ctx,
    currentStep: nextStep,
    collected: { ...ctx.collected, ...stepData },
    targetState: nextStep === "confirmed" ? "intake_parsed" : "intake_received",
  };
}

/**
 * Check if the intake flow is complete.
 */
export function isIntakeComplete(ctx: IntakeContext): boolean {
  return ctx.currentStep === "confirmed";
}
