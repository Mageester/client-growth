import { useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { Icon } from "./ui";

const stages = [
  { id: "finding", label: "The finding" },
  { id: "evidence", label: "The evidence" },
  { id: "proposal", label: "The proposal" },
] as const;

const initialScope = "Create a dedicated heat pump installation page covering the service, installation process, and common questions. Add a clear quote request and link the page from the services menu.";

/**
 * A deliberately local example of the real missing-service-page workflow.
 * Nothing is fetched, saved, or shared; reserved domains and explicit example
 * labels keep demonstration content separate from real customer evidence.
 */
export function HomepageDemo() {
  const [stage, setStage] = useState(0);
  const [scope, setScope] = useState(initialScope);
  const [preview, setPreview] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function goToStage(index: number) {
    setStage(index);
    tabs.current[index]?.focus({ preventScroll: true });
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    // Preserve browser shortcuts such as Ctrl+Home / Cmd+ArrowLeft.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = event.key === "ArrowRight" ? (index + 1) % stages.length
      : event.key === "ArrowLeft" ? (index + stages.length - 1) % stages.length
      : event.key === "Home" ? 0
      : event.key === "End" ? stages.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    goToStage(next);
  }

  return (
    <section className="home-demo" id="example" aria-labelledby="example-title" tabIndex={-1}>
      <header className="home-demo-header">
        <h2 id="example-title"><Icon name="target" size={16} /> A closer look at one opportunity</h2>
        <span>Illustrative example</span>
      </header>
      <div className="home-demo-tabs" role="tablist" aria-label="Explore an Orbit opportunity">
        {stages.map((item, index) => (
          <button
            key={item.id}
            ref={(element) => { tabs.current[index] = element; }}
            type="button"
            role="tab"
            id={`example-tab-${item.id}`}
            aria-controls={`example-panel-${item.id}`}
            aria-selected={stage === index}
            tabIndex={stage === index ? 0 : -1}
            onClick={() => setStage(index)}
            onKeyDown={(event) => handleTabKey(event, index)}
          >
            <span className="home-number" aria-hidden="true">0{index + 1}</span>{item.label}
          </button>
        ))}
      </div>
      <div className="home-demo-body">
        <aside className="home-demo-context" aria-label="Example client and agency context">
          <div className="home-client">
            <span className="home-client-mark" aria-hidden="true">N</span>
            <div><strong>Northstar HVAC</strong><span>northstarhvac.example</span></div>
          </div>
          <dl>
            <div className="home-client-offerings">
              <dt>Client offerings</dt>
              <dd>Heating<br />Maintenance<br /><span>Heat pump installation</span></dd>
            </div>
            <div><dt>Your service</dt><dd>Service landing page</dd></div>
            <div><dt>Contract coverage</dt><dd><span className="home-coverage"><Icon name="plus" size={13} /> Not included</span></dd></div>
          </dl>
        </aside>
        <div className="home-demo-panels">
          <div role="tabpanel" id="example-panel-finding" aria-labelledby="example-tab-finding" hidden={stage !== 0} tabIndex={0} className="home-demo-panel">
            <p className="home-demo-status"><span className="home-dot" /> Opportunity to review</p>
            <h3>They install heat pumps.<br /><span>Their website doesn’t tell the story.</span></h3>
            <p className="home-demo-description">Heat pump installation is a confirmed offering, but no dedicated page was found in the site review.</p>
            <ul className="home-page-list" aria-label="Example service page review">
              <li><Icon name="document" size={17} /><strong>Heating</strong><span className="home-source-path">/services/heating</span><span className="home-page-state"><Icon name="check" size={15} /> Page found</span></li>
              <li><Icon name="document" size={17} /><strong>Maintenance</strong><span className="home-source-path">/services/maintenance</span><span className="home-page-state"><Icon name="check" size={15} /> Page found</span></li>
              <li className="home-page-missing"><Icon name="plus" size={17} /><strong>Heat pump installation</strong><span className="home-page-state">No dedicated page found</span></li>
            </ul>
            <div className="home-demo-bottom">
              <div className="home-example-value"><span>Your catalog range</span><strong>$900–$1,800</strong></div>
              <button type="button" className="home-button" onClick={() => goToStage(1)}>Review the evidence <Icon name="arrow-right" size={16} /></button>
            </div>
            <p className="home-demo-footnote">Example pricing from an agency catalog. Potential work, not booked revenue.</p>
          </div>

          <div role="tabpanel" id="example-panel-evidence" aria-labelledby="example-tab-evidence" hidden={stage !== 1} tabIndex={0} className="home-demo-panel">
            <p className="home-demo-status"><Icon name="search" size={15} /> Evidence review</p>
            <h3>A finding you can trace.<br /><span>A decision you can stand behind.</span></h3>
            <p className="home-demo-description">Orbit checks the site in context before suggesting work. You can inspect the sources and decide whether to pursue it.</p>
            <ul className="home-evidence-list" aria-label="Illustrative evidence checks">
              <li><Icon name="check" size={17} /><div><strong>The service is confirmed</strong><p>Heat pump installation is recorded in the client’s offerings.</p></div></li>
              <li><Icon name="check" size={17} /><div><strong>The site was checked for a matching page</strong><p>Readable pages, navigation, discovered links, and sitemap URLs were reviewed. No dedicated page was found.</p></div></li>
              <li><Icon name="check" size={17} /><div><strong>The work fits your catalog, not their contract</strong><p>Mapped to Service landing page. No existing coverage recorded.</p></div></li>
            </ul>
            <div className="home-demo-bottom"><span className="home-review-note">Evidence first. Your judgment next.</span><button type="button" className="home-button" onClick={() => goToStage(2)}>Preview proposal <Icon name="arrow-right" size={16} /></button></div>
            <p className="home-demo-footnote">Illustrative evidence. An incomplete site read would stay inconclusive.</p>
          </div>

          <div role="tabpanel" id="example-panel-proposal" aria-labelledby="example-tab-proposal" hidden={stage !== 2} tabIndex={0} className="home-demo-panel">
            <p className="home-demo-status"><Icon name="document" size={15} /> {preview ? "Proposal preview" : "Editable proposal draft"}</p>
            <h3>Make the next conversation<br /><span>about something that matters.</span></h3>
            <p className="home-demo-description">Start from the finding, refine the scope, and decide what to put in front of your client.</p>
            <div className="home-proposal">
              <div className="home-proposal-heading"><div><span>Prepared for Northstar HVAC</span><strong>Heat pump installation page</strong></div><span>Draft</span></div>
              <label htmlFor="example-proposal-scope">Proposed scope <span>{preview ? "Preview" : "Try editing this"}</span></label>
              <textarea id="example-proposal-scope" aria-label="Proposed scope for example proposal" aria-describedby="example-draft-note" value={scope} onChange={(event) => setScope(event.target.value)} rows={3} hidden={preview} maxLength={1500} />
              {preview && <p className="home-proposal-preview">{scope.trim() || "Add a scope to describe the proposed work."}</p>}
              <div className="home-proposal-price"><span>Indicative range · your catalog</span><strong>$900–$1,800</strong></div>
            </div>
            <div className="home-demo-bottom"><span className="home-review-note" id="example-draft-note">Example only. Changes aren’t saved.</span><button type="button" className="home-button" aria-controls="example-proposal-scope" aria-pressed={preview} onClick={() => setPreview((value) => !value)}>{preview ? "Edit scope" : "Preview draft"}<Icon name={preview ? "pencil" : "arrow-right"} size={16} /></button></div>
            <p className="home-demo-footnote">In Orbit, review your draft, then create an expiring share link. <Link to="/product#act">See how sharing works <Icon name="arrow-up-right" size={12} /></Link></p>
          </div>
        </div>
      </div>
      <noscript><p className="home-demo-noscript">Enable JavaScript to explore the evidence and proposal steps, or <Link to="/product">read about the product</Link>.</p></noscript>
    </section>
  );
}
