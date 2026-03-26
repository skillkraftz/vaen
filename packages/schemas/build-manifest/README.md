# build-manifest schema

Defines the resolved build plan produced by the generator — the source of truth for what was generated and why.

## Location

- **TypeScript type + JSON Schema:** `../src/build-manifest.ts`
- **Validation helper:** `../src/validate.ts` → `validateBuildManifest()`
- **Subpath import:** `@vaen/schemas/build-manifest`

## Overview

A `build-manifest.json` is produced by the generator and contains:

| Field | Description |
|-------|-------------|
| `version` | Schema version (`"1.0.0"`) |
| `generatedAt` | ISO 8601 timestamp |
| `clientSlug` | URL-safe slug derived from business name |
| `template` | Template ID and version used |
| `modules` | Array of modules with their resolved configs |
| `siteConfig` | Fully resolved site configuration (business, contact, SEO, branding, services, hero, about, testimonials, gallery) |
| `pages` | List of page routes generated |
| `files` | List of all files in the generated workspace |

## Validation

```typescript
import { validateBuildManifest } from "@vaen/schemas/build-manifest";

const result = validateBuildManifest(data);
if (!result.valid) {
  console.error(result.errors);
}
```
