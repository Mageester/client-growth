import { offeringWarnings, parseOfferings } from "../lib/validation";
import { Icon } from "./ui";

export type OfferingGuidanceProps = {
  /** The submitted textarea value. Use this for immediate edit-form feedback. */
  raw?: string;
  /** Already parsed offerings from a saved client. */
  offerings?: string[];
  /** Saved detail pages can rely on their existing quality card for this copy. */
  showWarnings?: boolean;
};

const EXAMPLES = ["heat pump installation", "air conditioning repair", "duct cleaning"];

/**
 * Advisory copy for the client-offerings field. It never changes the list or
 * prevents a save: a partial setup is useful for the rules that it can support,
 * while the service-page limitation is stated before an analysis starts.
 */
export function OfferingGuidance({ raw, offerings, showWarnings = true }: OfferingGuidanceProps) {
  const entries = (offerings ?? parseOfferings(raw ?? ""))
    .map((entry) => entry.trim())
    .filter(Boolean);
  const warnings = offeringWarnings(entries);

  return (
    <div className="offering-guidance" aria-live="polite">
      <div className="field-hint offering-examples">
        Examples: {EXAMPLES.join(" · ")}. Use the work customers actually hire or pay for, one
        offering per line.
      </div>

      {entries.length < 2 && (
        <div className="notice offering-count-notice" role="status">
          <Icon name="alert" size={14} />
          <span>
            {entries.length === 0
              ? "No offerings are listed yet. This setup can still be saved, but analysis cannot claim a missing service page until at least two concrete offerings are confirmed."
              : "One offering is listed. This setup can still be saved, but analysis cannot claim a missing service page until at least two concrete offerings are confirmed."}
          </span>
        </div>
      )}

      {showWarnings && warnings.length > 0 && (
        <div className="notice warn offering-guidance-warning" role="status">
          <Icon name="alert" size={14} />
          <div>
            <span>
              {warnings.map((warning) => `“${warning.value}”`).join(", ")} {warnings.length === 1 ? "looks" : "look"} like
              a claim about the business rather than work customers buy. Nothing is changed
              automatically; review it before saving or analyzing.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
