import { Link } from "react-router";
import type { CSSProperties, ReactNode } from "react";

import { MarketingLayout } from "../components/marketing-layout";
import {
  ProductActVisual,
  ProductFindVisual,
  ProductGrowVisual,
  ProductMonitorVisual,
  ProductUnderstandVisual,
} from "../components/marketing-visuals";

const productTitle = "Axiom Orbit Product — Grow the clients you’ve already won.";
const productDescription =
  "Axiom Orbit helps agencies monitor client sites, understand public-site evidence, find focused opportunities, and prepare the next conversation.";
const productCanonical = "https://orbit.getaxiom.ca/product";
const socialImage = "https://orbit.getaxiom.ca/brand/axiom-orbit-social-1200x630.png";

export function meta() {
  return [
    { title: productTitle },
    { name: "description", content: productDescription },
    { tagName: "link", rel: "canonical", href: productCanonical },
    { property: "og:title", content: productTitle },
    { property: "og:description", content: productDescription },
    { property: "og:url", content: productCanonical },
    { property: "og:image", content: socialImage },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: productTitle },
    { name: "twitter:description", content: productDescription },
    { name: "twitter:image", content: socialImage },
  ];
}

const productChapters = [
  { id: "monitor", number: "01", label: "Monitor", availability: "Available now" },
  { id: "understand", number: "02", label: "Understand", availability: "Available now" },
  { id: "find", number: "03", label: "Find", availability: "Available now" },
  { id: "act", number: "04", label: "Act", availability: "Available now" },
  { id: "grow", number: "05", label: "Grow", availability: "Direction" },
] as const;

function ChapterAvailability({ children, direction = false }: { children: string; direction?: boolean }) {
  return (
    <p className={`marketing-product-availability${direction ? " marketing-product-availability--direction" : ""}`}>
      <span>{children}</span>
    </p>
  );
}

type ProductChapterProps = {
  id: string;
  number: string;
  label: string;
  title: string;
  copy: string;
  availability: string;
  note: string;
  visual: ReactNode;
  reverse?: boolean;
  direction?: boolean;
};

function ProductChapter({
  id,
  number,
  label,
  title,
  copy,
  availability,
  note,
  visual,
  reverse = false,
  direction = false,
}: ProductChapterProps) {
  return (
    <section id={id} className="marketing-product-chapter" aria-labelledby={`${id}-title`}>
      <div className={`marketing-container marketing-product-chapter-grid${reverse ? " marketing-product-chapter-grid--visual-left" : ""}`}>
        <div className="marketing-product-chapter-copy" data-reveal>
          <div className="marketing-product-chapter-kicker">
            <span>{number}</span>
            <span>{label}</span>
          </div>
          <h2 id={`${id}-title`}>{title}</h2>
          <p className="marketing-product-chapter-body">{copy}</p>
          <ChapterAvailability direction={direction}>{availability}</ChapterAvailability>
          <p className="marketing-product-chapter-note">{note}</p>
        </div>
        <div className="marketing-product-chapter-visual" data-reveal style={{ "--reveal-delay": "140ms" } as CSSProperties}>
          {visual}
        </div>
      </div>
    </section>
  );
}

export default function Product() {
  return (
    <MarketingLayout>
      <div className="marketing-product">
        <section className="marketing-product-hero" aria-labelledby="product-title">
          <div className="marketing-container marketing-product-hero-inner">
            <div className="marketing-product-hero-copy">
              <h1 id="product-title" data-reveal>Grow the clients you’ve already won.</h1>
              <p>
                Monitor client sites, understand the evidence, find legitimate work, and prepare the next conversation.
              </p>
              <p className="marketing-product-hero-distinction">
                Pipeline Engine acquires new clients. Orbit helps agencies grow existing accounts.
              </p>
              <div className="marketing-product-hero-actions">
                <Link className="marketing-button marketing-button-primary" to="/signup">
                  Request access
                </Link>
                <a className="marketing-product-text-link" href="#monitor">
                  See how it works <span aria-hidden="true">→</span>
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="marketing-product-boundary" aria-labelledby="product-boundary-title">
          <div className="marketing-container marketing-product-boundary-inner" data-reveal>
            <h2 id="product-boundary-title">
              Not a CRM. Not a generic scanner.<br />
              A focused post-sale growth workflow.
            </h2>
            <p>
              Orbit is not an SEO dashboard, lead-generation product, or cold-outreach tool. It keeps the review of existing client relationships grounded in public-site evidence and agency judgment.
            </p>
          </div>
        </section>

        <section className="marketing-product-rail" aria-label="Product chapters">
          <div className="marketing-container">
            <nav className="marketing-product-chapter-nav" aria-label="Product chapters" data-reveal>
              <ol>
                {productChapters.map((chapter) => (
                  <li key={chapter.id}>
                    <a href={`#${chapter.id}`}>
                      <span className="marketing-product-chapter-nav-number">{chapter.number}</span>
                      <span className="marketing-product-chapter-nav-label">{chapter.label}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </section>

        <ProductChapter
          id="monitor"
          number="01"
          label="Monitor"
          title="Keep every client in view."
          copy="Turn on weekly monitoring for a client and Orbit revisits the site, recording what is new, still open, resolved, or inconclusive — so “nothing changed” never means “we couldn’t look.”"
          availability="Available now · opt-in, per-client weekly monitoring"
          note="Monitoring is off by default. Results are recorded in the workspace — no email or Slack alerts yet."
          visual={<ProductMonitorVisual />}
        />

        <ProductChapter
          id="understand"
          number="02"
          label="Understand"
          title="Read the site in the context of the account."
          copy="Orbit reads the public pages it can safely fetch, keeps the source URLs and observed facts, and compares them with the client’s offerings, your service catalog, and contract coverage."
          availability="Available now · bounded public-site evidence"
          note="Public-site evidence plus agency-entered context — not a CRM sync."
          visual={<ProductUnderstandVisual />}
          reverse
        />

        <ProductChapter
          id="find"
          number="03"
          label="Find"
          title="Find work you can actually sell."
          copy="Orbit surfaces three evidence-backed gap types: a missing service page, a site with no service pages (only when the read supports it), and a broken conversion path. Each finding must map to a service you sell and stay billable after contract coverage."
          availability="Available now · three detection categories"
          note="Additional categories are product direction, not live functionality."
          visual={<ProductFindVisual />}
        />

        <ProductChapter
          id="act"
          number="04"
          label="Act"
          title="Turn a signal into the next conversation."
          copy="Review the case, inspect the source pages, see the mapped service and your typical price range, then prepare an editable proposal draft. Your team decides what to send."
          availability="Available now · review + proposal draft"
          note="Nothing is sent from this workflow."
          visual={<ProductActVisual />}
          reverse
        />

        <ProductChapter
          id="grow"
          number="05"
          label="Grow"
          title="Close the loop over time."
          copy="Orbit’s direction is a fuller account-growth lifecycle: opportunity, decision, delivered work, and measured outcome. Today you get potential value ranges and finding history."
          availability="Direction · revenue and outcome tracking"
          note="Revenue and outcome tracking belong to the next layer, not to today’s product claim."
          visual={<ProductGrowVisual />}
          direction
        />

        <section className="marketing-product-final-cta" aria-labelledby="product-final-title">
          <div className="marketing-container marketing-product-final-cta-inner" data-reveal>
            <div>
              <h2 id="product-final-title">Ready to grow what you already have?</h2>
              <p>Request access to the Axiom Orbit pilot.</p>
            </div>
            <Link className="marketing-button marketing-button-primary" to="/signup">
              Request access
            </Link>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}
