import type { ClientRequest } from "@vaen/schemas";
import type { BuildManifest } from "@vaen/schemas";
import { getTemplate } from "@vaen/template-registry";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const fontMap: Record<string, string> = {
  modern: "Inter, system-ui, sans-serif",
  classic: "'Georgia', 'Times New Roman', serif",
  playful: "'Poppins', 'Comic Sans MS', sans-serif",
  professional: "'Inter', 'Helvetica Neue', Arial, sans-serif",
};

export function resolveConfig(
  clientRequest: ClientRequest,
  templateId: string,
  moduleIds: string[]
): BuildManifest {
  const template = getTemplate(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const clientSlug = slugify(clientRequest.business.name);
  const branding = clientRequest.branding;
  const defaults = template.defaults.branding;

  // Read _intake.* fields from the portal's build-prep editor.
  // These are extra fields outside the ClientRequest schema, preserved
  // through export and used here to enrich the generated site config.
  const raw = clientRequest as unknown as Record<string, unknown>;
  const intake = (raw._intake ?? {}) as Record<string, string>;
  const prefNotes = clientRequest.preferences?.notes;
  const rawPreferences = (clientRequest.preferences ?? {}) as Record<string, unknown>;
  const operatorModuleConfig = (rawPreferences.moduleConfig ?? {}) as Record<string, Record<string, unknown>>;

  const resolvedBranding = {
    primaryColor: branding?.primaryColor ?? defaults.primaryColor,
    secondaryColor: branding?.secondaryColor ?? defaults.secondaryColor,
    accentColor: branding?.accentColor ?? defaults.accentColor,
    fontFamily: branding?.fontPreference
      ? fontMap[branding.fontPreference] ?? defaults.fontFamily
      : defaults.fontFamily,
  };

  const address = clientRequest.contact.address;
  const formattedAddress = address
    ? [address.street, address.city, address.state, address.zip]
        .filter(Boolean)
        .join(", ")
    : "";

  // Derive enriched values from intake fields
  const serviceArea = intake.serviceArea || address?.city || "your area";
  const businessDesc =
    clientRequest.business.description ??
    intake.goals ??
    `${clientRequest.business.name} provides professional ${clientRequest.business.type.toLowerCase()} services.`;
  const aboutText =
    clientRequest.content?.about ??
    intake.about ??
    `${clientRequest.business.name} is a trusted provider of ${clientRequest.business.type.toLowerCase()} services.`;

  const siteConfig: BuildManifest["siteConfig"] = {
    business: {
      name: clientRequest.business.name,
      type: clientRequest.business.type,
      tagline:
        clientRequest.business.tagline ?? "Quality service you can trust",
      description: businessDesc,
    },
    contact: {
      phone: clientRequest.contact.phone,
      email: clientRequest.contact.email,
      address: address
        ? {
            street: address.street,
            city: address.city,
            state: address.state,
            zip: address.zip,
            formatted: formattedAddress,
          }
        : undefined,
    },
    seo: {
      title: `${clientRequest.business.name} | ${clientRequest.business.tagline ?? clientRequest.business.type}`,
      description:
        clientRequest.business.description ??
        `${clientRequest.business.name} — professional ${clientRequest.business.type.toLowerCase()} services in ${serviceArea}.`,
    },
    branding: resolvedBranding,
    services: clientRequest.services.map((s) => ({
      name: s.name,
      description: s.description ?? "",
      price: s.price,
    })),
    hero: {
      headline:
        clientRequest.content?.heroHeadline ??
        `Welcome to ${clientRequest.business.name}`,
      subheadline:
        clientRequest.content?.heroSubheadline ??
        clientRequest.business.tagline ??
        (intake.targetCustomer
          ? `Professional ${clientRequest.business.type.toLowerCase()} services for ${intake.targetCustomer}.`
          : `Professional ${clientRequest.business.type.toLowerCase()} services.`),
    },
    about: aboutText,
    testimonials: (clientRequest.content?.testimonials ?? []).map((t) => ({
      name: t.name,
      text: t.text,
      rating: t.rating,
    })),
    gallery: (clientRequest.content?.galleryImages ?? []).map((g) => ({
      url: g.url,
      alt: g.alt ?? "",
    })),
    // Intake enrichment fields (available for templates to consume)
    ...(intake.serviceArea ? { serviceArea: intake.serviceArea } : {}),
    ...(intake.targetCustomer ? { targetCustomer: intake.targetCustomer } : {}),
    ...(intake.goals ? { goals: intake.goals } : {}),
    ...(intake.branding ? { brandingNotes: intake.branding } : {}),
    ...(prefNotes ? { operatorNotes: prefNotes } : {}),
  };

  const moduleConfigs = moduleIds.map((id) => {
    const config: Record<string, unknown> = { ...(operatorModuleConfig[id] ?? {}) };
    if (id === "maps-embed" && formattedAddress && !config.address) {
      config.address = formattedAddress;
    }
    if (id === "manual-testimonials" && !config.testimonials) {
      config.testimonials = siteConfig.testimonials;
    }
    config.enabled = true;
    return {
      id,
      version: "0.1.0",
      config,
    };
  });

  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    clientSlug,
    template: {
      id: templateId,
      version: template.version,
    },
    modules: moduleConfigs,
    siteConfig,
    pages: template.pages,
    files: [], // populated after file generation
  };
}
