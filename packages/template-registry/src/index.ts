export type { TemplateManifest } from "./types.js";

export { serviceCoreManifest } from "./manifests/service-core.js";
export { serviceAreaManifest } from "./manifests/service-area.js";
export { authorityManifest } from "./manifests/authority.js";

import { serviceCoreManifest } from "./manifests/service-core.js";
import { serviceAreaManifest } from "./manifests/service-area.js";
import { authorityManifest } from "./manifests/authority.js";
import type { TemplateManifest } from "./types.js";

const templates: Record<string, TemplateManifest> = {
  "service-core": serviceCoreManifest,
  "service-area": serviceAreaManifest,
  authority: authorityManifest,
};

export function getTemplate(id: string): TemplateManifest | undefined {
  return templates[id];
}

export function listTemplates(): TemplateManifest[] {
  return Object.values(templates);
}

export function listActiveTemplates(): TemplateManifest[] {
  return Object.values(templates).filter((t) => t.status === "active");
}
