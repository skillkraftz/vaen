/**
 * @vaen/intake-bot — Discord bot for conversational client intake.
 *
 * Guides a client through a conversational flow to collect business info,
 * validates the result against the ClientRequest schema, and writes
 * client-request.json to the target workspace.
 *
 * v0: Scaffolding only — no Discord connection yet.
 * v1: OpenClaw AI-powered conversational intake via Discord.
 */

import type { IntakeContext } from "./intake-flow.js";
import { createIntakeContext, advanceIntake, isIntakeComplete } from "./intake-flow.js";
import { finalizeIntake } from "./finalize.js";

export { createIntakeContext, advanceIntake, isIntakeComplete } from "./intake-flow.js";
export { finalizeIntake } from "./finalize.js";
export type { IntakeContext } from "./intake-flow.js";

/**
 * Main entry point for the intake bot.
 * In v1 this will connect to Discord and listen for intake commands.
 */
async function main() {
  console.log("@vaen/intake-bot — not yet connected to Discord");
  console.log("Use the intake flow programmatically:");
  console.log("  import { createIntakeContext, advanceIntake } from '@vaen/intake-bot'");

  // Demo: create an intake context
  const ctx = createIntakeContext("demo-client");
  console.log(`\nCreated intake context for "${ctx.slug}" in state: ${ctx.currentStep}`);
}

main().catch(console.error);
