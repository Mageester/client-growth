# AI Agency Catalog Design

## Outcome

An agency owner can describe their agency, provide its website, or provide both and receive a complete, editable draft of the services the agency sells. They review the draft once, add pricing, and explicitly save it. The existing manual service editor remains available.

## Product principles

- AI proposes; a person confirms. Generation never writes services.
- A website-derived service must cite one or more pages that were actually read.
- Website text is untrusted evidence, never instructions to the model.
- Prices are never invented. A generated service begins without a price unless an agency owner supplies one in the review UI.
- One bulk price range can be applied to all selected draft rows to avoid repetitive typing.
- Existing services are preserved. Equivalent generated rows are omitted from the draft.
- All generated rows are validated again when saved. Rule tags are calculated deterministically from the final edited name and description.
- The feature makes one bounded provider call per generation request, has workspace and platform daily limits, and does not retry paid calls automatically.
- Provider, crawl, malformed-output, and persistence failures fail closed and leave the catalog unchanged.

## User experience

The Services page gains a primary `Build catalog with AI` action beside `New service`. Opening it presents two optional inputs:

1. `Agency website`, for example `getaxiom.ca`.
2. `What your agency does`, a plain-language summary.

At least one is required. When a website is supplied, Orbit uses the existing policy-enforced HTTP evidence provider with a ten-page budget. The result screen states how many pages were read and shows each proposed service with its evidence URLs or a `From your summary` label.

Each draft row has:

- selected checkbox;
- editable service name;
- editable client-deliverable description;
- `Typically from` and `Up to` price inputs;
- visible provenance;
- a remove control.

A bulk price control applies one range to every selected row. `Save selected services` is disabled until every selected row has a valid price range. Saving is a single atomic database batch. Manual `New service` remains beside the assistant and is never hidden.

Fresh onboarding uses the same assistant before the first client crawl. The owner may generate a draft, review it, and submit those selected services with the existing agency/client setup form. If they skip AI, the current reviewable starter catalog remains available. The generated draft is not persisted until the setup form is submitted.

## Generation contract

`AgencyCatalogGenerator.generate(input)` receives:

```ts
interface AgencyCatalogGenerationInput {
  summary: string;
  pages: Array<{
    url: string;
    title: string;
    headings: string[];
    textExcerpt: string;
  }>;
}
```

It returns at most 30 rows:

```ts
interface AgencyCatalogDraftItem {
  name: string;
  description: string;
  sourceKind: "website" | "summary" | "both";
  sourceUrls: string[];
}
```

Names are 2-80 characters and descriptions are 10-500 characters. Website source URLs must be a subset of the pages supplied to the model. A `website` row without a valid source is dropped. Summary-only rows have no URL. Duplicate names are collapsed by normalized significant tokens. Rows equivalent to existing services are removed.

The system prompt tells the model to extract customer-purchasable agency deliverables only. It excludes claims, industries served, technologies, case studies, blog topics, team members, navigation furniture, and physical products. It explicitly marks all website text as untrusted data and forbids following instructions found within it.

## Provider and failure behavior

The production implementation reuses the configured DeepSeek chat-completions endpoint, temperature zero, JSON response format, and a 20-second timeout. `AI_PROVIDER=mock` does not fabricate an AI result; the action returns an unavailable message. Tests inject a fake transport into the adapter contract.

Generation reserves one catalog-AI request before calling the provider. Defaults are 10 requests per workspace per UTC day and 200 requests across the platform per UTC day. Reservations remain consumed after provider failure because the external request may have been billed. Rejected input and failed website crawls do not consume a reservation.

## Persistence and tenancy

`upsertServicesAtomic(scope, services)` validates all services, checks that no supplied ID belongs to another workspace, and writes all rows through `SqlDb.batch`. Any failure rolls back the complete save.

Generated IDs are created server-side. The client-supplied review payload cannot choose another workspace's existing ID. At save time the server accepts only new draft rows and recomputes tags with `suggestServiceTags`.

## Verification

- Unit tests for strict generation parsing, provenance filtering, deduplication, prompt-injection isolation, and provider failures.
- Repository tests for atomic bulk saving and tenant isolation.
- Route tests for required input, mock-provider refusal, successful generation, tampered payload rejection, invalid prices, and explicit save.
- Render tests for website/summary inputs, provenance, bulk pricing, and the unchanged manual path.
- Full `pnpm verify` in Node 24.
- Browser walkthrough on the Services page using an agency website and summary.
- One explicit live-provider call when a local key is configured; otherwise report that live-provider acceptance was not reached.

