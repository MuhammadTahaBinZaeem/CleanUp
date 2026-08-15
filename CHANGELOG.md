# Changelog

All notable development milestones for **cleanup** are recorded here. The repository begins with the substantially rebuilt web application; it does **not** include raw copies of the older reference repositories used during early product research.

## 0.14.9 — Clear-history generation fencing

- Clearing local history now advances a cross-tab generation marker while scan and action stores are locked.
- Photo/demo analyses capture that generation before network work and still show their result if a clear happens mid-request, but they no longer recreate scan history afterward.
- New-action creation checks the same generation before and after any slow plan-proof request and again inside the final locked write, so an operation that began before a clear cannot repopulate action history.
- The clear UI reports if the tiny cross-tab generation marker itself could not be persisted.
- PWA/server cache identity bumped to 0.14.9.

## 0.14.8 — Shared lookup de-duplication

- Simultaneous identical geocode and facility cache misses now share one upstream request instead of queuing duplicate Nominatim/Overpass calls.
- Each browser request waits on the shared lookup with its own abort signal, so a disconnected tab can stop waiting without cancelling the upstream work for other users.
- Shared upstream lookups still retain their own service timeout and server-shutdown cancellation behavior.
- Failed lookups are removed from the in-flight map and are never cached as successful results.
- PWA/server cache identity bumped to 0.14.8.

## 0.14.7 — Cross-tab action-creation serialization

- The full action-create flow now holds a fingerprint-specific Web Lock across duplicate recheck, optional server plan-proof request, and local insertion where browser locks are available.
- A second tab waiting to create the same action now rechecks history before requesting a duplicate server proof.
- `createdAt` is stamped immediately before insertion rather than before a potentially slow proof request, so a slow network call cannot age the first action out of the 10-second duplicate window before the waiting tab runs.
- PWA/server cache identity bumped to 0.14.7.

## 0.14.6 — Cross-tab proof-operation serialization

- Plan-proof retry, completion, and completion-attestation retry now hold a shared per-action browser lock across the full read → server request → local write operation when Web Locks are available.
- A second tab waiting on the same action re-reads current history after acquiring the lock and skips duplicate proof minting if the first tab already stored the result.
- Final proof writes also require the target receipt slot to remain empty, preventing a stale waiter from replacing a newer receipt.
- PWA/server cache identity bumped to 0.14.6.

## 0.14.5 — Render identity and history-clear race fixes

- Render rate limiting now uses the first `X-Forwarded-For` address, matching Render's documented real-client ordering instead of accidentally selecting a later proxy hop.
- Clearing local history now acquires the same Web Locks-backed scan/action storage locks used by writes, preventing a concurrent tab from restoring stale data during a clear operation where browser locks are available.
- The clear-history button is disabled while the locked deletion is in progress.
- Proof retry controls are disabled when the current deployment is known to use a non-persistent signing secret, avoiding buttons that can only fail.
- PWA/server cache identity bumped to 0.14.5.

## 0.14.4 — Multi-tab history and mutation correctness

- Scan-history writes now use the same Web Locks-backed storage mutation path as action history, preventing concurrent tabs from overwriting each other where browser locks are available.
- Duplicate-action detection is repeated inside the storage lock so simultaneous tabs cannot both insert the same action.
- Plan-proof and completion-proof retry flows now distinguish server success from localStorage success and detect records changed by another tab mid-request.
- Completion writes now detect concurrent no-ops instead of reporting a successful local update that was never stored.
- Local action validation now rejects unknown statuses and requires completed records to carry a canonical completion timestamp at or after the planned time.
- PWA/server cache identity bumped to 0.14.4.

## 0.14.3 — Privacy, proof persistence, and offline upgrade safety

- Legacy GET address/facility lookup routes now return 405; typed addresses, coordinates, and signed item proofs stay in POST JSON bodies instead of URLs.
- Proof-issuing HTTP responses explicitly report whether the signing secret is persistent.
- The frontend refuses to treat restart-sensitive receipts as durable server attestation and explains how to configure `ACTION_RECEIPT_SECRET`.
- Failed service-worker core-cache installation now fails the upgrade instead of activating an incomplete offline shell.
- Service-worker activation deletes only old `cleanup-v*` caches, never unrelated CacheStorage entries on the same origin.
- Oversized declared JSON requests are rejected before buffering.
- Static HEAD responses avoid reading the full file and include an accurate Content-Length.
- PWA/server cache identity bumped to 0.14.3.

## 0.14.2 — Proof-state and recovery hardening

- Corrupted/manual local action records now fail closed before completion or proof-retry operations.
- Pickup records must remain explicitly demo-only, and drop-off history must retain a valid weight and destination.
- Health checks continue at a bounded two-minute cadence after long outages instead of permanently giving up in an open tab.
- Successful receipt verification now marks omitted/tampered stored proofs as invalid instead of leaving them stuck on “checking.”
- Offline proof views avoid a doomed verification request and clearly show revalidation as unavailable.
- Stale/cancelled impact requests can no longer repaint proof state after a newer verification starts.
- Browser fetch failures now surface a stable network message instead of raw “Failed to fetch” errors.
- PWA/server cache identity bumped to 0.14.2.

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
