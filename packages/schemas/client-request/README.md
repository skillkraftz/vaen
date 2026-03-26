# client-request schema

Defines the shape of raw client intake data — the entry point to the vaen pipeline.

## Location

- **TypeScript type + JSON Schema:** `../src/client-request.ts`
- **Validation helper:** `../src/validate.ts` → `validateClientRequest()`
- **Subpath import:** `@vaen/schemas/client-request`

## Overview

A `client-request.json` contains everything collected during client intake:

| Field | Required | Description |
|-------|----------|-------------|
| `version` | yes | Schema version, currently `"1.0.0"` |
| `business` | yes | Business name, type, tagline, description, year established |
| `contact` | yes | Phone, email, address |
| `services` | yes | Array of service offerings (name, description, price) |
| `branding` | no | Colors, font preference, logo URL |
| `content` | no | Hero text, about text, testimonials, gallery images |
| `features` | no | Feature flags: maps, contact form, testimonials, gallery, booking, reviews |
| `preferences` | no | Template preference, module list, domain, freeform notes |

## Validation

```typescript
import { validateClientRequest } from "@vaen/schemas/client-request";

const result = validateClientRequest(data);
if (!result.valid) {
  console.error(result.errors);
}
```
