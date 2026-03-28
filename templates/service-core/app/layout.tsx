import type { Metadata } from "next";
import { getSiteConfigForRoute } from "@/lib/site-config";
import "./globals.css";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const config = getSiteConfigForRoute("/(metadata)");
  return {
    title: config.seo.title,
    description: config.seo.description,
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const config = getSiteConfigForRoute("/(layout)");
  return (
    <html lang="en">
      <body
        style={
          {
            "--color-primary": config.branding.primaryColor,
            "--color-secondary": config.branding.secondaryColor,
            "--color-accent": config.branding.accentColor,
            "--font-family": config.branding.fontFamily,
          } as React.CSSProperties
        }
      >
        <Header config={config} />
        <main>{children}</main>
        <Footer config={config} />
      </body>
    </html>
  );
}

function Header({ config }: { config: ReturnType<typeof getSiteConfigForRoute> }) {
  return (
    <header className="header">
      <div className="container header-inner">
        <a href="/" className="logo">
          {config.business.name}
        </a>
        <nav className="nav">
          <a href="/#services">Services</a>
          {config.modules.testimonials?.enabled && (
            <a href="/#testimonials">Reviews</a>
          )}
          {config.gallery.length > 0 && <a href="/#gallery">Gallery</a>}
          <a href="/contact" className="btn btn-primary">
            Contact Us
          </a>
        </nav>
      </div>
    </header>
  );
}

function Footer({ config }: { config: ReturnType<typeof getSiteConfigForRoute> }) {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-info">
          <h3>{config.business.name}</h3>
          <p>{config.business.tagline}</p>
        </div>
        <div className="footer-contact">
          {config.contact.phone && (
            <p>
              <a href={`tel:${config.contact.phone}`}>{config.contact.phone}</a>
            </p>
          )}
          {config.contact.email && (
            <p>
              <a href={`mailto:${config.contact.email}`}>
                {config.contact.email}
              </a>
            </p>
          )}
          {config.contact.address && (
            <p>{config.contact.address.formatted}</p>
          )}
        </div>
        <div className="footer-copy">
          <p>
            &copy; {new Date().getFullYear()} {config.business.name}. All rights
            reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
