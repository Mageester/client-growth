import { useState } from "react";
import { Form, Link, redirect } from "react-router";

import {
  buildClientReportSnapshot,
  buildReportCandidates,
  ClientReportValidationError,
  type ReportCandidate,
  type ReportCandidates,
} from "@/core/clientReport";
import { reportThemeOption } from "@/core/reportTheme";
import { createClientReport, isClientReportError } from "@/db/clientReports";
import { getWorkspaceBranding } from "@/db/proposalShares";
import * as repo from "@/db/repositories";
import { ClientReportDocument } from "../components/client-report";
import { Icon } from "../components/ui";
import { requireTenant } from "../lib/session.server";
import type { Route } from "./+types/clients.$id.report";

const MAX_AGENCY_NOTE = 1_200;
const MAX_NEXT_STEP_NOTE = 800;

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `Create report · ${data.client.name}` : "Create client report" }];
}

async function loadReportInputs(t: Awaited<ReturnType<typeof requireTenant>>, clientId: string) {
  const client = await repo.getClient(t.scope, clientId);
  if (!client) throw new Response("Client not found", { status: 404 });
  const [services, opportunities, latestRun, branding] = await Promise.all([
    repo.listServices(t.scope),
    repo.listOpportunities(t.scope, client.id),
    repo.getLatestAnalysisRun(t.scope, client.id),
    getWorkspaceBranding(t.scope),
  ]);
  const candidates = buildReportCandidates({
    client,
    opportunities,
    serviceNameById: Object.fromEntries(services.map((service) => [service.id, service.name])),
    latestRun: latestRun
      ? {
          outcome: latestRun.outcome,
          finishedAt: latestRun.finishedAt,
          limitation: latestRun.limitation,
        }
      : null,
  });
  return { client, candidates, branding, latestRun };
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  const inputs = await loadReportInputs(t, params.id);
  return {
    client: inputs.client,
    candidates: inputs.candidates,
    branding: inputs.branding,
    agencyName: t.workspace.name,
    preparedBy: t.user.name.trim() || t.user.email,
    previewGeneratedAt: new Date().toISOString(),
  };
}

function textField(form: FormData, name: string, max: number): { value: string; error?: string } {
  const value = String(form.get(name) ?? "").trim();
  return value.length > max
    ? { value, error: `Keep ${name === "agencyNote" ? "the agency note" : "the next-step note"} under ${max.toLocaleString()} characters.` }
    : { value };
}

function parsePackageInputs(
  form: FormData,
  selectedKeys: readonly string[],
  candidates: ReportCandidates,
):
  | { ok: true; prices: Record<string, number>; confirmedKeys: string[] }
  | { ok: false; error: string } {
  const prices: Record<string, number> = {};
  const confirmedKeys: string[] = [];
  const commercialKeys = new Set(candidates.commercial.map((candidate) => candidate.key));
  for (const key of selectedKeys) {
    if (!commercialKeys.has(key)) continue;
    const raw = String(form.get(`packagePrice:${key}`) ?? "").trim();
    if (!raw) continue;
    const amount = Number(raw.replace(/[$,]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "Enter a package price greater than zero, or leave it blank." };
    }
    if (form.get(`confirmPackagePrice:${key}`) !== "on") {
      return { ok: false, error: "Confirm each package price before it can appear in the report." };
    }
    prices[key] = amount;
    confirmedKeys.push(key);
  }
  return { ok: true, prices, confirmedKeys };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const inputs = await loadReportInputs(t, params.id);
  const form = await request.formData();
  if (String(form.get("intent") ?? "") !== "generate") {
    throw new Response("Unknown action", { status: 400 });
  }

  const selectedKeys = form.getAll("selectedProject").map(String);
  const orderedKeys = form.getAll("orderedProject").map(String);
  const packageInputs = parsePackageInputs(form, selectedKeys, inputs.candidates);
  if (!packageInputs.ok) return { ok: false as const, error: packageInputs.error };
  const agencyNote = textField(form, "agencyNote", MAX_AGENCY_NOTE);
  if (agencyNote.error) return { ok: false as const, error: agencyNote.error };
  const nextStepNote = textField(form, "nextStepNote", MAX_NEXT_STEP_NOTE);
  if (nextStepNote.error) return { ok: false as const, error: nextStepNote.error };

  try {
    const snapshot = buildClientReportSnapshot({
      workspaceId: t.scope.workspaceId,
      createdByUserId: t.userId,
      client: inputs.client,
      agency: { name: t.workspace.name, logo: inputs.branding.logo, theme: inputs.branding.reportTheme },
      preparedBy: t.user.name.trim() || t.user.email,
      generatedAt: new Date().toISOString(),
      evidenceReviewedAt: inputs.candidates.evidenceReviewedAt,
      candidates: inputs.candidates,
      selection: {
        selectedKeys,
        orderedKeys,
        showUnderlyingValue: form.get("showUnderlyingValue") === "on",
        packagePrices: packageInputs.prices,
        confirmedPackagePriceKeys: packageInputs.confirmedKeys,
        agencyNote: agencyNote.value,
        nextStepNote: nextStepNote.value,
      },
    });
    const report = await createClientReport(t.scope, {
      clientId: inputs.client.id,
      createdByUserId: t.userId,
      snapshot,
    });
    throw redirect(`/reports/${encodeURIComponent(report.reportId)}`);
  } catch (error) {
    if (error instanceof ClientReportValidationError || isClientReportError(error)) {
      return { ok: false as const, error: error.message };
    }
    throw error;
  }
}

