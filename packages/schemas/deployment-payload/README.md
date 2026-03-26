# deployment-payload schema

Defines everything needed to deploy a generated site to vaen.space (or any hosting target).

## Location

- **TypeScript type + JSON Schema:** `../src/deployment-payload.ts`
- **Validation helper:** `../src/validate.ts` → `validateDeploymentPayload()`
- **Subpath import:** `@vaen/schemas/deployment-payload`

## Overview

A `deployment-payload.json` is produced by the generator alongside the site workspace:

| Field | Description |
|-------|-------------|
| `version` | Schema version (`"1.0.0"`) |
| `clientSlug` | URL-safe identifier for the client |
| `sitePath` | Relative path to the site directory within the workspace |
| `buildCommand` | Command to build the site (e.g. `pnpm build`) |
| `outputDir` | Build output directory (e.g. `.next`) |
| `framework` | Framework identifier (`"nextjs"`) |
| `nodeVersion` | Required Node.js version |
| `envVars` | Environment variables needed at build/runtime |
| `domain` | Subdomain and optional custom domain |
| `metadata` | Generation timestamp, template/module IDs, business info |

## Validation

```typescript
import { validateDeploymentPayload } from "@vaen/schemas/deployment-payload";

const result = validateDeploymentPayload(data);
if (!result.valid) {
  console.error(result.errors);
}
```
