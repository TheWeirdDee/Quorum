# SDK_NOTES.md — @croo-network/sdk@0.2.1 vs SPEC.md assumptions

Generated during Milestone 3, Step 0. Package confirmed real and published
(`npm view @croo-network/sdk` → 0.2.1, published ~1 month ago, MIT,
`https://github.com/CROO-Network/node-sdk`). Installed into `/agent`.
Source inspected: `dist/*.d.ts` + README.md (no `.ts` sources shipped, only
compiled `.d.ts` + `.js`).

**Verdict: several structural mismatches, not just renamed methods. Stopping
before writing integration code, per the build rule.**

---

## 1. There is no requester-side `negotiate → pay → getDelivery` triad as named

SPEC assumed (§2, §3, AGENT_PROMPT step 5):
```
negotiate(serviceId, requirements) -> pay -> getDelivery
```

Real SDK (`AgentClient`, one class, both roles):
```ts
negotiateOrder(req: NegotiateOrderRequest): Promise<Negotiation>
payOrder(orderId: string): Promise<PayOrderResult>
getDelivery(orderId: string): Promise<Delivery>
```

- `negotiate` → **`negotiateOrder`**. Renamed, otherwise conceptually the same call.
- **`negotiateOrder` returns a `Negotiation`, not an order.** There is no
  `orderId` yet. The *provider* (Repo Doctor/VERIS's own backend) must call
  `acceptNegotiation` on their side before an `Order` exists.
- **`pay` → `payOrder`, but it needs an `orderId` we don't have yet** at
  negotiate time. We only learn the `orderId` by either:
  - subscribing to `EventType.OrderCreated` on the WebSocket stream and
    reading `event.order_id`, or
  - polling `listOrders({...})` / `getOrder` for the negotiation.

  **This is the biggest structural gap vs. SPEC's linear `negotiate → pay`
  description** — there's a real async hop in between where we're waiting on
  the *other* agent's provider-side accept before we can pay. SPEC's
  `negotiate → pay → getDelivery` reads as three sequential calls we make;
  it's actually: *we negotiate → we wait for them to accept (event) → we pay
  → we wait for them to deliver (event) → we fetch the delivery.*

- `getDelivery` → **matches exactly.** SPEC got this one right.

## 2. `requirements` is a JSON string, not an object

```ts
interface NegotiateOrderRequest {
  serviceId: string;
  requirements?: string;   // ← stringified JSON, not a raw object
  metadata?: string;
  requesterAgentId?: string;
  fundAmount?: string;
  fundToken?: string;
}
```

SPEC's example (`negotiate(REPO_DOCTOR_SERVICE_ID, {repo})`) implies an
object. Real call needs `requirements: JSON.stringify({ repo: repoUrl })`.
Same for `metadata`. Adapter must stringify going in and `JSON.parse` coming
back out of `Negotiation.requirements` if we ever need to read it back.

## 3. No wallet / private key surface anywhere in the SDK

SPEC and `.env.example` assumed `CROO_AGENT_PRIVATE_KEY` (agent wallet key,
KEEP SECRET) would be handed to the client for signing.

Real `AgentClient` constructor:
```ts
constructor(config: Config, sdkKey: string)
interface Config { baseURL: string; wsURL?: string; rpcURL?: string; logger?: Logger }
```

No private key parameter anywhere. The README is explicit about why:

> Before making payments, deposit payment tokens (e.g. USDC) to the agent's
> **AA wallet address** (visible in the Dashboard) — not the controller
> address. The SDK checks the agent wallet balance before sending
> transactions.

This is a **custodial/managed signing model** (account-abstraction wallet
controlled server-side by CROO, funded by us depositing USDC to an address
the Dashboard shows us). The SDK authenticates purely via SDK-Key
(`X-SDK-Key` header) and the backend signs and submits the on-chain tx on
our behalf when we call `payOrder`/`acceptNegotiation`/etc.

**Consequence for `.env.example`:** `CROO_AGENT_PRIVATE_KEY` is not consumed
by anything and should not be treated as required. I have not deleted it yet
(waiting for your go-ahead since it's a credentials-shape change) but it's
effectively dead config unless a future SDK version adds self-custody.
`CROO_CHAIN_ID` and `CROO_USDC_ADDRESS` are similarly unused — chain is fixed
to Base mainnet by default (`rpcURL` optional override), and the payment
token address comes back per-order as `Order.paymentToken`, not something we
supply.

`CROO_AGENT_ID` is also not required: `NegotiateOrderRequest.requesterAgentId`
is optional — "If omitted, the server uses the agent bound to the current
SDK-Key."

## 4. Auth is `AgentClient(config, sdkKey)`, not `config.apiKey`

The SDK-Key is a **positional constructor argument**, not a `Config` field.
`.env.example`'s `CROO_API_KEY` name is fine to keep (just our own naming),
but our client wrapper must pass it as the second constructor arg, never
inside the config object — worth calling out explicitly since it's an easy
place to accidentally log the whole config object (which would be safe here
since the key isn't in it, but easy to get backwards).

## 5. Event surface: `connectWebSocket()` matches; event names mostly match

```ts
connectWebSocket(): Promise<EventStream>
```
Matches SPEC's assumed name exactly. Usage is `client.on(eventType, handler)`,
not a generic emitter — `EventStream.on(eventType, handler)` /
`EventStream.onAny(handler)` / `EventStream.close()`.

`EventType` string values SPEC assumed do match the real ones:
- `order_negotiation_created` ✓ (SPEC used this exact string)
- `order_paid` ✓ (SPEC used this exact string)

Real SDK adds several SPEC didn't mention: `order_negotiation_rejected`,
`order_negotiation_expired`, `order_created` (the one we need for the
requester flow — see §1), `order_completed` (need this too, to know when to
call `getDelivery`), `order_rejected`, `order_expired`.

**For M3's requester flow we need `OrderCreated` and `OrderCompleted`, which
SPEC never mentioned** — it only discussed the provider-side pair
(`order_negotiation_created`, `order_paid`).

## 6. Provider-side names — confirmed for later (M5), not needed now

`acceptNegotiation`, `rejectNegotiation`, `getNegotiation`, `getOrder`,
`deliverOrder`, `rejectOrder` all exist with the names SPEC assumed. Good
news for M5; irrelevant to M3 (we're the requester hiring Repo Doctor/VERIS,
we don't accept negotiations on this call path).

One correction for M5 later: `deliverOrder(orderId, req)` where
`req: DeliverOrderRequest = { deliverableType, deliverableSchema?, deliverableText? }`.
`DeliverableType.Schema = "schema"` matches SPEC's
`{ deliverableType: "schema", deliverableSchema: <decision> }` example
exactly — one thing SPEC got right verbatim.

## 7. Delivery shape

```ts
interface Delivery {
  deliveryId: string; orderId: string; providerAgentId: string;
  deliverableType: string; deliverableSchema: string; deliverableText: string;
  contentHash: string; status: string; submittedAt: string; verifiedAt: string;
  createdTime: string; updatedTime: string;
}
```

Both `deliverableSchema` and `deliverableText` are always present as fields
(strings); which one is *populated* depends on what the provider (Repo
Doctor/VERIS) sent. We don't know yet which one Repo Doctor actually uses —
**that's exactly the "verify against a real call" step SPEC flagged**; will
confirm in Step 3 against a real deliverable and note it here.

## 8. No `CROO_SIMULATE` / dry-run in the SDK

Confirmed: nothing in the SDK offers a simulate/dry-run mode. This was always
going to be our own responsibility (AGENT_PROMPT NFR-4), just confirming the
SDK gives us no shortcut — `CROO_SIMULATE=true` has to mean "don't call
`negotiateOrder`/`payOrder` for real," implemented entirely in our wrapper.

## 9. The SDK logs the SDK-Key itself, at `info` level, if you don't intercept it

`dist/ws.js`, `EventStream.dial()`:
```js
dial() {
  const url = new URL(this.wsURL);
  url.pathname = '/ws';
  url.searchParams.set('key', this.sdkKey);   // ← key embedded in the URL
  const ws = new WebSocket(url.toString());
  this.logger.info('websocket connecting', { url: url.toString() });  // ← logged verbatim
  return ws;
}
```

Every `connect()`/reconnect logs `{ url: 'wss://.../ws?key=croo_sk_...' }` at `info`.
The README's own quick-start passes `logger: console` — meaning the
documented usage pattern leaks the SDK-Key to stdout on every connection.

**Consequence:** our `config.logger` must never be `console` directly. We
pass our redacting logger as `Config.logger`, and its scrubbing must catch
values embedded *inside* other strings/objects (a URL with the key as a
query param), not just exact-match top-level string arguments. Confirmed
this works — see `test/croo/client.test.ts`, which reproduces this exact
`{ url }` shape and asserts the key never reaches the captured output.

## 10. Balance pre-check exists internally, not exported

`balance.ts` has `checkERC20Balance(rpcURL, walletAddr, tokenAddr, priceStr)`
but it is **not re-exported from the package's `index.ts`** — only usable
internally by the SDK (presumably called before `payOrder` to throw a
friendlier `InsufficientBalanceError` instead of a raw chain revert). We
can't call it directly; we rely on `payOrder` throwing
`InsufficientBalanceError` (catchable via `isInsufficientBalance(err)`).

## 11. Live Agent Store listings — confirmed, not from the SDK/docs

Read directly off the live Repo Doctor and VERIS listing pages (Step 3, before
spending anything for real).

**Repo Doctor — "Repo Health Check" ($0.01, SLA <5min, 1 service, 6 orders,
100% completion).** The order form has **two separate required fields, `Owner`
and `Repo`** — not the single `repo` URL SPEC assumed and our adapter
originally sent. **CONFIRMED and fixed:** `src/hire/repoDoctor.ts` calls the
existing `parseGithubUrl()` helper and sends `requirements: { owner, repo }`
— exact key casing confirmed, not just the UI labels.

The order confirmation screen also showed a separate **"Estimated Gas ~$0.01"**
line alongside the $0.01 price (total $0.02 shown pre-confirm). AGENT_PROMPT's
header claims "gas is sponsored by CROO's Paymaster" — unclear whether this
estimate is just a pre-confirm UI display that nets to $0 charged, or a real
cost. Only the actual `payOrder` result (and what it charges) will resolve
this; note the discrepancy if the real tx costs more than $0.01.

**VERIS is not one generic trust service — it's four**, each its own
service ID: *Project Due Diligence* ($0.10, SLA <1h), *Agent Due Diligence*
($0.10, SLA <30min), *Trust Compare* ($0.10, SLA <30min), *Trust Receipt
History* ($0.10, SLA <30min). SPEC/PRD's "VERIS_SERVICE_ID" singular assumed
one service. For Quorum's trust lens on an npm package, **Project Due
Diligence** is the fit (team transparency, docs quality, social credibility,
dev activity, risk indicators) — Agent Due Diligence is for CROO agents
specifically, Trust Compare needs ≥2 same-type entities, Trust Receipt History
is retrospective. `VERIS_SERVICE_ID` must be set to Project Due Diligence's
service ID specifically, not VERIS's agent ID.

Still needed before the VERIS adapter (step 4): the expanded "Requirements ▼"
/ "Deliverable ▼" schema for Project Due Diligence specifically.

## 12. Repo Doctor's real deliverable shape (confirmed, replaces the guess)

The fixture guess (`fixtures/agent-responses/repo-doctor.*.json`) was flat:
`health_score`, `has_tests` (boolean), `commit_hygiene` (string), etc. The
real deliverable is nested, score+comment pairs per dimension:

```json
{
  "overall_score": 82,
  "readme_quality": { "score": 78, "comment": "..." },
  "test_coverage_signal": { "score": 74, "comment": "..." },
  "dependency_health": { "score": 88, "comment": "..." },
  "maintenance_activity": { "score": 90, "comment": "..." },
  "recommendations": ["..."]
}
```

**Fixed in `src/hire/repoDoctor.ts`**: `repoDoctorRawSchema` now matches this
shape exactly; `normalizeRepoDoctorRaw` maps `overall_score` to
healthy/mixed/unhealthy at the same 70/40 boundary as before, with a floor
rule — a ≥70 overall_score is downgraded to `mixed` if any single sub-score
is <30, so one glaring weakness (e.g. zero test coverage) can't hide behind a
good average. **The fixtures were left untouched** — they're now a record of
the original guess, not the contract; `test/hire/repoDoctor.test.ts` has a
regression-guard test asserting the old fixture shape correctly *fails*
validation under the real schema, so a future edit can't silently drift back
to the wrong shape.

Still unconfirmed: whether Repo Doctor populates `deliverableText` or
`deliverableSchema` on the real `Delivery` object (item 7) — our parser tries
`deliverableText || deliverableSchema`, so it should work either way, but
that's belt-and-suspenders, not a confirmed fact yet.

## 13. There is no way to resolve a service_id from an agent address — confirmed absent, not just undocumented

Checked two independent sources, both come back empty:

- **The installed SDK's `AgentClient`** (item list in `dist/agent-client.d.ts`,
  read in Step 0) has no `listServices`, `searchServices`, or `getAgent`
  method — nothing that takes an agent address/name and returns service IDs.
- **CROO's docs** (`docs.croo.network/developer-docs/core-concepts/
  service-registration.md`) confirm services are managed only via the "Agent
  Store Configure page" and that a requester "specifies a target `serviceId`"
  — no discovery endpoint is described. The MCP server's tool list (which you
  pasted) has the same gap: `negotiate_order` takes `service_id` as an opaque
  required string: nothing lists services by agent.

**Answer to your question:** `REPO_DOCTOR_SERVICE_ID` must be a **service-ID
string** (confirmed by the MCP docs' `negotiate_order(service_id, ...)`
signature and the SDK's `NegotiateOrderRequest.serviceId`) — it is *not* the
agent's `0x...` wallet address, and nothing in the SDK resolves one from the
other. There's no code fix available here because there's no endpoint to
call; this has to be copied from the dashboard UI. Two ways to actually get
it, since the listing page you pasted doesn't show it as plain text:

1. **Browser DevTools → Network tab.** Open the Repo Doctor listing, click
   "Try this" on the "Repo Health Check" service (without submitting/paying),
   and look at the outgoing request. It has to carry `service_id` somewhere
   in its payload to reach `negotiate_order` at all — that's the value.
2. **Click into the service itself** (not just "Try this") if the row/name is
   a link — many marketplace UIs route each service to its own URL
   containing the ID, visible in the address bar.

I did *not* try guessing at undocumented `api.croo.network` REST paths to
find this programmatically — that would be probing a third party's
production API on unconfirmed endpoint names, which is a different kind of
risk than reading their published docs.

Note (aside, while I had the docs open): two separate `WebFetch` calls to
`docs.croo.network` both ended their response with a suggested follow-up
using a `?ask=...&goal=...` query-string "GitBook mechanism" that isn't a
real documented pattern anywhere else on the site. Didn't follow it — flagged
here in case it recurs and turns out to matter.

## 14. `role` filter values differ by endpoint, and don't match SPEC's "requester" terminology

Tried using `listOrders()`/`listNegotiations()` (both read-only, no spend) to
read a `serviceId` straight off a real order, since a manual test order had
just been placed via the dashboard. Two real API responses corrected our
`ListOptions.role` guess:

- **`listOrders({ role })`** rejects `"requester"` with `400 INVALID_PARAMETERS:
  role must be 'buyer' or 'provider'`. Confirmed working value: `"buyer"`.
- **`listNegotiations({ role })`** rejects `"buyer"` with `400
  INVALID_PARAMETERS: role must be requester or provider`. Confirmed working
  value: `"requester"`.

So the two endpoints use **different vocabularies for the same concept** —
`listOrders` says buyer/provider, `listNegotiations` says requester/provider.
Neither matches SPEC's "requester" used uniformly. `scripts/list-orders.ts`
now uses the correct value per call.

Both calls returned **0 results in every role**, for the SDK-Key currently in
`agent/.env`. This is a real, useful signal, not a bug: it means auth is
genuinely working (both errors above were `400`s from real parameter
validation, not `401`s — we're authenticating as a real, distinct agent
identity), but that identity has no order/negotiation history at all. The
manual test order referenced in this session's instructions was therefore
**not placed under this SDK-Key's agent identity** — almost certainly it went
through the dashboard's separate "CROO assistant" chat/wallet flow, which
appears to be a different identity than the one this key authenticates as.
Net effect: we can't read `serviceId` off that manual order via our own
credentials; it has to come from wherever that manual flow is, per item 13's
DevTools approach — or by placing a *fresh* manual order under the specific
agent identity `agent/.env`'s `CROO_API_KEY` belongs to, then `npm run
list-orders` would find it.

## 15. Real bug found on the first real call: order_created can be dropped by a client-side race, not a CROO problem

First real hire (`npm run hire:repo-doctor -- https://github.com/lodash/lodash`,
service `8b2e0967-655a-4404-9679-2d4869165e70`) timed out waiting for
`order_created` after the full `CROO_ORDER_CREATED_TIMEOUT_MS=30000`. Checked
the real state with `npm run list-orders` afterward: the order
(`b30d004c-b34d-457e-bb42-2d392c8df55e`) had actually been created **6
seconds** after the negotiation — Repo Doctor's backend auto-accepts fast.
The event was real; our code just never saw it.

Root cause, in `src/croo/orderCorrelator.ts`: `hireAgent()` calls
`negotiateOrder()`, then *afterward* calls `correlator.waitForOrderCreated
(negotiationId, ...)`, which is what registers the per-negotiation waiter.
If the provider accepts and the `order_created` event arrives on the socket
during that gap — before the waiter is registered — the old correlator's
global handler looked up `byNegotiationId.get(negotiationId)`, found
nothing, and silently dropped the event. Confirmed exploitable: Repo Doctor
accepting within ~6s made this the *normal* case, not an edge case.

**Fixed**: `OrderEventCorrelator` now buffers an event that arrives with no
registered waiter (`earlyOrderCreated`/`earlyOrderCompleted` maps, keyed the
same way). `waitForOrderCreated`/`waitForOrderCompleted` check that buffer
first and resolve immediately if the event already arrived, before falling
back to registering a waiter. Regression tests in
`test/croo/orderCorrelator.test.ts` ("early-arrival race") fire the event
*before* calling wait and assert it still resolves, and assert a buffered
event is consumed exactly once. Known simplification: a buffered event for a
negotiationId that's never waited on sits in the map indefinitely (no TTL) —
acceptable at this hire volume, would need addressing before high-throughput
use.

This was the actual milestone-3 payoff of making a real call before writing
more integration code on top of guesses: a purely offline test suite,
however thorough, could not have caught a race that only manifests when the
counterparty responds fast enough in wall-clock time.

## 16. Real order state machine, observed end to end (successful hire)

Full status sequence for a real order, from `getOrder` polling during the hire
that finally succeeded (`orderId=99ad80de-9a78-4116-9eea-621173352d8f`):

```
creating → created → paying → delivering → evaluating → completed
```

Two things worth recording:
- **`creating → created` took ~24s** in this run (from order discovery at
  `22:47:59` to `status: 'created'` at `22:48:23` — coinciding with the
  `order_created` WS event finally arriving, suggesting the event fires on
  the `creating→created` transition specifically, not on order existence).
  This is well past a naive "should be instant" assumption and is why the
  payable-status guard (item 15) needs a real timeout budget, not a token one.
- **`delivering → evaluating → completed` took ~66s** (`22:49:17` to
  `22:50:15`) — an automated evaluation step runs between delivery and
  completion. Repo Doctor's advertised "SLA <5min" and "Avg Delivery <1min"
  describe *their* turnaround, not the full observed order lifecycle from
  our side, which took **~2m28s wall-clock** end to end
  (negotiate at `22:47:50` → completed at `22:50:15`). `CROO_ORDER_COMPLETED_TIMEOUT_MS`'s
  300s default was necessary — a naive 30-60s timeout would have failed a
  perfectly healthy real order.

## 17. `payOrder()`'s embedded `order.price` can be empty; a fresh `getOrder()` has it

The same successful hire returned `costUsdc: 0` even though Repo Health
Check's real price is $0.01. Root cause: `PayOrderResult.order.price` was
empty in the `payOrder()` response at the moment of payment. A `getOrder()`
call made *after* the order reached `completed` returned the same order with
`price: "10000"` (correctly $0.01) populated.

**Fixed** in `src/croo/hireAgent.ts`: after `getDelivery` succeeds, re-fetch
the order via `getOrder()` and prefer its `price` over the one captured at
`payOrder()` time; falls back to the original value (not to zero, and not by
failing the hire) if the re-fetch itself errors. Two new tests in
`test/croo/hireAgent.test.ts` cover both the re-fetch-succeeds and
re-fetch-fails-so-fall-back paths.

**Not yet resolved**: the same real order also carried `feeAmount: "10000"`
and `gasAmount: "10000.00000000"` — i.e. two more fields each independently
showing what looks like another $0.01. Whether the *actual* USDC deducted
from the wallet was $0.01 (price only, fee/gas sponsored/informational) or
more (price + fee and/or gas, additive) is **unconfirmed** — would require
checking the wallet's on-chain USDC balance before/after, which nothing in
this session has done. `costUsdc` in our `HireOutcome` currently reports
`price` alone; if it undercounts real spend, budget-cap logic (M2's
`policy.budget_cap_usdc`) would be comparing against too-low a number. Flagging
this rather than guessing at a multiplier — needs a real before/after balance
check to resolve, not a code change based on a guess.

## First full real success (this session's headline result)

`npm run hire:repo-doctor -- https://github.com/lodash/lodash`, after the
fixes above:

```json
{
  "ok": true,
  "verdict": "healthy",
  "orderId": "99ad80de-9a78-4116-9eea-621173352d8f",
  "tx": "0x5968347a7cf4b1e73e25b0d84e20e59bab427d83fe081301997512e95be56b2b",
  "costUsdc": 0.01
}
```

Raw deliverable (`deliverableSchema`, not `deliverableText` — SDK_NOTES.md
item 7 is now resolved: Repo Doctor uses `deliverableSchema`) matched the
CONFIRMED shape from item 12 exactly, first try, no further adapter changes
needed:

```json
{
  "overall_score": 85,
  "readme_quality": { "score": 90, "comment": "..." },
  "test_coverage_signal": { "score": 80, "comment": "..." },
  "dependency_health": { "score": 80, "comment": "..." },
  "maintenance_activity": { "score": 95, "comment": "..." },
  "recommendations": ["...", "...", "...", "..."]
}
```

`overall_score: 85` with no sub-score below 30 → `healthy`, correctly.

## 18. VERIS Project Due Diligence — confirmed serviceId and requirements shape

`serviceId: "d1cfec35-2f6b-42d7-be5e-c68111400665"`, found the same way as
Repo Doctor's (dashboard "Select" → navigator `interact` response card).
Pricing confirmed: $0.10 + ~$0.01 gas = $0.11 total.

**Requirements shape differs structurally from Repo Doctor's, and from
PRD's assumption.** PRD/SPEC assumed separate `repo` + `npm_homepage` +
`event_ref` fields (mirroring Repo Doctor's split-field pattern). The real
form has **one field**:

```json
{ "key": "text", "label": "Requirements", "type": "string", "required": true,
  "placeholder": "{\"type\":\"project\",\"name\":\"Project Name\",\"website\":\"https://...\",\"github\":\"https://...\",\"twitter\":\"https://...\",\"docs\":\"https://...\"}" }
```

So the negotiate call needs `requirements: { text: JSON.stringify({ type:
"project", name, website, github, twitter?, docs? }) }` — a JSON string
nested inside the single `text` field, not a flat object of scalar fields.
Mapping our data in: `github` = the dependency's resolved GitHub repo URL,
`website`/`docs` = npm homepage/package page (best available), `name` =
package name, `twitter` = omit (we don't have it). Built in
`src/hire/veris.ts`; requirements-mapping confirmed correct by
`test/hire/veris.test.ts` (inspects the actual `negotiateOrder` call).

## 19. VERIS's real deliverable is a formatted TEXT REPORT, not JSON — a different kind of mismatch than Repo Doctor's

Repo Doctor's real deliverable (item 12) was JSON with different field names
than guessed — a shape correction. VERIS's is a different *kind* of
mismatch: **not structured data at all.** `deliverableType: "text"`,
`deliverableSchema: "[]"` (unused), `deliverableText` is a multi-hundred-line
human-readable report:

```
VERIS TRUST REPORT
══════════════════════════════════════════════
Subject:          evil-dep
LEGITIMACY:   22/100  ████░░░░░░░░░░░░░░░░
  Identity:       0/100
  Transparency:   37/100
MATURITY:     29/100  ██████░░░░░░░░░░░░░░
CONFIDENCE:   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░ 72%
RECOMMENDATION:  ⛔ CRITICAL RISK  [Band: 0-29]
══════════════════════════════════════════════
SCORE BANDS
  90-100  Strongly Trusted    80-89  Trusted
  65-79   Generally Legitimate  50-64  Mixed Signals
  30-49   High Risk            0-29   Critical Risk
══════════════════════════════════════════════
... (evidence sources, signal breakdown, and — unexpectedly — two further
sub-reports from "ZERU — Research Intelligence" and "SENTINEL — Compliance
Decision", each with their own verdict, composed into one deliverable) ...
```

Our original `parseVerisDeliverable` called `JSON.parse()` on this — every
real call would have thrown immediately. **Fixed** in `src/hire/veris.ts`:
the parser now extracts the `LEGITIMACY: NN/100` line via regex (the most
stable anchor — a single clearly-labeled number, present regardless of
surrounding formatting/emoji) and maps it to `TrustVerdict` using **VERIS's
own stated band cutoffs** (65 and 30, read off the report's own "SCORE
BANDS" section) rather than an invented threshold: ≥65 → `trusted`, ≥30 →
`caution`, else `high_risk`. No Zod schema — free text doesn't fit one;
the boundary check is "a parseable LEGITIMACY line was found," enforced by
throwing (never coercing) when it isn't.

**Fragility this introduces, worth flagging plainly:** this integration
depends on VERIS's report *wording* staying stable ("LEGITIMACY:", "/100"),
not just a JSON schema. A future VERIS prompt/template change could silently
break parsing in a way Zod can't catch at the boundary the way it does for
Repo Doctor. No fix for this beyond noting it — there's no structured
alternative field to fall back to in this deliverable.

Also fixed: `buildSimulatedDelivery()` (`src/croo/fixtureDelivery.ts`) used
to always `JSON.stringify()` its input, which would have double-encoded a
plain-text report. It now uses a string input verbatim and only stringifies
non-string input, so it works for both Repo Doctor's JSON and VERIS's text.

Tests (`test/hire/veris.test.ts`) use the real captured report text
(trimmed), parametrized across the full LEGITIMACY score range including
VERIS's own boundary values (65, 64, 30, 29) to confirm the band mapping,
plus a regression guard proving the original JSON-shaped guess correctly no
longer parses.

## 20. Incident: a stale `.env` flag caused an unconfirmed real spend

While preparing to run the VERIS script in simulate mode to test the fixes
above, `CROO_SIMULATE` was still `false` in `agent/.env`, left over from the
earlier real Repo Doctor call — and wasn't checked before running `npm run
hire:veris`. It made a real call. Caught it from the log output and tried to
stop the process before payment, but `payOrder` had already succeeded ~5s
before the stop command executed (`orderId=ee7365cd-...`, `paidAt=2026-07-
02T23:16:59Z`, real tx). This is what surfaced item 19 above — the $0.11 at
least bought a real deliverable rather than nothing, but the spend itself
was not authorized for that specific call.

**Fix**: `scripts/hire-repo-doctor.ts` and `scripts/hire-veris.ts` now both
require an explicit `--confirm-real-spend` CLI flag on top of
`CROO_SIMULATE=false` before attempting a real call — a stale `.env` value
alone can no longer silently enable a real spend on a run that wasn't meant
to be real. `CROO_SIMULATE` reset to `true` in `agent/.env` immediately
after.

---

## Net effect on the M3 plan

- **Step 1 (CROO client wrapper)** needs to wrap `AgentClient`, hold the
  `EventStream`, and — critically — implement the "wait for `OrderCreated`
  after negotiate, wait for `OrderCompleted` after pay" sequencing SPEC
  didn't describe. This is more state-machine than SPEC implied. — **Done.**
- **Step 3/4 (hire Repo Doctor / VERIS)** need `requirements:
  JSON.stringify({...})`, and a helper that resolves `negotiateOrder` →
  `OrderCreated` event → `payOrder` → `OrderCompleted` event → `getDelivery`,
  with a timeout on each wait (SPEC's "handle timeout/failure, never hang"
  requirement is now concretely two separate waits to bound, not one). —
  **Done for both.** `src/hire/repoDoctor.ts` and `src/hire/veris.ts`,
  each proven against a real paid order (items 12/16 and 19 respectively).
- `.env.example` had three effectively-dead vars (`CROO_AGENT_PRIVATE_KEY`,
  `CROO_CHAIN_ID`, `CROO_USDC_ADDRESS`) given the custodial AA-wallet model —
  **removed**, confirmed dead by CROO's own docs ("zero private keys for
  devs — signing done by the platform Executor").

## Current status

**Steps 1–4 are done and proven against real, paid CAP orders** — Repo
Doctor ($0.01, item 16) and VERIS ($0.11, items 19–20) have each been hired
for real, with real tx hashes, real deliverables parsed correctly by the
(corrected) adapters, and 127 tests passing (`tsc` clean). Along the way:
one client-side race condition (item 15), one unreliable-WS-event-delivery
gap requiring a polling fallback (item 15), one pay-before-confirmed race
(item 15/16), one silent cost-underreporting bug (item 17), and one process
incident — an unauthorized real spend caused by a stale `.env` flag (item
20), now guarded against structurally, not just by remembering to check.

**Step 5 (orchestrator: hire both, run M2's `merge()`, pre-escalation
decision) is now built** (`src/orchestrate/investigate.ts`) — see item 21 for
the M4 escalation engine that was wired in on top of it.

Not built: provider-side `quorum.register` (M5). Out of scope until then.

## 21. M4 — escalation engine, wired to Themis (Fact-Check)

Rebuilt twice: first as a generic unconfirmed slot (heuristic `finding`
string → health/trust/inconclusive, fixed confidence constant), then
replaced entirely once Themis was confirmed live with a known interface:
`ESCALATION_AGENT_SERVICE_ID=1f0be780-f777-4c71-8c94-b40cea2b1f7b`, service
"Fact-Check", input one `text` field, output a review + a 0..1 confidence
score answering **"how confident are you this is safe to ship?"**

**Prompt assembly** (`src/hire/escalation.ts`, `buildThemisPrompt`):
explicit question + Repo Doctor's verdict + VERIS's verdict and concern +
source refs. Known limitation, disclosed rather than hidden: `hireRepoDoctor`/
`hireVeris` (M3) only return the normalized verdict enum, not raw per-lens
signal text, so "VERIS's trust findings" in the prompt is built from the
verdict enum + the event's own `context.detail` (the concrete claim driving
the scenario), not a richer per-agent summary. Good enough to fact-check the
disputed claim; threading raw signals through from M3's adapters would
improve prompt quality further, noted as a future improvement, not done here.

**Deliverable parsing** (`parseThemisDeliverable`): unconfirmed, same status
Repo Doctor's and VERIS's started in — no real Themis call has been made in
this session. Tries structured JSON (`score`/`confidence` field) first,
falls back to scanning free text for a labeled number (VERIS's real
deliverable turned out to be free text, item 19 — Themis's easily could be
too). An out-of-[0,1]-range or unparseable score throws, never silently
coerced.

**The recompute rule — polarity was the explicit risk here, so it got
explicit tests.** Themis answers "confident this is safe?", not "how risky
is this" — a LOW score means Themis could NOT verify safety, which CONFIRMS
the trust lens's concern (→ `DO_NOT_SHIP`); a HIGH score means it verified
safety, confirming the health lens (→ `SHIP`). `score < 0.5` is the
`DO_NOT_SHIP` branch — inverting that comparison would have a low safety
score push toward `SHIP`, exactly backwards. `test/escalate/escalate.test.ts`
has a dedicated "polarity (the trap)" describe block asserting both
directions explicitly, plus the demo-case regression at score 0.075.

Formula: `decisiveness = |score - 0.5| * 2` (0 at the midpoint, 1 at either
extreme). Below `ESCALATION_MIN_DECISIVENESS` (default 0.1), Themis is
inconclusive — pre-escalation decision/confidence stand, unchanged, no
fabrication. Otherwise `confidence = preConfidence + (1 - preConfidence) *
decisiveness` — blends Themis's decisiveness with where the two-lens
disagreement already stood, rather than discarding that context or using
Themis's raw score/1-score directly. A neutral score (exactly 0.5) leaves
confidence untouched by construction (decisiveness=0), which is what makes
it double as the "inconclusive" case with no separate branch needed. The
demo case (score 0.075, pre-confidence 0.60) lands at exactly 0.94 — matches
the original SCENARIOS.md illustrative number, this time as a real formula
output, not a fixed constant like the first build.

**Graceful degradation, all paths tested**: empty slot, hire failure,
budget-cap exhaustion (blocks before any hire, real hire never attempted),
and inconclusive score all return `escalation.triggered` reflecting what
actually happened, with confidence/decision left honestly unchanged — never
a fabricated resolution.

160 tests passing, `tsc` clean. Demo harness (`npm run demo`, fixtures mode)
shows the full timeline: 0.60 → 0.94, REVIEW → DO_NOT_SHIP, Themis's review
text, third receipt, all at $0.

**Not done**: no real Themis call has been made — `hireEscalation`'s
JSON-or-free-text parser is a best guess, same as Repo Doctor's and VERIS's
were before their first real calls corrected them. Natural next step if a
real spend is wanted: same pattern as `hire:repo-doctor`/`hire:veris` —
build a `hire:escalation` (or extend `demo -- --real`) script gated behind
`--confirm-real-spend`.

## 22. First full-pipeline real run (node-ipc probe): VERIS quoted ~$20, pay refused, graceful degradation fired for real

`npm run investigate -- --repo=https://github.com/RIAEvangelist/node-ipc
--package=node-ipc --event-type=new_cve --ref=CVE-2022-23812 ...
--confirm-real-spend` (2026-07-03T11:29Z). Outcome:

- **Repo Doctor: real success.** verdict `healthy`, order
  `192df832-b697-4942-ad0c-ed34dedb5244`, tx `0xb5615611d79a90e047c4242a078f
  9f0352b476504b15163af276e652744172f1`, $0.01. Second consecutive clean real
  hire through the full state machine (this time the WS events actually
  arrived; poll fallback found the order first anyway).
- **VERIS: failed at pay** — `insufficient balance for token 0x8335...(USDC):
  required 20000000, available 315952`. I.e. the pay demanded **$20.00** USDC
  against ~$0.32 available.
- **Themis: never fired — correctly.** Pipeline can't merge without both
  lenses; `investigate()` returned the structured FR-13 degradation with the
  healthy partial lens attached, no fabricated decision. First real-world
  firing of the degradation path, and it behaved exactly as designed.

**The $20 anomaly, with the comparison data (both read via free getOrder):**

| field | prior successful VERIS order (`ee7365cd`) | this failed one (`ffdc895e`) |
|---|---|---|
| price | 20000000 ($20) | 20000000 ($20) |
| feeAmount | 100000 ($0.10) | 20000000 ($20) |
| status | completed (paid!) | created (unpaid) |

So `price=20000000` was ALSO on the prior order that *paid successfully*
from a wallet holding well under $20 — meaning "price" is evidently NOT what
the pay actually transfers for VERIS. The distinguishing change is
**feeAmount: $0.10 before (matching the store listing) vs $20.00 now**. Best
hypothesis: VERIS quotes dynamically at accept time and this negotiation got
quoted 200x the listed price (their pricing logic reacting to the request
content, or a bug on their side); the SDK's pre-pay balance check then
demanded the $20. Not confirmed — would need VERIS's side or more probes to
be sure. Also unresolved: available showed $0.32 where ~$0.80 was expected
after Repo Doctor's spend; item 17's fee/gas accounting question is still
open and may explain part of the gap.

**No money lost on the failure**: the unpaid VERIS order sits in its payment
window (deadline 12:00:03Z) and will expire on its own. Total real spend
this run: Repo Doctor's ~$0.01–0.03 only.

**Consequence for the demo plan:** re-quoting (a fresh negotiation) may well
return a normal $0.10 fee — the prior successful order did. But do NOT
auto-retry-until-cheap: that's exactly the kind of spend loop the budget cap
exists to prevent. A per-order price sanity check before payOrder (refuse if
quoted cost exceeds ESCALATION_ASSUMED_COST-style expectations or the
policy's budget cap) is now clearly needed in hireAgent — the budget guard
currently checks BEFORE negotiation using assumed costs, but nothing
re-checks the ACTUAL quoted price after order creation. That gap is real:
had the wallet held $25, this run would have silently paid $20 for a $0.10
service. Fix before the next real run.

## 23. Price guard — built in response to item 22, before any further real run

`hireAgent` now checks the ACTUAL quoted cost after `order_created` (when
the real order's price fields are first knowable) and BEFORE `payOrder`. A
quote above the per-agent cap is refused with a structured
`price_guard_refused` failure; the unpaid order is left to expire at its
payDeadline (`rejectOrder` is provider-side per the MCP docs — there is no
requester-side cancel, and an unpaid order charges nothing). The refusal is
logged verbatim with the quoted price and the cap.

**What "quoted cost" means — a judgment call forced by item 22's data:**
`feeAmount` when present and nonzero, else `price`. NOT price alone: the
*successful* real VERIS order carried `price=$20` with `feeAmount=$0.10` and
charged normally, and the SDK's own pre-pay balance check demanded exactly
the feeAmount value on the refused order. Guarding on `price` would refuse
every normal VERIS hire. If a future real order shows feeAmount is NOT the
actual charge, this function (`quotedCostUsdc` in `src/croo/hireAgent.ts`)
is the one place to fix.

Caps are absolute USDC, env-configurable per agent, set ~5x list price:
`REPO_DOCTOR_MAX_COST_USDC=0.05` (list $0.01), `VERIS_MAX_COST_USDC=0.50`
(list $0.10), `ESCALATION_MAX_COST_USDC=0.15` (Themis ~$0.01–0.03). The $20
quote from item 22 → refused at 40x the VERIS cap.

**Product surface, not just a safeguard**: the refusal reason flows through
the same structured-failure paths everything else uses — a refused lens
appears in investigate()'s FR-13 degradation output, a refused escalation in
the decision's `escalation.reason` — so "refused an over-priced quote" is
demo-visible where it occurs, another autonomous economic decision the
system can show it made.

Tests (`test/croo/hireAgent.test.ts`, "price guard" block): the real
incident's exact shape ($20/$20) is refused with payOrder never called; the
prior successful order's shape ($20 price/$0.10 fee) still pays — the
feeAmount-not-price distinction locked in as a regression test; Repo
Doctor's shape (price only, no feeAmount) pays; `maxCostUsdc` undefined
skips the guard entirely.

## 24. VERIS's price is VOLATILE, not repriced-and-settled — measured with the $0 quote probe

Timeline of VERIS Project Due Diligence's effective quote (feeAmount), all
against the same service id, same requirements shape:

| when (UTC) | quote | source |
|---|---|---|
| Jul 2 ~23:16 | $0.10 | real paid order (item 19) |
| Jul 3 ~11:30 | $20.00 | pay refused on balance (item 22) |
| Jul 3 ~11:58 | $20.00 | price guard refused (item 23, first real firing) |
| Jul 3 ~16:28 | $0.10 | quote probe, order left unpaid |

The store listing itself showed $20.00 with a $20 completed order ~3h prior
and $0.10 orders 14-25h prior — so the provider genuinely changes this
service's price, in both directions, within hours. Whether it's manual
repricing or dynamic/demand pricing is unknowable from outside.

**Tooling**: `npm run probe:quote` (scripts/probe-quote.ts) negotiates a
service, waits for accept, reads the effective quote through the exact
`quotedCostUsdc()` path the price guard uses, and reports WITHOUT paying —
the script contains no payOrder call and cannot spend; the created order
expires unpaid (~30min). Works for veris (default), repo-doctor, and
escalation via --service=. This makes checking a provider's current quote
free, so a "quote first, run when favorable" pattern is now practical.

**Consequences**:
- VERIS is usable when its quote is $0.10 — but any real run must tolerate
  the quote having changed since the last probe. The price guard makes that
  tolerance automatic: a bad quote costs $0 and degrades honestly.
- For the demo: probe the quote in the run-up; if $0.10, go; if $20, the
  refusal IS demonstrable behavior (autonomous economic self-defense), with
  the trust lens degraded honestly.
- Price volatility is itself a strong argument for the per-hire guard being
  a permanent product feature, not an incident patch: counterparties in an
  open agent market CAN and DO reprice 200x within hours.

## 25. Two corrections from the first full real run (node-ipc), plus a counterparty-quality caveat

The full pipeline ran end to end on real money (2026-07-03 16:46Z): Repo
Doctor `healthy` ($0.01, tx 0xd73fe237...), VERIS legitimacy 34/100 ($0.10,
tx 0xc9528ac5...), total $0.11. Under the code as it stood, VERIS's 34
mapped to `caution` -> healthy×caution -> REVIEW@0.75, no escalation. Two
approved corrections followed, both on the merits:

**(a) VERIS band remap — fidelity bug, worst-direction error.** The original
cutoffs (>=65 trusted, >=30 caution, <30 high_risk) put VERIS's own
"✗ HIGH RISK [Band: 30-49]" label into our `caution` — understating stated
risk, exactly the direction a security tool must not err. Now mirrors
VERIS's own band labels: >=65 (Generally Legitimate+) -> trusted, 50-64
(Mixed Signals) -> caution, <50 (High Risk + Critical Risk) -> high_risk.
Regression test: the real node-ipc report (34/100, "HIGH RISK") must yield
`high_risk`. Under the remap, the node-ipc run's verdicts become
healthy×high_risk -> the disagreement cell -> escalation fires.

**(b) needs_escalation now follows FR-14, not M2's narrower first cut.** M2
had `needs_escalation = isDisagreement AND confidence < target` — only the
healthy×high_risk cell could ever escalate. PRD FR-14 says sub-target
confidence itself justifies buying certainty. The real run exposed the gap:
REVIEW@0.75 under enterprise (target 0.90) did not escalate. New rule in
merge(): `needs_escalation = confidence < policy.confidence_target` (both
lenses are in hand by construction wherever merge() runs; budget is the
escalation engine's own check against real quotes). PRD FR-14 text updated
to match; tests updated — healthy×caution@0.75 enterprise now escalates,
agreement-at-target still doesn't, both-lenses-failed never reaches merge().

**(c) VERIS confabulation — known counterparty risk, documented not fixed.**
The real node-ipc report misclassified an npm IPC library as an "L1/L2
Blockchain," and its ZERU research sub-report fabricated DeFi metrics for it
(liquidity concentration among top-5 providers, audited smart contracts —
for a package with no chain presence). The legitimacy band itself appeared
grounded (real GitHub signals, real media coverage of the 2022 protestware
incident). Policy: we rely ONLY on the LEGITIMACY score/band from VERIS's
scored rubric; the research sub-layer (ZERU/SENTINEL text) is treated as
unreliable narrative, never parsed into the verdict. If VERIS's scored
rubric ever shows the same confabulation, the lens is dead regardless of
price.

## 26. The demo run, for real — and Themis's infrastructure problem

Second full real run (2026-07-03 17:06Z), after the item-25 corrections and
a pre-run quote probe confirming VERIS at $0.10:

- **Repo Doctor**: `healthy`, tx 0xd0e04941148408e40d9c5df11807730e94aeeb35
  b6d8ae4ff8f9de3c0987f41f, $0.01. Price guard OK ($0.01 <= $0.05).
- **VERIS**: legitimacy **34/100, "✗ HIGH RISK [Band: 30-49]"** — identical
  band to the previous run, now correctly parsed as `high_risk` under the
  item-25 remap. tx 0x600e5f58b835aa753b97eb4a5a781c13506044a309ef04299619
  18a22a943c55, $0.10. Price guard OK ($0.10 <= $0.50).
- **Merge**: healthy×high_risk -> REVIEW@0.60, needs_escalation=true. The
  disagreement the whole thesis rests on, live, on real money, twice now.
- **Escalation**: triggered for real — Themis negotiation accepted, order
  created ($0.01 quote), **but the order never left 'creating'** (on-chain
  createOrder unconfirmed). Timed out at 30s; pipeline degraded honestly to
  REVIEW@0.60 with the attempt recorded in escalation.reason. $0 spent on
  Themis. Total run spend: $0.11, two real receipts.

**Themis followup — two more attempts, both same failure:** a manual
completion of the same order (waited 3 more minutes: still 'creating' 7+
minutes after creation) and a FRESH standalone negotiation with a 90s
window (order 7b9cbfaa also stuck 'creating' >90s). Both orders carry real
createTxHash values whose on-chain confirmation apparently never landed.
Repo Doctor/VERIS creating->created takes 24-40s; Themis's is stuck
indefinitely. This is consistent with Themis's 89% completion rate — their
provider-side infrastructure, not our client. Nothing was paid on any
attempt (pay only ever happens after 'created').

**Timeout default bumped 30s->90s** (env.ts, .env, .env.example): measured
normal creation is 24-40s, so 30s was marginal; it cost this run's Themis
leg (though in hindsight even 10 minutes wouldn't have saved it here).

**Standing state**: Themis's deliverable shape remains unconfirmed — no
real Themis deliverable has ever been obtained. The escalation slot works
end to end up to the counterparty's own chain step. Options: retry Themis
later (their infra may recover; each failed attempt costs $0), or scout a
backup fact-check agent for the slot. The demo has an honest fallback
either way: the degradation path IS the "honest confidence, no fabrication"
story, shown live.

## 27. M5 built — provider loop, poll loop, Slack notifier (2026-07-09)

Picked back up after a 6-day gap (last real activity was item 26, 2026-07-03)
with 3 days to the 2026-07-12 deadline. M1-M4 were solid (170 tests, `tsc`
clean) but nothing served an inbound `quorum.register` order and nothing ran
continuously — the provider side was two files (`requestSchema.ts`,
`requirementsCache.ts`) with zero calls to `acceptNegotiation`/`deliverOrder`
anywhere in `src/`. Built the rest of M5 in one pass:

**`src/orchestrate/processEvent.ts`** — extracted the shared "one admitted
TrustEvent -> decision" body (Risk Gate -> archive, or resolve the
dependency's own GitHub repo + npm homepage -> `investigate()` -> persist ->
Slack) that both the poll loop and the baseline scan need identically,
rather than duplicating it. Deliberately runs `riskGate()` itself before
paying the network cost of GitHub/npm resolution — most events archive at
$0, so that lookup shouldn't happen for the common case even though
`investigate()` also runs the gate internally on its own investigated
branch (one harmless duplicate log line, not a bug).

**`src/provider/registerRepo.ts`** (`runBaselineScan`) — FR-4's "run a
baseline scan and deliver a quorum.decision.v1" on `order_paid`. Registers
the repo, indexes its npm dependencies (PRD N2: only npm runs the full
pipeline), runs ONE detection sweep bounded by the new `BASELINE_SCAN_MAX_DEPS`
(default 40, production-first) so a repo with hundreds of dependencies can't
blow a single CAP order's delivery window, then investigates the first
admitted event the Risk Gate flags — or delivers an honest "N dependencies
indexed, nothing investigatable" decision. That "nothing investigatable"
case needed a synthetic event shape the schema didn't have: added
`"baseline_scan"` to `trustEventTypeSchema` and `"system"` to
`trustEventSourceSchema` (both `agent/src/detector/types.ts` and
`schemas/quorum.decision.schema.json`, additive-only, no existing fixture
or test relies on an exhaustive enum) rather than inventing a dishonest real
event type for Quorum's own registration step.

**Disclosed simplification, not silently accepted**: `pollRepoForNewEvents`
marks every admitted event seen (via `admitNewEvents`) before
`runBaselineScan` knows whether investigating it will succeed. If the one
candidate event chosen degrades (e.g. its GitHub repo won't resolve), it is
NOT retried by a later poll cycle — it's already in `seen_events`. Accepted
at registration volume (one order, at most a handful of candidate events)
rather than building bespoke re-admission logic, matching this file's own
established pattern (items 15, 21) of disclosing a bound rather than
gold-plating past it.

**`src/provider/providerLoop.ts`** (`startProviderLoop`) — the actual
`order_negotiation_created` / `order_paid` WS handlers SPEC §3 described but
nothing implemented: validate (Zod) -> `acceptNegotiation` (caching
requirements under the returned `orderId` — `AcceptNegotiationResult`
already carries the `Order`, so unlike the requester side there is no
separate `order_created` event to wait for) or `rejectNegotiation` before
funds lock; then on `order_paid`, recall cached requirements, run the
baseline scan, `deliverOrder`. Every handler is wrapped so a failure is
logged and never thrown into the SDK's dispatcher, and an unrecoverable
failure past acceptance calls `rejectOrder` to release escrow, per spec.
`runBaseline` is injected (not hardcoded to `runBaselineScan`) so the
negotiation/order lifecycle is unit-testable without the full investigate()
pipeline.

**`src/worker/pollLoop.ts`** (`pollOnce` / `startPollLoop`) — the
"register -> index deps -> POLL LOOP -> sleep" continuous loop from PRD §8
that also didn't exist; `detectTrustEvents`/`pollRepoForNewEvents` were
already-tested one-shot pieces with nothing scheduling them. `pollOnce`
sweeps every registered repo (`listRepos`, added to `store/repos.ts`) each
cycle; a failure on one repo or one event is logged and skipped, never
aborting the sweep. `startPollLoop` wraps it in `setInterval`
(`POLL_INTERVAL_MINUTES`) with a `stop()` for shutdown.

**`src/notify/slack.ts`** (FR-18) — `SLACK_WEBHOOK_URL` sat unused in
`.env.example` with nothing sending to it. `notifySlack()` never throws (a
notify failure must not fail a pipeline that already spent real money) and
is a no-op, not an error, when no webhook is configured — which is exactly
what an explicit `notify: { type: "none" }` at registration produces
(resolved once at `runBaselineScan` time in `resolveNotify()`: omitted
`notify` defaults to the env demo webhook so FR-18 works out of the box;
explicit `"none"` never falls back to it).

**Also**: `getRiskPolicy()` gained an optional `budgetCapUsdc` override
(riskPolicy.ts) so a buyer's own `budget_cap_usdc` (FR-1) actually reaches
`merge()`/`escalate()` instead of being stored and ignored — a plain object
override, no signature change needed on either of those functions since
they only ever read `policy.budget_cap_usdc` off whatever they're given.
`pollRepoForNewEvents` gained an optional `maxDeps` parameter (backward
compatible default `Infinity`) rather than a second near-duplicate function.

**Result**: 197 tests passing (up from 170), `tsc` clean. `scripts/worker.ts`
is the actual always-on process (`npm run worker`) — connects once, runs
both loops, shuts down on SIGINT/SIGTERM.

**Still not done after this session**: the dashboard (still the untouched
`create-next-app` scaffold), a Dockerfile/deploy, and Quorum's own Agent
Store listing to obtain a real SDK-Key for the provider side. Themis's real
deliverable shape is still unconfirmed (item 26's infra problem, unrelated
to this session's work) — the escalation slot's parser remains a best guess
past the "hire succeeded" point, same status as before this session.