function candidateLabel(candidate: ReportCandidate): string {
  return candidate.category === "health" ? "Supporting website improvement" : "Recommended project";
}

function CandidateChoice({
  candidate,
  selected,
  canMoveUp,
  canMoveDown,
  onToggle,
  onMove,
  packagePrice,
  packageConfirmed,
  onPackagePrice,
  onPackageConfirmed,
}: {
  candidate: ReportCandidate;
  selected: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: (checked: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  packagePrice: string;
  packageConfirmed: boolean;
  onPackagePrice: (value: string) => void;
  onPackageConfirmed: (checked: boolean) => void;
}) {
  return (
    <article className={`report-builder-choice${selected ? " is-selected" : ""}`}>
      <label className="report-builder-choice-main">
        <span className="report-builder-check">
          <input type="checkbox" checked={selected} onChange={(event) => onToggle(event.target.checked)} />
          <span aria-hidden="true" />
        </span>
        <span>
          <span className="report-builder-choice-kind">{candidateLabel(candidate)}</span>
          <strong>{candidate.project.title}</strong>
          <small>{candidate.project.summary}</small>
        </span>
      </label>
      {selected && (
        <div className="report-builder-choice-controls">
          <div className="report-builder-order-controls" aria-label={`Order ${candidate.project.title}`}>
            <span>Order</span>
            <button type="button" className="btn btn-quiet btn-sm" disabled={!canMoveUp} onClick={() => onMove(-1)} aria-label={`Move ${candidate.project.title} up`}>↑</button>
            <button type="button" className="btn btn-quiet btn-sm" disabled={!canMoveDown} onClick={() => onMove(1)} aria-label={`Move ${candidate.project.title} down`}>↓</button>
          </div>
          {candidate.category === "commercial" && (
            <div className="report-builder-package-price">
              <label>
                <span>Package price (optional)</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="decimal"
                  name={`packagePrice:${candidate.key}`}
                  value={packagePrice}
                  onChange={(event) => onPackagePrice(event.target.value)}
                  placeholder="To be confirmed"
                />
              </label>
              <label className="report-builder-confirm-price">
                <input
                  type="checkbox"
                  name={`confirmPackagePrice:${candidate.key}`}
                  checked={packageConfirmed}
                  onChange={(event) => onPackageConfirmed(event.target.checked)}
                />
                <span>I confirm this price</span>
              </label>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function ClientReportBuilder({ loaderData, actionData }: Route.ComponentProps) {
  const { client, candidates, branding, agencyName, preparedBy, previewGeneratedAt } = loaderData;
  const allCandidates = [...candidates.commercial, ...candidates.health];
  const byKey = new Map(allCandidates.map((candidate) => [candidate.key, candidate]));
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() => [...candidates.defaultSelectedKeys]);
  const [orderedKeys, setOrderedKeys] = useState<string[]>(() => [...candidates.defaultSelectedKeys]);
  const [showUnderlyingValue, setShowUnderlyingValue] = useState(false);
  const [agencyNote, setAgencyNote] = useState("");
  const [nextStepNote, setNextStepNote] = useState("");
  const [packagePrices, setPackagePrices] = useState<Record<string, string>>({});
  const [confirmedPrices, setConfirmedPrices] = useState<Record<string, boolean>>({});

  const toggle = (key: string, checked: boolean) => {
    setSelectedKeys((current) => checked ? [...current, key] : current.filter((item) => item !== key));
    setOrderedKeys((current) => checked ? [...current, key] : current.filter((item) => item !== key));
  };

  const move = (key: string, direction: -1 | 1) => {
    setOrderedKeys((current) => {
      const index = current.indexOf(key);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next;
    });
  };

  const selected = orderedKeys.map((key) => byKey.get(key)).filter((candidate): candidate is ReportCandidate => Boolean(candidate));
  const preview = (() => {
    if (selected.length === 0) return null;
    try {
      return buildClientReportSnapshot({
          workspaceId: "preview",
          createdByUserId: "preview",
          client,
          agency: { name: agencyName, logo: branding.logo, theme: branding.reportTheme },
          preparedBy,
          generatedAt: previewGeneratedAt,
          evidenceReviewedAt: candidates.evidenceReviewedAt,
          candidates,
          selection: {
            selectedKeys,
            orderedKeys,
            showUnderlyingValue,
            packagePrices: Object.fromEntries(
              Object.entries(packagePrices).map(([key, value]) => [key, Number(value)]),
            ),
            confirmedPackagePriceKeys: Object.entries(confirmedPrices)
              .filter(([, confirmed]) => confirmed)
              .map(([key]) => key),
            agencyNote,
            nextStepNote,
          },
        }).public;
    } catch {
      // A partially entered price is still a draft; keep the preview useful
      // while the submit path returns the precise validation message.
      return null;
    }
  })();

  return (
    <div className="client-report-builder-page">
      <div className="report-builder-topbar">
        <Link className="backlink" to={`/clients/${encodeURIComponent(client.id)}`}>
          <Icon name="arrow-left" size={14} />
          {client.name}
        </Link>
        <span className="client-report-builder-status">Draft report · private until shared</span>
      </div>
      <header className="report-builder-heading">
        <div className="report-builder-heading-copy">
          <span className="eyebrow">Client report · {client.name}</span>
          <h1>Create a client report</h1>
          <p>Turn the verified priorities you choose into a clear conversation starter for your client.</p>
        </div>
        <div className="report-builder-progress" aria-label="Report workflow">
          <span className="report-builder-progress-step is-current">1</span>
          <span>Choose priorities</span>
          <span className="report-builder-progress-line" aria-hidden="true" />
          <span className="report-builder-progress-step">2</span>
          <span>Review &amp; share</span>
        </div>
      </header>
      <div className="client-report-builder-grid">
        <section className="report-builder-controls" aria-label="Report builder">
          <div className="report-builder-controls-head">
            <div>
              <h2>Choose what to discuss</h2>
              <p>Start with the strongest commercial priorities. Site-health work stays separate for later.</p>
            </div>
            <span className="report-builder-selection-count">{selected.length} selected</span>
          </div>
          <div className="report-builder-style-summary">
            <div>
              <span className="report-builder-style-kicker">Report style</span>
              <strong>{reportThemeOption(branding.reportTheme).label}</strong>
              <small>{reportThemeOption(branding.reportTheme).description}</small>
            </div>
            <Link to="/settings#general" className="btn btn-quiet btn-sm">Change style</Link>
          </div>

          {actionData && !actionData.ok && (
            <div className="notice err" role="alert"><Icon name="alert" size={15} />{actionData.error}</div>
          )}
          {!candidates.canGenerate && (
            <div className="notice" role="status">
              <Icon name="clock" size={15} />
              <span>{candidates.limitations[0] ?? "No verified opportunities are ready for a client report yet."}</span>
            </div>
          )}

          <Form method="post" className="report-builder-form">
            <input type="hidden" name="intent" value="generate" />
            {selectedKeys.map((key) => <input key={`selected-${key}`} type="hidden" name="selectedProject" value={key} />)}
            {orderedKeys.map((key) => <input key={`ordered-${key}`} type="hidden" name="orderedProject" value={key} />)}

            <fieldset className="report-builder-fieldset">
              <legend>Recommended projects</legend>
              <p className="report-builder-help">The strongest active commercial work is preselected. Include only what you want in the conversation.</p>
              <div className="report-builder-choice-list">
                {candidates.commercial.length > 0 ? candidates.commercial.map((candidate) => (
                  <CandidateChoice
                    key={candidate.key}
                    candidate={candidate}
                    selected={selectedKeys.includes(candidate.key)}
                    canMoveUp={orderedKeys.indexOf(candidate.key) > 0}
                    canMoveDown={orderedKeys.indexOf(candidate.key) >= 0 && orderedKeys.indexOf(candidate.key) < orderedKeys.length - 1}
                    onToggle={(checked) => toggle(candidate.key, checked)}
                    onMove={(direction) => move(candidate.key, direction)}
                    packagePrice={packagePrices[candidate.key] ?? ""}
                    packageConfirmed={confirmedPrices[candidate.key] ?? false}
                    onPackagePrice={(value) => setPackagePrices((current) => ({ ...current, [candidate.key]: value }))}
                    onPackageConfirmed={(checked) => setConfirmedPrices((current) => ({ ...current, [candidate.key]: checked }))}
                  />
                )) : <p className="report-builder-muted">No active commercial projects are ready.</p>}
              </div>
            </fieldset>

            {candidates.health.length > 0 && (
              <fieldset className="report-builder-fieldset report-builder-supporting-fieldset">
                <legend>Supporting website improvements</legend>
                <p className="report-builder-help">Available separately so site upkeep supports the main recommendation without competing with it.</p>
                <div className="report-builder-choice-list">
                  {candidates.health.map((candidate) => (
                    <CandidateChoice
                      key={candidate.key}
                      candidate={candidate}
                      selected={selectedKeys.includes(candidate.key)}
                      canMoveUp={orderedKeys.indexOf(candidate.key) > 0}
                      canMoveDown={orderedKeys.indexOf(candidate.key) >= 0 && orderedKeys.indexOf(candidate.key) < orderedKeys.length - 1}
                      onToggle={(checked) => toggle(candidate.key, checked)}
                      onMove={(direction) => move(candidate.key, direction)}
                      packagePrice={packagePrices[candidate.key] ?? ""}
                      packageConfirmed={confirmedPrices[candidate.key] ?? false}
                      onPackagePrice={(value) => setPackagePrices((current) => ({ ...current, [candidate.key]: value }))}
                      onPackageConfirmed={(checked) => setConfirmedPrices((current) => ({ ...current, [candidate.key]: checked }))}
                    />
                  ))}
                </div>
              </fieldset>
            )}

            <label className="report-builder-toggle">
              <input type="checkbox" name="showUnderlyingValue" checked={showUnderlyingValue} onChange={(event) => setShowUnderlyingValue(event.target.checked)} />
              <span>
                <strong>Show underlying opportunity value</strong>
                <small>Shows the sum of the included existing service ranges. It is not a package quote.</small>
              </span>
            </label>

            <label className="report-builder-textarea">
              <span>Optional agency note</span>
              <textarea name="agencyNote" value={agencyNote} onChange={(event) => setAgencyNote(event.target.value)} rows={4} maxLength={MAX_AGENCY_NOTE} placeholder="Add the context you want to say in the room." />
            </label>
            <label className="report-builder-textarea">
              <span>Optional next-step text</span>
              <textarea name="nextStepNote" value={nextStepNote} onChange={(event) => setNextStepNote(event.target.value)} rows={3} maxLength={MAX_NEXT_STEP_NOTE} placeholder="Review priorities, confirm scope and decide what to do next." />
            </label>

            <div className="report-builder-form-actions">
              <button type="submit" className="btn btn-primary" disabled={!candidates.canGenerate || selectedKeys.length === 0}>
                Generate report
                <Icon name="arrow-right" size={14} />
              </button>
              <span>Sharing is a separate owner-only step after review.</span>
            </div>
          </Form>
        </section>

        <section className="client-report-builder-preview" aria-label="Report preview">
          <div className="report-builder-preview-label"><span className="eyebrow">Preview</span><span>Client-facing document</span></div>
          {preview ? (
            <ClientReportDocument snapshot={preview} />
          ) : (
            <div className="report-builder-empty-preview">
              <Icon name="document" size={24} />
              <h2>Select a project to preview the report.</h2>
              <p>The client-facing layout will appear here before anything is saved or shared.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export type { ReportCandidates };
