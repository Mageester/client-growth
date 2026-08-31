import { describe, expect, it } from "vitest";

import {
  classifyConversionLink,
  isPlaceholderTarget,
  telDefect,
} from "@/core/conversionIntent";

describe("classifyConversionLink", () => {
  it("recognises tight quote / book / contact phrases", () => {
    expect(classifyConversionLink({ href: "/x", label: "Get a Free Estimate" })).toBe("quote");
    expect(classifyConversionLink({ href: "/x", label: "Request a Quote" })).toBe("quote");
    expect(classifyConversionLink({ href: "/x", label: "Book Online" })).toBe("book");
    expect(classifyConversionLink({ href: "/x", label: "Schedule Service" })).toBe("book");
    expect(classifyConversionLink({ href: "/x", label: "Request Service" })).toBe("book");
    expect(classifyConversionLink({ href: "/x", label: "Contact Us" })).toBe("contact");
    expect(classifyConversionLink({ href: "/x", ariaLabel: "Call us now" })).toBe("call");
  });

  it("falls back to href hints when the label is an icon", () => {
    expect(classifyConversionLink({ href: "/free-estimate", label: "" })).toBe("quote");
    expect(classifyConversionLink({ href: "/contact-us/", label: "" })).toBe("contact");
    expect(classifyConversionLink({ href: "/book-online", label: "" })).toBe("book");
  });

  it("does not classify non-CTA links", () => {
    expect(classifyConversionLink({ href: "/about", label: "Our Story" })).toBeNull();
    expect(classifyConversionLink({ href: "/blog/how-to-schedule-a-tune-up", label: "How to schedule a tune-up: a homeowner's guide to seasonal HVAC maintenance" })).toBeNull();
    expect(classifyConversionLink({ href: "/careers", label: "Careers" })).toBeNull();
  });
});

describe("telDefect", () => {
  it("flags provably malformed tel values", () => {
    expect(telDefect("tel:000-0000")).toBe("malformed");
    expect(telDefect("tel:XXX-XXX-XXXX")).toBe("malformed");
    expect(telDefect("tel:call-us")).toBe("malformed");
    expect(telDefect("tel:")).toBe("malformed");
    expect(telDefect("tel:123-4567")).toBe("malformed"); // sequential
    expect(telDefect("tel:5555555555")).toBe("malformed"); // repeated
    expect(telDefect("tel:(303) 555-0148")).toBe("malformed"); // 555-01xx fiction block
    expect(telDefect("tel:12345")).toBe("malformed"); // too short
  });

  it("passes real-looking numbers", () => {
    expect(telDefect("tel:+1-555-867-5309")).toBe("ok");
    expect(telDefect("tel:(303) 555-7890")).toBe("ok");
    expect(telDefect("tel:+442071838750")).toBe("ok");
    expect(telDefect("tel:3035557890")).toBe("ok");
  });

  it("is conservative about odd URI formats", () => {
    expect(telDefect("tel:555;ext=12")).toBe("inconclusive");
    expect(telDefect("tel:+13035557890;ext=101")).toBe("ok");
  });
});

describe("isPlaceholderTarget", () => {
  it("detects obvious placeholder / default targets", () => {
    expect(isPlaceholderTarget("https://booking.example.com/YOUR-CALENDAR-ID")).toBe(true);
    expect(isPlaceholderTarget("https://calendly.com/your-booking-link")).toBe(true);
    expect(isPlaceholderTarget("https://formspree.io/f/xxxx")).toBe(true);
    expect(isPlaceholderTarget("/wp-content/YOUR_ENDPOINT")).toBe(true);
    expect(isPlaceholderTarget("http://localhost:3000/submit")).toBe(true);
    expect(isPlaceholderTarget("/{{form_action}}")).toBe(true);
  });

  it("does not flag real targets", () => {
    expect(isPlaceholderTarget("https://app.housecallpro.com/schedule/abc123")).toBe(false);
    expect(isPlaceholderTarget("/contact/submit")).toBe(false);
    expect(isPlaceholderTarget("https://calendly.com/acme-hvac/estimate")).toBe(false);
  });
});
