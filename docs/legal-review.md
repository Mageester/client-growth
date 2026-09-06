# Legal review — what still needs a lawyer

`app/routes/privacy.tsx` and `app/routes/terms.tsx` are drafts. They are
*accurate* — every factual claim in them was written against the code and can be
checked against it — but accuracy is not the same as sufficiency, and nobody
qualified has read them.

**Do not take a paying customer, or invite an agency outside your own contacts,
until these have been reviewed.**

## What the reviewer needs to know about the product

- The operator is a Canadian entity (`getaxiom.ca`), so **PIPEDA** applies.
- Customers are agencies. Their clients are small businesses, likely in Canada,
  the UK and the EU. Where those agencies are in the UK/EU, **UK GDPR / GDPR**
  reach the operator through them.
- The service processes: account details of the agency's own staff; records
  *about* third-party businesses (name, domain, offerings, notes) entered by the
  agency; and content read from those businesses' public websites.
- Sub-processors are **Cloudflare** (hosting and database, data location per
  Cloudflare's own regions), **Resend** (transactional email), and **DeepSeek**
  (the judgment call). DeepSeek is the one to look at hardest: it is an AI
  provider outside the usual list, and it receives a client business's name and
  domain. What it receives is exactly `{ client: { name, domain }, subject }` —
  see `src/adapters/evaluator/prompt.ts`.

## Specific questions to put to them

1. **Is a DPA needed, and in which direction?** An agency customer is likely a
   controller and the operator a processor. Agencies with EU clients will ask
   for a data processing agreement before they sign. There is currently none.
2. **Sub-processor disclosure and international transfer.** Cloudflare, Resend
   and DeepSeek all need to be named, with a transfer mechanism where personal
   data leaves the UK/EU. Business names and domains may not be personal data —
   but sole traders' business names frequently are.
3. **Crawling third-party sites.** The service reads public pages of businesses
   who have not themselves agreed to anything. The terms place that
   responsibility on the agency customer (§"Your responsibility for the sites
   you analyze"). Is that placement sufficient, and should the product require a
   positive confirmation per client rather than a term in a document?
4. **Liability wording.** The draft limitation is generic. It needs to match the
   jurisdiction and the actual contract shape.
5. **The proposal share link.** A share URL is an unguessable bearer token that
   renders an immutable snapshot of a proposal, is revocable and expires. Is the
   privacy page's treatment of it adequate?
6. **Retention.** The draft says data is kept while the account is open. Is a
   stated maximum needed?

## Also outstanding

- No cookie banner. The service sets one cookie, strictly necessary for
  sign-in, and uses no analytics or advertising cookies — which is the basis for
  not having a banner. Confirm that reasoning holds for the jurisdictions the
  customers are in.
- `privacy@getaxiom.ca` and `hello@getaxiom.ca` are referenced by the pages.
  Both must actually receive mail before launch.
