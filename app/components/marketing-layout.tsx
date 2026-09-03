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
          <a href="https://getaxiom.ca">Axiom</a>
        </div>
        <nav aria-label="Footer navigation" className="marketing-footer-nav">
          <Link to="/product">Product</Link>
          <Link to="/signup">Request access</Link>
          <Link to="/login">Sign in</Link>
        </nav>
      </div>
    </footer>
  );
}

export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-page">
      <MarketingHeader />
      <main id="main-content" className="marketing-main">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
