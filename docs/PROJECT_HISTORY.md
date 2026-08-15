# cleanup — project history

This file records how the project changed during the build/debug cycle so the Git history starts from the changed combined application without losing the development story.

## 1. Starting point: find a useful abandoned concept

The initial research looked for old, low-activity software that solved a real problem and had enough of a workflow to inspire a stronger beginner-hackathon project. The most useful waste prototype had an Android camera classifier, a separate pickup form and Firestore order history. A second old locator project demonstrated address geocoding and sorting recycling points by distance.

Code inspection showed that the old waste prototype was not a complete implementation of its README claims. Its classifier had only six broad labels, camera recognition was not connected to pickup, pickup used manual categories and hard-coded values, the map location was hard-coded, DIY opened an external blog, donation opened an external form, and there was no real recycler/driver/reward workflow.

## 2. Product decision: do not port the old app

Instead of copying the Android project or its old web locator, the build direction became:

**photo → understand item → deterministic safety decision → compatible nearby destination → planned action → completion → impact**

That became `cleanup`.

The architecture was rebuilt as a small Node 20+ web service plus mobile-first vanilla HTML/CSS/JS PWA. The old source trees are not part of this repository.

## 3. Initial working web MVP

The first working version added:

- camera/file upload;
- Gemini image understanding with structured JSON;
- multiple detected objects;
- deterministic battery/e-waste/medical/hazard overrides;
- OpenStreetMap/Overpass recycling lookup;
- basic pickup/drop-off history;
- local demo fallback;
- server-only Gemini key handling.

Early testing immediately exposed disconnected workflow problems, so analysis, active item, location, facility and action state were joined into one flow.

## 4. Workflow and UI repair phase

Repeated browser and source-level testing fixed:

- stale Gemini responses overwriting a newer photo;
- stale facility searches overwriting a newly selected item;
- large mobile photos failing before analysis;
- missing address fallback when GPS failed;
- result cards with invalid interactive HTML;
- a drop zone that looked interactive but did not actually support drop;
- selected facilities and action drafts leaking between items;
- date calculations using UTC instead of local time;
- demo records contaminating real impact;
- mobile overflow, bottom-nav spacing and map sizing;
- corrupted localStorage crashes;
- PWA stale-cache/version bugs;
- unclear facility acceptance status.

## 5. Gemini reliability phase

The AI layer was changed from one hard-coded key/model to a server-side route pool:

- up to three keys;
- up to three model names;
- legacy single-key/model aliases retained;
- rotate keys for invalid/auth/quota/retryable errors;
- keep model access failures scoped to the key/model pair when appropriate;
- only globally demote a model for real model-not-found conditions;
- remember healthy routes;
- apply cooldowns to failing routes;
- report the actual model that answered;
- never expose secret key values to the browser.

The browser/client timeout was also made longer than the server's bounded failover budget so the UI would not abandon a request while the server was still rotating routes.

## 6. Facility and geocoding hardening

Location behavior was repeatedly tightened:

- material-aware facility compatibility;
- token-boundary matching to avoid accidental substring matches such as PET ↔ carpet;
- explicit battery matching rather than generic electronics acceptance;
- ambiguous address results require a user choice;
- Nominatim calls are serialized, throttled and cached;
- external response sizes and queue depth are bounded;
- request cancellation reaches queued/outbound work;
- location POST routes keep typed address/GPS values out of cleanup's own URL query strings;
- malformed coordinates/distances fail closed instead of coercing booleans/nulls into numbers.

## 7. Render deployment phase

The project was prepared as one Render Node web service:

- `0.0.0.0:$PORT` binding;
- `/healthz` health check;
- Singapore region in `render.yaml`;
- build-time tests;
- graceful shutdown;
- generated action-receipt secret;
- explicit AI/lookup limits;
- no runtime npm dependencies;
- secrets kept out of Git.

## 8. From “completed” to signed workflow proof

A purely local “completed drop-off” could be edited in browser storage, so impact was redesigned.

The lightweight proof chain now works as follows:

1. Gemini analysis is normalized by the server and each analyzed item can receive a signed item proof.
2. A live facility only receives a signed facility proof when its published material tags match the signed item route.
3. Before the scheduled drop-off, cleanup can exchange that facility proof for a signed plan receipt.
4. After the scheduled time, the signed plan can be exchanged for a signed completion receipt using the server's timestamp.
5. The impact panel sends stored completion receipts back to the server and counts only receipts that still validate.
6. Duplicate receipts for one deterministic plan count once.

This is deliberately described as **server-attested workflow completion**, not physical verification. It proves cleanup signed a matched plan and later acknowledged completion; it does not prove a recycler physically received the item.

## 9. Proof and history tamper testing

Further testing fixed cases where locally edited cards could look more trustworthy than their receipt:

- attested badges require server revalidation in the current session;
- displayed item/material/facility/weight/schedule details must still match the signed completion details;
- fake or replaced receipts downgrade immediately;
- future/inconsistent completion timestamps are rejected;
- malformed history fails closed;
- completed actions without a pre-action plan are explicitly **not retroactively attestable**;
- expired/invalid plan proof becomes `Attestation unavailable` instead of showing a futile retry button;
- bounded proof errors are visible in history rather than silently disappearing.

## 10. Abuse, privacy and defensive coding phase

The later passes added:

- image MIME/signature checks before Gemini;
- bounded request bodies and upstream bodies;
- per-client and global AI budgets;
- rate-limit identity hardening for Render forwarding headers;
- same-origin browser API guards;
- static traversal and symlink escape protection;
- non-throwing malformed numeric coercion;
- bounded local history writes;
- multi-tab storage locking where available;
- no API/no-store caching in the service worker;
- deterministic handling of dangerous waste even when model output conflicts;
- no fake calibrated probability display.

## 11. Test milestones

The project was repeatedly expanded only after regression checks were green. During development, visible checkpoints progressed from the first 2 tests to 6, 21, 35, 76, 100, 131 and beyond as additional network, proof, privacy and UI cases were added. The GitHub baseline release retains the coherent consolidated suite in `tests/server.test.js` and runs it in CI.

## 12. Repository baseline

The GitHub repository intentionally starts from the changed combined `cleanup` implementation. It does not contain the raw Android/web reference repositories, generated build outputs from them, their secrets/config files, or their old assets.

See [`../CHANGELOG.md`](../CHANGELOG.md) for release-oriented notes and [`../README.md`](../README.md) for current usage/deployment instructions.
