# Changelog

All notable development milestones for **cleanup** are recorded here. The repository begins with the substantially rebuilt web application; it does **not** include raw copies of the older reference repositories used during early product research.

## 0.14.1 — Deep bug-fix audit

- Fixed Unicode address-cache collisions for Urdu, Arabic and other non-ASCII location searches.
- Reject expired/invalid analyzed-item proofs instead of silently falling back to caller-supplied facility tags.
- Clear stale analysis/action context when an invalid replacement photo is chosen.
- Ignore spoofable forwarded IP headers outside the trusted Render proxy boundary.
- Release stale impact controllers and prevent stale health checks from overwriting newer AI status.
- Preserve and display saved action notes in local history.
- Stop revalidating all completion receipts every minute just to refresh scheduled-action controls.
- Distinguish Gemini quota cooldowns from model-access cooldowns and mixed route cooldowns.
- Explicitly set Render to production error mode and bump PWA/server cache identity to 0.14.1.

## 0.14.0 — GitHub baseline release

- Published the changed/combined `cleanup` web application as the repository baseline.
- Synchronized app, server, manifest, service-worker, asset and test versions.
- Added GitHub Actions CI for Node 20, 22 and 24.
- Corrected documentation to describe the current signed proof chain accurately.
- Kept the final proof-flow rule: a completed action with no valid pre-action plan cannot be retroactively server-attested.
- Surface bounded proof failures in history instead of offering a retry that can never succeed.
- Added this changelog and the detailed project-history document.

## 0.13.x — Proof, privacy and failure-boundary hardening

- Added server-signed analyzed-item proofs, matched-facility proofs, pre-action plan receipts and completion receipts.
- Completion receipts use the server completion timestamp and are revalidated before they affect impact metrics.
- Physical handoff remains explicitly self-reported; the server attests the cleanup workflow, not recycler possession.
- Bound receipts to item, material, waste type, facility, weight, planned time and completion state.
- Reject future completion timestamps, invalid schedules, malformed proof structures and replay inflation.
- Deduplicate multiple completion receipts for the same deterministic plan.
- Added independent proof lifetimes for analyzed items, facilities, plans and completions.
- Added a generated `ACTION_RECEIPT_SECRET` in Render; weak local secrets are ignored.
- Moved browser address/facility lookups to POST JSON so typed addresses/GPS coordinates are not placed in cleanup's public query strings.
- Added same-origin browser API guards while preserving server-to-server/curl access without browser metadata.
- Hardened static serving against traversal and symlink escape.
- Added bounded localStorage writes, multi-tab storage locking where available, canonical timestamp handling and strict numeric parsing.
- Ensured malformed local history fails closed and cannot impersonate a server-attested card.
- Added bounded proof error display and permanent `Attestation unavailable` state for expired/invalid pre-action proof.
- Hardened service-worker caching so API/no-store responses are never cached.
- Improved Render-free-tier PWA navigation behavior with cached-shell fallback and background refresh.
- Added safe-area mobile spacing and additional accessibility semantics.

## 0.12.x — Hosted-service and integrity hardening

- Added exact 30-day scheduling horizon consistency between browser and server.
- Tightened completion timing so server attestation cannot occur before the scheduled instant.
- Changed impact language from “verified” to server-attested/matched completion to avoid overstating what is proven.
- Added periodic receipt revalidation and receipt/detail matching before the UI displays an attested badge.
- Added client fail-closed normalization for malformed backend facility/receipt payloads.
- Added bounded upstream response sizes for Gemini, Overpass and geocoding.
- Added bounded/cancellable outbound lookup queues and kept timeout coverage over complete upstream body reads.
- Added rightmost forwarded-hop identity handling on Render to make rate limiting harder to spoof.
- Added global AI service budget after request validation so malformed images do not consume Gemini capacity.
- Hardened MIME/image-signature validation and large-image handling.

## 0.11.x — Signed drop-off proof chain

- Introduced a lightweight server-side proof model without requiring Firebase/Postgres.
- Facility search results can carry signed match proofs when published material tags match the signed analyzed item.
- A real matched drop-off can obtain a signed pre-action plan before the scheduled time.
- After the scheduled time, the plan can be exchanged for a signed completion receipt.
- Impact counts only completion receipts that the server can revalidate.
- Added tamper tests for altered local weight/item/facility/schedule data.
- Kept demo facilities and demo pickup permanently excluded from attested impact.

