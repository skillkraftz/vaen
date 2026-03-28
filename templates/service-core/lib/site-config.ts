import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SiteConfig {
  business: {
    name: string;
    type: string;
    tagline: string;
    description: string;
  };
  contact: {
    phone?: string;
    email?: string;
    address?: {
      street?: string;
      city: string;
      state: string;
      zip: string;
      formatted: string;
    };
  };
  seo: {
    title: string;
    description: string;
    ogImage?: string;
  };
  branding: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    fontFamily: string;
  };
  services: Array<{
    name: string;
    description: string;
    price?: string;
  }>;
  hero: {
    headline: string;
    subheadline: string;
  };
  about: string;
  testimonials: Array<{
    name: string;
    text: string;
    rating?: number;
  }>;
  gallery: Array<{
    url: string;
    alt: string;
  }>;
  modules: {
    mapsEmbed?: {
      enabled: boolean;
      address: string;
      zoom?: number;
    };
    testimonials?: {
      enabled: boolean;
    };
  };
}

export interface SiteConfigRuntimeDiagnostics {
  timestamp: string;
  route: string;
  process_cwd: string;
  configured_path: string | null;
  resolved_config_path: string;
  config_exists: boolean;
  config_sha256: string | null;
  business_name: string | null;
  seo_title: string | null;
  hero_headline: string | null;
  expected_business_name: string | null;
  runtime_config_status: "matched" | "mismatched" | "unknown";
}

// Default config used during development and as fallback
export const defaultConfig: SiteConfig = {
  business: {
    name: "Local Business",
    type: "General Services",
    tagline: "Quality service you can trust",
    description: "We provide professional services to our local community.",
  },
  contact: {
    phone: "(555) 123-4567",
    email: "hello@example.com",
    address: {
      street: "123 Main Street",
      city: "Anytown",
      state: "NY",
      zip: "12345",
      formatted: "123 Main Street, Anytown, NY 12345",
    },
  },
  seo: {
    title: "Local Business | Quality Service You Can Trust",
    description:
      "We provide professional services to our local community. Contact us today for a free estimate.",
  },
  branding: {
    primaryColor: "#2563eb",
    secondaryColor: "#1e40af",
    accentColor: "#f59e0b",
    fontFamily: "Inter, system-ui, sans-serif",
  },
  services: [
    {
      name: "Service One",
      description: "A detailed description of our first service offering.",
    },
    {
      name: "Service Two",
      description: "A detailed description of our second service offering.",
    },
    {
      name: "Service Three",
      description: "A detailed description of our third service offering.",
    },
  ],
  hero: {
    headline: "Quality Service You Can Trust",
    subheadline:
      "Serving the local community with pride and professionalism.",
  },
  about:
    "We are a locally owned and operated business committed to delivering exceptional service. With years of experience and a dedication to quality, we take pride in every project we undertake.",
  testimonials: [
    {
      name: "John D.",
      text: "Excellent work! They were professional, on time, and the results exceeded our expectations.",
      rating: 5,
    },
    {
      name: "Sarah M.",
      text: "Great communication throughout the project. Would highly recommend to anyone looking for quality service.",
      rating: 5,
    },
  ],
  gallery: [],
  modules: {
    mapsEmbed: {
      enabled: false,
      address: "123 Main Street, Anytown, NY 12345",
    },
    testimonials: {
      enabled: true,
    },
  },
};

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function resolveConfigPath(): {
  configuredPath: string | null;
  resolvedPath: string;
  exists: boolean;
} {
  const configuredPath = process.env.VAEN_SITE_CONFIG_PATH ?? null;
  const candidates = [
    configuredPath,
    join(process.cwd(), "config.json"),
    join(process.cwd(), "..", "config.json"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return {
        configuredPath,
        resolvedPath: candidate,
        exists: true,
      };
    }
  }

  return {
    configuredPath,
    resolvedPath: candidates[0] ?? join(process.cwd(), "config.json"),
    exists: false,
  };
}

function appendRuntimeProbe(entry: SiteConfigRuntimeDiagnostics) {
  const probePath = process.env.VAEN_RUNTIME_PROBE_PATH;
  if (!probePath) return;

  try {
    mkdirSync(dirname(probePath), { recursive: true });
    const existing = existsSync(probePath)
      ? JSON.parse(readFileSync(probePath, "utf-8")) as SiteConfigRuntimeDiagnostics[]
      : [];
    existing.push(entry);
    writeFileSync(probePath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  } catch {
    // Probe writing is best-effort and must never break rendering.
  }
}

function loadSiteConfig(route = "unknown"): {
  config: SiteConfig;
  diagnostics: SiteConfigRuntimeDiagnostics;
} {
  const resolved = resolveConfigPath();
  const expectedBusinessName = process.env.VAEN_EXPECTED_BUSINESS_NAME ?? null;

  try {
    const raw = readFileSync(resolved.resolvedPath, "utf-8");
    const loaded = JSON.parse(raw) as Record<string, unknown>;
    const config = deepMerge(
      defaultConfig as unknown as Record<string, unknown>,
      loaded,
    ) as unknown as SiteConfig;
    const diagnostics: SiteConfigRuntimeDiagnostics = {
      timestamp: new Date().toISOString(),
      route,
      process_cwd: process.cwd(),
      configured_path: resolved.configuredPath,
      resolved_config_path: resolved.resolvedPath,
      config_exists: true,
      config_sha256: sha256(raw),
      business_name: config.business.name,
      seo_title: config.seo.title,
      hero_headline: config.hero.headline,
      expected_business_name: expectedBusinessName,
      runtime_config_status:
        expectedBusinessName == null
          ? "unknown"
          : config.business.name === expectedBusinessName
            ? "matched"
            : "mismatched",
    };
    appendRuntimeProbe(diagnostics);
    return { config, diagnostics };
  } catch {
    const diagnostics: SiteConfigRuntimeDiagnostics = {
      timestamp: new Date().toISOString(),
      route,
      process_cwd: process.cwd(),
      configured_path: resolved.configuredPath,
      resolved_config_path: resolved.resolvedPath,
      config_exists: resolved.exists,
      config_sha256: null,
      business_name: defaultConfig.business.name,
      seo_title: defaultConfig.seo.title,
      hero_headline: defaultConfig.hero.headline,
      expected_business_name: expectedBusinessName,
      runtime_config_status: expectedBusinessName == null ? "unknown" : "mismatched",
    };
    appendRuntimeProbe(diagnostics);
    return { config: defaultConfig, diagnostics };
  }
}

export function getSiteConfig(): SiteConfig {
  return loadSiteConfig().config;
}

export function getSiteConfigForRoute(route: string): SiteConfig {
  return loadSiteConfig(route).config;
}

export function getSiteConfigDiagnostics(route: string): SiteConfigRuntimeDiagnostics {
  return loadSiteConfig(route).diagnostics;
}
