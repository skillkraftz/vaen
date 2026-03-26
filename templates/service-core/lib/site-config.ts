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
        source[key] as Record<string, unknown>
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

let _config: SiteConfig | null = null;

export function getSiteConfig(): SiteConfig {
  if (_config) return _config;

  try {
    // In generated sites, config.json is placed at the project root
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require("../config.json");
    _config = deepMerge(
      defaultConfig as unknown as Record<string, unknown>,
      loaded as Record<string, unknown>
    ) as unknown as SiteConfig;
    return _config;
  } catch {
    return defaultConfig;
  }
}
