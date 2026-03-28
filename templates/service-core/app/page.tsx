import { getSiteConfigForRoute } from "@/lib/site-config";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const config = getSiteConfigForRoute("/");
  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>{config.hero.headline}</h1>
          <p>{config.hero.subheadline}</p>
          <div className="hero-buttons">
            <a href="/contact" className="btn btn-accent">
              Get a Free Quote
            </a>
            <a href="#services" className="btn btn-outline" style={{ borderColor: "#fff", color: "#fff" }}>
              Our Services
            </a>
          </div>
        </div>
      </section>

      <section id="services" className="section">
        <div className="container">
          <h2 className="section-title">Our Services</h2>
          <div className="services-grid">
            {config.services.map((service, i) => (
              <div key={i} className="service-card">
                <h3>{service.name}</h3>
                <p>{service.description}</p>
                {service.price && <span className="price">{service.price}</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <h2 className="section-title">About {config.business.name}</h2>
          <p className="about-content">{config.about}</p>
        </div>
      </section>

      {config.modules.testimonials?.enabled &&
        config.testimonials.length > 0 && (
          <section id="testimonials" className="section">
            <div className="container">
              <h2 className="section-title">What Our Customers Say</h2>
              <div className="testimonials-grid">
                {config.testimonials.map((testimonial, i) => (
                  <div key={i} className="testimonial-card">
                    {testimonial.rating && (
                      <div className="stars">
                        {"★".repeat(testimonial.rating)}
                        {"☆".repeat(5 - testimonial.rating)}
                      </div>
                    )}
                    <blockquote>&ldquo;{testimonial.text}&rdquo;</blockquote>
                    <div className="author">&mdash; {testimonial.name}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

      {config.gallery.length > 0 && (
        <section id="gallery" className="section section-alt">
          <div className="container">
            <h2 className="section-title">Our Work</h2>
            <div className="gallery-grid">
              {config.gallery.map((image, i) => (
                <div key={i} className="gallery-item">
                  <img src={image.url} alt={image.alt} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {config.modules.mapsEmbed?.enabled && (
        <section className="section">
          <div className="container">
            <h2 className="section-title">Find Us</h2>
            <div className="map-container">
              <iframe
                src={`https://maps.google.com/maps?q=${encodeURIComponent(config.modules.mapsEmbed.address)}&output=embed`}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Business Location"
              />
            </div>
          </div>
        </section>
      )}

      <section className="cta">
        <div className="container">
          <h2>Ready to Get Started?</h2>
          <p>
            Contact us today for a free estimate. We&apos;d love to hear about your
            project.
          </p>
          <a href="/contact" className="btn btn-accent">
            Contact Us Now
          </a>
        </div>
      </section>
    </>
  );
}
