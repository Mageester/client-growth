import { useCallback, useEffect, useRef, useState } from "react";

import { Icon, type IconName } from "./ui";

/**
 * The product tour.
 *
 * Onboarding sets a workspace up; this explains what the agency is then looking
 * at. The two are deliberately separate — a form that must be filled in is a
 * different thing from an explanation that can be skipped, and merging them
 * would make the explanation compulsory.
 *
 * It is a native <dialog>, so focus trapping, Escape, background inerting and
 * the backdrop are the browser's rather than ours.
 */

const TOUR_STORAGE_KEY = "axiom-orbit-tour-seen";

/** Bumping this shows the tour again to people who saw an older one. */
const TOUR_VERSION = "1";

export interface TourStep {
  icon: IconName;
  title: string;
  body: string[];
  /** Nav item to mark while this step is showing, matched on href. */
  highlight?: string;
}

/**
 * What an agency actually needs to know to trust the output. The honesty steps
 * are not filler: the product's whole claim is that it will say "I could not
 * tell" instead of guessing, and someone who does not know that will read an
 * empty feed as a broken product.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    icon: "signal",
    title: "What Axiom Orbit does",
    body: [
      "It reads the websites of clients you already look after, compares each site against what that business actually sells, and surfaces work you could legitimately bill for.",
      "Everything it raises comes with the website evidence it was based on. Review the sources and commercial fit before taking it into a client conversation.",
    ],
  },
  {
    icon: "inbox",
    title: "Opportunities is the working screen",
    body: [
      "Findings across your whole portfolio: the work you could sell first, with site-health checks kept underneath it. Once you start marking findings sold, the order follows what you actually sell. Select one to see the case for it: what was found, why it matters to that client, and what the job would be.",
      "This is the day-to-day working screen. Clients holds account context, while Settings holds your services, monitoring, team, and workspace controls.",
    ],
    highlight: "/opportunities",
  },
  {
    icon: "shield",
    title: "Nothing is claimed without evidence",
    body: [
      "Every finding shows what was checked, when it was checked, and which sources support it. Review that evidence before you decide the work is useful and billable.",
      "If the evidence is thin, the finding says so rather than rounding up.",
    ],
  },
  {
    icon: "alert",
    title: "“Clean” and “couldn't read” are different answers",
    body: [
      "A site that was read properly and has nothing billable is reported as clean. A site the crawler could not get through is reported as inconclusive, and never as clean.",
      "That distinction is the point. An empty feed means there was genuinely nothing to sell, not that something failed quietly.",
    ],
  },
  {
    icon: "users",
    title: "Clients: the site, and what they sell",
    body: [
      "Add the domain and what customers actually hire that business for — one per line. That list is what every analysis compares the website against.",
      "Be specific and use their words. “Emergency boiler repair” finds work; “fully insured” does not, because it is a claim rather than something a customer buys.",
    ],
    highlight: "/clients",
  },
  {
    icon: "briefcase",
    title: "Services: your prices, your catalogue",
    body: [
      "Every finding is priced from a service you sell, and each service says which kind of website gap it answers. The catalogue lives under Settings.",
      "If nothing in your catalogue answers a given gap, that gap is never raised — the product will not surface work you have no way to deliver or price.",
    ],
    highlight: "/settings",
  },
  {
    icon: "refresh",
    title: "Monitoring watches for changes",
    body: [
      "Turn it on per client and Axiom Orbit re-checks their site on a schedule, reporting what changed since last time: new findings, and ones the client has since fixed.",
      "A finding is only marked resolved by a run that demonstrably looked again and no longer sees it.",
    ],
  },
];

function readSeen(): boolean {
  try {
    return window.localStorage?.getItem(TOUR_STORAGE_KEY) === TOUR_VERSION;
  } catch {
    // Storage can be disabled outright. Treat that as "already seen" so the
    // tour cannot reappear on every single page load.
    return true;
  }
}

function markSeen() {
  try {
    window.localStorage?.setItem(TOUR_STORAGE_KEY, TOUR_VERSION);
  } catch {
    // Nothing to fall back to; the tour is optional either way.
  }
}

/**
 * Whether to offer the tour, and how to start or finish it.
 *
 * The first render always reports closed so the server and client markup agree;
 * the stored value is only read once mounted.
 */
export function useProductTour() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!readSeen()) setOpen(true);
  }, []);

  const start = useCallback(() => setOpen(true), []);
  const finish = useCallback(() => {
    markSeen();
    setOpen(false);
  }, []);

  return { open, start, finish };
}

export function ProductTour({ open, onFinish }: { open: boolean; onFinish: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setIndex(0);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Escape and the backdrop close the dialog without going through the button,
  // so the "seen" flag is written from the dialog's own close event.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onClose = () => onFinish();
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [onFinish]);

  // Mark the nav item the current step is about, so the tour points at the real
  // interface rather than describing it in isolation.
  const highlight = TOUR_STEPS[index]?.highlight;
  useEffect(() => {
    if (!open) return;
    const marked = highlight
      ? document.querySelector<HTMLElement>(`.app-nav a[href="${highlight}"]`)
      : null;
    marked?.classList.add("is-tour-target");
    return () => marked?.classList.remove("is-tour-target");
  }, [open, highlight]);

  const step = TOUR_STEPS[index];
  if (!step) return null;

  const last = index === TOUR_STEPS.length - 1;

  return (
    <dialog className="tour" ref={ref} aria-labelledby="tour-title">
      <div className="tour-body">
        <p className="eyebrow">
          Guided tour · {index + 1} of {TOUR_STEPS.length}
        </p>

        <h2 className="tour-title" id="tour-title">
          <Icon name={step.icon} size={18} />
          {step.title}
        </h2>

        {step.body.map((paragraph) => (
          <p className="tour-para" key={paragraph.slice(0, 32)}>
            {paragraph}
          </p>
        ))}
      </div>

      <ol className="tour-dots" aria-hidden="true">
        {TOUR_STEPS.map((s, i) => (
          <li key={s.title} className={i === index ? "on" : undefined} />
        ))}
      </ol>

      <div className="tour-actions">
        <button className="btn btn-quiet" type="button" onClick={() => ref.current?.close()}>
          {last ? "Close" : "Skip tour"}
        </button>
        <div className="tour-actions-end">
          {index > 0 && (
            <button className="btn" type="button" onClick={() => setIndex(index - 1)}>
              Back
            </button>
          )}
          {last ? (
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => ref.current?.close()}
            >
              Start working
            </button>
          ) : (
            <button className="btn btn-primary" type="button" onClick={() => setIndex(index + 1)}>
              Next
              <Icon name="arrow-right" size={15} />
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
