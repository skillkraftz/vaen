# @vaen/intake-bot

Discord bot for client intake — guides clients through a conversational flow to collect business info, validates against the ClientRequest schema, and outputs `client-request.json`.

**Status:** Scaffolded — intake flow model and finalization logic implemented. No Discord connection yet.

## Architecture

The intake is modeled as a step-by-step state machine:

1. `business_info` — Name, type, description
2. `contact_info` — Phone, email, address
3. `services` — Service list with descriptions and pricing
4. `branding` — Colors, fonts, logo
5. `content` — About text, testimonials, gallery images
6. `features` — Maps, contact form, testimonials, gallery, booking
7. `preferences` — Template, modules, domain, notes
8. `review` — Summary confirmation
9. `confirmed` — Ready for generation

## Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point |
| `src/intake-flow.ts` | Step-by-step intake state machine |
| `src/finalize.ts` | Validate and write client-request.json |

## Usage (programmatic)

```typescript
import { createIntakeContext, advanceIntake, finalizeIntake } from "@vaen/intake-bot";

const ctx = createIntakeContext("my-client");
// advance through steps with collected data...
await finalizeIntake(ctx, repoRoot);
```

## v1 Targets
- Discord.js bot with slash commands
- OpenClaw AI-powered conversational flow
- Real-time intake tracking via portal
