# Client Revenue Autopilot — V0 Design

## Product thesis
A subscription product for small web/digital agencies that monitors existing client websites, finds evidence-backed billable opportunities, and reduces the manual work required to turn those opportunities into proposals.

Core value:
1. Help agencies make more revenue from existing clients.
2. Save time otherwise spent manually reviewing client sites, deciding what to pitch, and writing scopes/proposals.

## Primary buyer
Small established web/digital agencies managing roughly 10–200 active client websites.

## V0 scope

### 1. Clients
Store:
- client name
- domain
- current services / contract coverage
- notes and exclusions
- last scan time

### 2. Agency service catalog
Store:
- service name
- rough price range
- what evidence makes the service relevant
- whether the service is already covered by a client's contract

### 3. Scanner
Low-cost first:
- local/cheap crawl of key pages
- CTA/form checks
- broken links/functionality
- service/location coverage
- tracking detection
- basic mobile/performance/accessibility signals
- change detection between scans

Do not run expensive AI analysis on every page.

### 4. Opportunity engine
Pipeline:
deterministic evidence -> candidate opportunity -> cheap LLM judgment -> surfaced opportunity

Each surfaced opportunity must include:
- what was detected
- evidence
- why it may matter to the client
- suggested service
- suggested scope
- agency-configured price range
- confidence
- whether the work appears billable or already covered

Low evidence means no proposal.

### 5. Opportunity workspace
Initial screens:
- Clients
- Services
- Opportunities
- Opportunity detail

Actions:
- Prepare proposal
- Dismiss
- Mark already covered
- Snooze / revisit later

The system remembers dismissals and contract coverage so it does not repeatedly suggest the same work.

## AI strategy
- Provider-swappable from day one.
- DeepSeek or another low-cost model is acceptable for V0.
- Normal development/test runs use fixtures and mocked model responses.
- Live model calls are reserved for evaluation and real scans.
- Hard per-scan AI budget.

## Testing strategy
1. $0 fixture tests using saved HTML/evidence.
2. Cheap evaluation runs using compact structured evidence.
3. Occasional live end-to-end smoke scans.

## Explicitly out of V0
- Stripe/billing
- full CRM
- client portal
- autonomous outreach
- Morrow execution
- production auto-deployment
- large analytics integrations
- multi-agent orchestration
- broad marketing/SEO suite

## Morrow integration — Phase 2
Once an agency/client approves work:
approved scope -> structured work order -> Morrow executes on branch/staging -> automated verification -> agency review -> deploy

Morrow remains optional. Other delivery paths can later include a developer handoff or issue export.

## Product boundary vs. Axiom Revenue Engine
Axiom Revenue Engine:
market -> prospect -> evidence -> outreach -> conversation -> won client

Client Revenue Autopilot:
won client -> monitor -> expansion opportunity -> proposal -> approval -> execution -> result

The new product does not duplicate Axiom's acquisition/outreach system.

## V0 success criteria
Before expanding scope, prove:
- surfaced high-confidence opportunities are genuinely pitch-worthy
- the system finds useful opportunities a human may miss
- the output saves meaningful manual review/scoping time
- at least one surfaced opportunity can plausibly become paid client work

The first major validation event is a real paid project that originated from a surfaced opportunity.

## Architecture principle
Keep three replaceable boundaries:
- EvidenceProvider
- OpportunityEvaluator
- ExecutionProvider

This allows Axiom Revenue Engine to become an evidence source later and Morrow to become an execution provider later without coupling the products.

## Build order
1. Data model for clients, service catalog, contracts, opportunities.
2. Fixture-driven scanner/evidence model.
3. Deterministic opportunity rules.
4. Cheap LLM evaluation layer.
5. Opportunity list/detail UI.
6. Proposal preparation.
7. Live scan/evaluation harness.
8. Validate before adding Morrow or subscription infrastructure.
