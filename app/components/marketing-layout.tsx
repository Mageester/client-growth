import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";

import "../styles/marketing.css";

const mobileNavigationId = "marketing-mobile-nav";

const navigationItems = [
  { to: "/product", label: "Product" },
  { to: "/login", label: "Sign in" },
] as const;

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {navigationItems.map((item) => (
        <Link key={item.to} to={item.to} onClick={onNavigate}>
          {item.label}
        </Link>
      ))}
      <Link className="marketing-button marketing-button-primary" to="/signup" onClick={onNavigate}>
        Request access
      </Link>
    </>
  );
}

export function MarketingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstMobileLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (mobileOpen) {
      firstMobileLinkRef.current?.focus();
      return;
    }

    // Returning focus to the disclosure control makes the menu predictable for
    // keyboard users after Escape or selecting a mobile navigation link.
    if (document.activeElement?.closest(`#${mobileNavigationId}`)) {
      menuButtonRef.current?.focus();
    }
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileOpen(false);
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  return (
    <header className="marketing-header">
      <div className="marketing-container marketing-header-inner">
        <Link className="marketing-wordmark" to="/" aria-label="Axiom Orbit home">
          <img
            src="/brand/axiom-orbit-primary-transparent.png"
            alt="Axiom Orbit"
            width={182}
            height={56}
            loading="eager"
          />
        </Link>

        <nav className="marketing-desktop-nav" aria-label="Marketing navigation">
          <NavigationLinks />
        </nav>

        <button
          ref={menuButtonRef}
          type="button"
          className="marketing-menu-toggle"
          aria-expanded={mobileOpen}
          aria-controls={mobileNavigationId}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          onClick={() => setMobileOpen((open) => !open)}
        >
          <span aria-hidden="true">{mobileOpen ? "Close" : "Menu"}</span>
        </button>
      </div>

      <nav
        id={mobileNavigationId}
        className="marketing-mobile-nav"
        aria-label="Mobile navigation"
        hidden={!mobileOpen}
      >
        <div className="marketing-container marketing-mobile-nav-inner">
          <Link ref={firstMobileLinkRef} to="/product" onClick={() => setMobileOpen(false)}>
            Product
          </Link>
          <Link to="/login" onClick={() => setMobileOpen(false)}>
            Sign in
          </Link>
          <Link
            className="marketing-button marketing-button-primary"
            to="/signup"
            onClick={() => setMobileOpen(false)}
          >
            Request access
          </Link>
        </div>
      </nav>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-container marketing-footer-inner">
        <div className="marketing-footer-credit">
          <span>An Axiom product</span>
          <a className="marketing-footer-parent-link" href="https://getaxiom.ca">
            Axiom
          </a>
        </div>
        <nav aria-label="Footer navigation" className="marketing-footer-nav">
          <Link to="/product">Product</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/signup">Request access</Link>
          <Link to="/login">Sign in</Link>
        </nav>
      </div>
    </footer>
  );
}

/**
 * Scroll-reveal motion, applied only when JavaScript is running and the user
 * has not asked for reduced motion. Without either, elements stay visible:
 * the animation is progressive enhancement, never a content gate.
 */
function useScrollReveals() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.documentElement.classList.add("marketing-motion");

    const targets = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, []);
}

export function MarketingLayout({ children }: { children: ReactNode }) {
  useScrollReveals();
  return (
    <div className="marketing-page">
      {/*
        Opt into reveal motion before first paint so the page never flashes
        fully visible and then hides. Without JS, or with reduced motion, the
        class is never added and content simply renders.
      */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(()=>{try{if(!window.matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.classList.add("marketing-motion")}catch(e){}})()`,
        }}
      />
      <MarketingHeader />
      <main id="main-content" className="marketing-main">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
