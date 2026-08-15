# cleanup

**cleanup** turns a waste photo into a practical disposal plan:

**photo → understand item → safety decision → matched nearby destination → planned drop-off → completion → impact**

It is a mobile-first PWA with a small Node.js backend. Featherless is used for visual understanding, while safety rules, facility matching, action proofs, limits and impact calculations stay deterministic on the server/client workflow.

## What works

- Photo/camera upload and drag-and-drop.
- Browser-side resizing for large phone photos.
- Featherless multimodal structured analysis with multiple detected items.
- One server-side **Featherless API key**.
- Automatic internal routing across multiple vision-capable Featherless models.
- Actual model-used reporting without exposing API keys.
- Deterministic handling overrides for batteries, e-waste, medical, chemical and other hazardous waste.
- Qualitative AI certainty instead of fake calibrated percentages.
- GPS and explicit address search.
- Privacy-safe POST lookup routes so typed address/GPS values are not put in cleanup's own public query strings.
- Material-aware recycling-point ranking from OpenStreetMap/Overpass.
- Explicit ambiguous-address selection instead of silently choosing result #1.
- Throttled/cached Nominatim access and bounded/cancellable external lookups.
- Lazy-loaded Leaflet map with a fallback CDN; facility lists still work if the map fails.
- Planned drop-off and clearly labelled demo pickup flows.
- Signed analyzed-item, facility-match, pre-action plan and completion proofs.
- Server-revalidated impact metrics that fail closed if receipts or local history are tampered with.
- Browser-local history with bounded writes and multi-tab locking where available.
- Offline local demo fallback and cached PWA shell.
- Render-ready single-service deployment.

## Signed completion proof: what it proves

cleanup does **not** claim a recycler physically received the waste.

For an eligible non-demo drop-off, the workflow can create this chain:

1. The normalized analyzed item receives a server-signed item proof.
2. A live facility receives a signed facility proof only when its published material tags match the signed item route.
3. **Before** the scheduled action, cleanup exchanges that facility proof for a signed plan receipt.
4. **After** the scheduled time, the valid plan can be exchanged for a signed completion receipt using the server's timestamp.
5. The impact dashboard re-sends stored completion receipts to the server and counts only receipts that still validate.

This makes browser-local edits tamper-evident and prevents fake local history from inflating attested impact. Physical handoff remains **self-reported** until a recycler-side verifier/QR/account integration exists.

A completed action with no valid pre-action plan is intentionally **not retroactively attestable**. If an old/invalid plan can never produce a completion proof, the UI shows `Attestation unavailable` rather than a retry button that cannot succeed.

## Featherless API and automatic model routing

All Featherless credentials stay on the server. You configure **one key only**:

```env
FEATHERLESS_API_KEY=your_key_here
```

There is no model setting in the app or Render configuration. cleanup automatically routes each scan through an internal pool of vision-capable Featherless models and falls back when a route is cold, unavailable, inaccessible, rate-limited, or temporarily failing. The UI simply reports that automatic routing is ready; you never choose a model.

## Local setup

Requires Node.js 20–24.

```bash
cp .env.example .env
npm ci
npm run check
npm start
```

Open:

```text
http://localhost:3000
```

Without a Featherless key, the demo workflow still works. If the backend becomes temporarily unavailable after the page has loaded, cleanup can fall back to fixed local demo data.

## Location services

The server proxies Nominatim and Overpass instead of calling them directly from browser code.

```env
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org/search
OVERPASS_URL=https://overpass-api.de/api/interpreter
NOMINATIM_MIN_INTERVAL_MS=1100
GEOCODE_CACHE_MS=86400000
OUTBOUND_QUEUE_MAX=25
```

Address lookup happens only after an explicit Search/Enter action; there is no Nominatim autocomplete. The UI advises using a city/area instead of confidential address details where possible.

## Render

`render.yaml` deploys cleanup as one Node web service:

- name: `cleanup`
- region: Singapore
- plan: free
- build: `npm ci && npm run check`
- start: `npm start`
- health check: `/healthz`
- automatic deploys from `main`
- one Featherless API key slot
- automatic internal vision-model routing
- generated `ACTION_RECEIPT_SECRET`
- bounded AI/location limits and timeouts

Render injects `$PORT`; the server listens on `0.0.0.0:$PORT`.

See [`RENDER_DEPLOY.md`](./RENDER_DEPLOY.md).

## Safety and integrity limits

- AI output can be wrong; local disposal rules take precedence.
- A displayed OpenStreetMap facility is not a guarantee that an item is accepted; published tags can be incomplete or stale.
- Special-handling destinations require a signed published-material match.
- Demo facilities, demo scans and demo pickup never count toward server-attested impact.
- Signed completion proves the cleanup workflow state, **not physical recycler possession**.
- cleanup does not dispatch a real collector in this MVP.
- No user account/database exists yet; history remains browser-local even though eligible workflow receipts are server-signed.

## Tests and CI

```bash
npm test
npm run check
```

The repository also runs `npm run check` through GitHub Actions on Node 20, 22 and 24.

Health endpoints:

```text
GET /healthz
GET /api/health
```

`/api/health` exposes safe configuration metadata such as configured/usable route counts, never secret API-key values.

## Project history

This repository starts from the **changed combined cleanup implementation**. Raw copies of the older Android/web reference projects are intentionally not included.

- Release-by-release changes: [`CHANGELOG.md`](./CHANGELOG.md)
- Full development story and bug-fix history: [`docs/PROJECT_HISTORY.md`](./docs/PROJECT_HISTORY.md)
