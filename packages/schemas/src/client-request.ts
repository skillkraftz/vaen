export interface ClientRequest {
  version: "1.0.0";
  business: {
    name: string;
    type: string;
    tagline?: string;
    description?: string;
    yearEstablished?: number;
  };
  contact: {
    phone?: string;
    email?: string;
    address?: {
      street?: string;
      city: string;
      state: string;
      zip: string;
    };
    website?: string;
  };
  services: Array<{
    name: string;
    description?: string;
    price?: string;
  }>;
  branding?: {
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    fontPreference?: "modern" | "classic" | "playful" | "professional";
    logoUrl?: string;
  };
  content?: {
    about?: string;
    heroHeadline?: string;
    heroSubheadline?: string;
    testimonials?: Array<{
      name: string;
      text: string;
      rating?: number;
      source?: string;
    }>;
    galleryImages?: Array<{
      url: string;
      alt?: string;
      caption?: string;
    }>;
  };
  features?: {
    maps?: boolean;
    contactForm?: boolean;
    testimonials?: boolean;
    gallery?: boolean;
    booking?: boolean;
    googleReviews?: boolean;
  };
  preferences?: {
    template?: string;
    modules?: string[];
    domain?: string;
    notes?: string;
  };
}

export const clientRequestSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["version", "business", "contact", "services"],
  properties: {
    version: { type: "string", const: "1.0.0" },
    business: {
      type: "object",
      required: ["name", "type"],
      properties: {
        name: { type: "string" },
        type: { type: "string" },
        tagline: { type: "string" },
        description: { type: "string" },
        yearEstablished: { type: "number" },
      },
    },
    contact: {
      type: "object",
      properties: {
        phone: { type: "string" },
        email: { type: "string" },
        address: {
          type: "object",
          required: ["city", "state", "zip"],
          properties: {
            street: { type: "string" },
            city: { type: "string" },
            state: { type: "string" },
            zip: { type: "string" },
          },
        },
        website: { type: "string" },
      },
    },
    services: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          price: { type: "string" },
        },
      },
    },
    branding: {
      type: "object",
      properties: {
        primaryColor: { type: "string" },
        secondaryColor: { type: "string" },
        accentColor: { type: "string" },
        fontPreference: {
          type: "string",
          enum: ["modern", "classic", "playful", "professional"],
        },
        logoUrl: { type: "string" },
      },
    },
    content: {
      type: "object",
      properties: {
        about: { type: "string" },
        heroHeadline: { type: "string" },
        heroSubheadline: { type: "string" },
        testimonials: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "text"],
            properties: {
              name: { type: "string" },
              text: { type: "string" },
              rating: { type: "number", minimum: 1, maximum: 5 },
              source: { type: "string" },
            },
          },
        },
        galleryImages: {
          type: "array",
          items: {
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string" },
              alt: { type: "string" },
              caption: { type: "string" },
            },
          },
        },
      },
    },
    features: {
      type: "object",
      properties: {
        maps: { type: "boolean" },
        contactForm: { type: "boolean" },
        testimonials: { type: "boolean" },
        gallery: { type: "boolean" },
        booking: { type: "boolean" },
        googleReviews: { type: "boolean" },
      },
    },
    preferences: {
      type: "object",
      properties: {
        template: { type: "string" },
        modules: { type: "array", items: { type: "string" } },
        domain: { type: "string" },
        notes: { type: "string" },
      },
    },
  },
} as const;
