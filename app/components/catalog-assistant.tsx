import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";

import type { AgencyCatalogDraftItem } from "@/ports/AgencyCatalogGenerator";
import { Icon } from "./ui";

type DraftResponse =
  | { ok: true; kind: "catalog-draft"; drafts: AgencyCatalogDraftItem[]; pageCount: number; sourceCount: number }
  | { ok: false; kind: "catalog-draft"; error: string }
  | { ok: true; kind: "catalog-save"; message: string }
  | { ok: false; kind: "catalog-save"; error: string };

type ReviewRow = AgencyCatalogDraftItem & {
  selected: boolean;
  priceMin: string;
  priceMax: string;
};

export function reviewRowsAreValid(
  rows: Array<Pick<ReviewRow, "selected" | "name" | "description" | "priceMin" | "priceMax">>,
): boolean {
  const selected = rows.filter((row) => row.selected);
  return selected.length > 0 && selected.every((row) => {
    if (row.priceMin === "" || row.priceMax === "") return false;
    const min = Number(row.priceMin);
    const max = Number(row.priceMax);
    return row.name.trim().length >= 2 && row.description.trim().length >= 10 && min >= 0 && max >= min;
  });
}

export function CatalogAssistant({
  deferSave = false,
  onCatalogChange,
}: {
  deferSave?: boolean;
  onCatalogChange?: (catalog: string) => void;
} = {}) {
  const fetcher = useFetcher<DraftResponse>();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [bulkMin, setBulkMin] = useState("");
  const [bulkMax, setBulkMax] = useState("");
  const [website, setWebsite] = useState("");
  const [summary, setSummary] = useState("");
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.kind === "catalog-draft") {
      setRows(fetcher.data.drafts.map((draft) => ({ ...draft, selected: true, priceMin: "", priceMax: "" })));
    }
    if (fetcher.data?.ok && fetcher.data.kind === "catalog-save") setRows([]);
  }, [fetcher.data]);

  const selected = rows.filter((row) => row.selected);
  const valid = useMemo(() => reviewRowsAreValid(rows), [rows]);
  const catalog = JSON.stringify(selected.map((row) => ({
    name: row.name.trim(),
    description: row.description.trim(),
    priceMin: Number(row.priceMin),
    priceMax: Number(row.priceMax),
  })));

  useEffect(() => {
    onCatalogChange?.(valid ? catalog : "");
  }, [catalog, onCatalogChange, valid]);

  const patchRow = (index: number, patch: Partial<ReviewRow>) =>
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));

  const applyBulkPrice = () => {
    if (bulkMin === "" || bulkMax === "" || Number(bulkMax) < Number(bulkMin)) return;
    setRows((current) => current.map((row) => row.selected ? { ...row, priceMin: bulkMin, priceMax: bulkMax } : row));
  };

  return (
    <section className="catalog-assistant" aria-labelledby="catalog-assistant-title">
      <div className="catalog-assistant-head">
        <div>
          <span className="eyebrow">AI catalog assistant</span>
          <h3 id="catalog-assistant-title">Turn what your agency does into a reviewable catalog</h3>
          <p>Give Orbit your website, a plain-language summary, or both. Nothing is saved until you review names, descriptions, and prices.</p>
        </div>
        <Icon name="briefcase" size={20} />
      </div>

      <div className="catalog-assistant-inputs">
        <div className="field">
          <label htmlFor="agency-catalog-website">Agency website</label>
          <input id="agency-catalog-website" name="website" type="url" placeholder="https://youragency.com" value={website} onChange={(event) => setWebsite(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="agency-catalog-summary">Or describe what you sell</label>
          <textarea id="agency-catalog-summary" name="summary" rows={3} placeholder="We design conversion websites, build local SEO campaigns, and manage paid search…" value={summary} onChange={(event) => setSummary(event.target.value)} />
        </div>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => fetcher.submit({ intent: "generate-catalog", website, summary }, { method: "post" })}>
          <Icon name="briefcase" size={15} /> {busy ? "Building draft…" : "Build my service catalog"}
        </button>
      </div>

      {fetcher.data && !fetcher.data.ok && <div className="notice err" role="alert"><Icon name="alert" size={15} /><span>{fetcher.data.error}</span></div>}
      {fetcher.data?.ok && fetcher.data.kind === "catalog-save" && <div className="notice ok" role="status"><Icon name="check" size={15} /><span>{fetcher.data.message}</span></div>}

      {rows.length > 0 && (
        <div className="catalog-review">
          <div className="catalog-review-summary">
            <b>Review {rows.length} suggested services</b>
            <span>{fetcher.data?.ok && fetcher.data.kind === "catalog-draft" ? `${fetcher.data.pageCount} pages read · ${fetcher.data.sourceCount} cited sources` : ""}</span>
          </div>
          <div className="catalog-bulk-price">
            <span>Apply a usual range to selected rows</span>
            <input aria-label="Bulk minimum price" type="number" min="0" placeholder="From" value={bulkMin} onChange={(event) => setBulkMin(event.target.value)} />
            <input aria-label="Bulk maximum price" type="number" min="0" placeholder="Up to" value={bulkMax} onChange={(event) => setBulkMax(event.target.value)} />
            <button className="btn" type="button" onClick={applyBulkPrice}>Apply</button>
          </div>
          <ul className="catalog-review-list">
            {rows.map((row, index) => (
              <li key={`${row.name}-${index}`} className={row.selected ? "" : "is-off"}>
                <label className="catalog-review-select"><input type="checkbox" checked={row.selected} onChange={(event) => patchRow(index, { selected: event.target.checked })} /><span>Include</span></label>
                <input aria-label={`Service ${index + 1} name`} value={row.name} onChange={(event) => patchRow(index, { name: event.target.value })} />
                <textarea aria-label={`Service ${index + 1} description`} rows={2} value={row.description} onChange={(event) => patchRow(index, { description: event.target.value })} />
                <div className="field-row">
                  <input aria-label={`${row.name} minimum price`} type="number" min="0" placeholder="From" value={row.priceMin} onChange={(event) => patchRow(index, { priceMin: event.target.value })} />
                  <input aria-label={`${row.name} maximum price`} type="number" min="0" placeholder="Up to" value={row.priceMax} onChange={(event) => patchRow(index, { priceMax: event.target.value })} />
                </div>
                <div className="catalog-sources">
                  {row.sourceKind === "summary" ? <span>From your summary</span> : row.sourceUrls.map((url) => <a href={url} target="_blank" rel="noreferrer" key={url}>{new URL(url).hostname}</a>)}
                </div>
              </li>
            ))}
          </ul>
          {deferSave ? (
            <div className="notice ok" role="status"><Icon name="check" size={15} /><span>{valid ? `${selected.length} reviewed services will replace the starter catalog when you continue.` : "Add a valid price range to every selected service to use this catalog."}</span></div>
          ) : <fetcher.Form method="post" className="form-actions">
            <input type="hidden" name="intent" value="save-generated-catalog" />
            <input type="hidden" name="catalog" value={catalog} />
            <button className="btn btn-primary" type="submit" disabled={busy || !valid}>{busy ? "Saving…" : `Save ${selected.length} selected services`}</button>
            <button className="btn btn-ghost" type="button" onClick={() => setRows([])}>Discard draft</button>
          </fetcher.Form>}
        </div>
      )}
      <p className="field-hint catalog-manual-hint">Prefer full control? The manual <b>New service</b> form stays available.</p>
    </section>
  );
}