## 0.10.x — Deeper data and proof safety

- Dropped malformed Gemini item-array entries instead of rendering fake “Unknown item” cards.
- Strengthened deterministic battery/e-waste/medical/hazard routing even when the model labels the item incorrectly.
- Capped malformed/oversized Overpass data before ranking.
- Hardened receipt structure and expiry checks.
- Added clearer distinction between self-reported physical completion and server workflow attestation.

## 0.8.x–0.9.x — Network, matching and PWA hardening

- Serialized/throttled Nominatim requests and added caching to respect public-service usage limits.
- Bounded stale lookup queues and cancellation behavior.
- Fixed material synonym/token bugs, including PET incorrectly matching words such as `carpet`.
- Improved facility compatibility ranking and fail-closed special-handling selection.
- Added address-choice UI instead of silently choosing the first ambiguous geocoder result.
- Improved offline/demo behavior, lazy map loading and CDN fallback.
- Hardened service-worker versioning and stale-shell behavior.

## 0.7.0 — Deep UI and deployment bug pass

- Fixed request races between repeated image analysis and facility searches.
- Fixed stale facility/map results when switching detected items.
- Fixed draft weight/note/destination leakage between items.
- Fixed invalid replacement-image behavior and large phone-photo resizing.
- Added future-action `Scheduled` state instead of unusable completion controls.
- Improved malformed localStorage handling and impact fail-closed behavior.
- Added safe Render health/startup/shutdown handling.
- Added public API rate limits, lookup caches and response validation.
- Expanded mobile and browser-level regression testing.

## 0.5.0 — Multi-key/model Gemini reliability

- Added up to three Gemini API keys.
- Added primary plus two configurable backup model names.
- Added key rotation for invalid/auth/quota/retryable failures.
- Added model fallback for true model-unavailable conditions.
- Record the actual model that answered instead of the configured primary model.
- Added cooldowns for failed key/model routes.
- Kept all keys server-side and excluded them from health responses/logs.
- Replaced fake-looking numeric AI confidence with Low/Medium/High certainty.
- Fixed invalid result-card markup, drag/drop, UTC date behavior, map/loading state and several responsive UI issues.

## 0.3.x–0.4.x — Render and production hardening

- Renamed the product to **cleanup** everywhere.
- Bound Node to `0.0.0.0:$PORT` for Render.
- Added `/healthz`, graceful shutdown, security headers, request/body limits and static path protection.
- Added Render Blueprint configuration and server-only Gemini secrets.
- Added AI and lookup rate limits.
- Added deterministic safety overrides and stronger frontend/backend contract tests.
- Added PWA shell, service worker and responsive mobile layout.

## 0.2.0 — Connected workflow

- Connected analysis to the selected material and nearby facility search.
- Added address fallback when GPS is unavailable.
- Added material-aware facility ranking instead of generic recycling pins.
- Added large-image browser compression.
- Added selected-facility workflow and safer action recording.
- Separated real results from clearly labelled demo fallbacks.

## 0.1.0 — First web MVP

- Rebuilt the concept as a browser-based Node/vanilla-JS application rather than porting the old Android Java UI.
- Added camera/file upload, Gemini multimodal analysis, deterministic disposal guidance, nearby recycling search, demo pickup/history and local impact UI.
- Kept Gemini keys on the server.
- Used OpenStreetMap/Overpass for facility discovery.

## Pre-repository research phase

Before `cleanup` existed, two old projects were inspected as **product/behavior references**:

- an abandoned Android waste-management prototype that demonstrated camera classification, manual pickup and local order-history concepts;
- an abandoned web recycling-locator prototype that demonstrated address → geocode → nearest recycling location flow.

The useful concepts were combined and substantially rebuilt around a new architecture: Gemini multimodal understanding, deterministic safety rules, material-aware routing, privacy-safe server proxies, Render deployment, PWA behavior, and signed action proofs. The raw source trees of those projects are intentionally **not included** in this repository.
