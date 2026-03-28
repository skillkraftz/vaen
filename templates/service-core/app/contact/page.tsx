import { getSiteConfigForRoute } from "@/lib/site-config";

export const dynamic = "force-dynamic";

export default function ContactPage() {
  const config = getSiteConfigForRoute("/contact");
  return (
    <div className="contact-page">
      <div className="container">
        <h1 className="section-title">Contact {config.business.name}</h1>
        <div className="contact-grid">
          <div className="contact-info">
            <h2>Get in Touch</h2>
            <p>
              We&apos;d love to hear from you. Reach out for a free estimate or
              to learn more about our services.
            </p>

            {config.contact.phone && (
              <div className="contact-detail">
                <span className="label">Phone:</span>
                <a href={`tel:${config.contact.phone}`}>
                  {config.contact.phone}
                </a>
              </div>
            )}

            {config.contact.email && (
              <div className="contact-detail">
                <span className="label">Email:</span>
                <a href={`mailto:${config.contact.email}`}>
                  {config.contact.email}
                </a>
              </div>
            )}

            {config.contact.address && (
              <div className="contact-detail">
                <span className="label">Address:</span>
                <span>{config.contact.address.formatted}</span>
              </div>
            )}

            {config.modules.mapsEmbed?.enabled && (
              <div className="map-container">
                <iframe
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(config.modules.mapsEmbed.address)}&output=embed`}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Business Location"
                />
              </div>
            )}
          </div>

          <form className="contact-form" action="#" method="POST">
            <div className="form-group">
              <label htmlFor="name">Name</label>
              <input type="text" id="name" name="name" required />
            </div>

            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input type="email" id="email" name="email" required />
            </div>

            <div className="form-group">
              <label htmlFor="phone">Phone</label>
              <input type="tel" id="phone" name="phone" />
            </div>

            <div className="form-group">
              <label htmlFor="service">Service Interested In</label>
              <select id="service" name="service">
                <option value="">Select a service...</option>
                {config.services.map((service, i) => (
                  <option key={i} value={service.name}>
                    {service.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="message">Message</label>
              <textarea
                id="message"
                name="message"
                required
                placeholder="Tell us about your project..."
              />
            </div>

            <button type="submit" className="btn btn-primary">
              Send Message
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
