import type { ReactNode } from "react";

import { MarketingLayout } from "./marketing-layout";

/**
 * Shared shell for the two legal pages.
 *
 * These documents describe what the software actually does — every claim in
 * them is traceable to code in this repository, and they should be corrected
 * whenever that code changes rather than left to drift into fiction. They have
 * NOT been reviewed by a lawyer; see docs/legal-review.md for what a review
 * needs to cover before this product takes a paying customer.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <MarketingLayout>
      <section className="marketing-section">
        <div className="marketing-container legal-doc">
          <h1>{title}</h1>
          <p className="legal-updated">Last updated {updated}</p>
          {children}
        </div>
      </section>
    </MarketingLayout>
  );
}
