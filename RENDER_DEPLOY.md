# Deploy cleanup on Render

Repository: `https://github.com/MuhammadTahaBinZaeem/CleanUp`

cleanup is a single Node web service. No database, disk, worker or cron job is required for the current MVP.

## 1. Deploy the repository

The repository already contains `render.yaml`. In Render, create a new Blueprint from:

```text
https://github.com/MuhammadTahaBinZaeem/CleanUp
```

The Blueprint creates a Node web service named `cleanup` in the Singapore region, runs the full check suite during build, starts with `npm start`, uses `/healthz`, and enables automatic deploys from commits.

## 2. Add Featherless secrets

Render will ask for these because they are `sync: false`:

```text
FEATHERLESS_API_KEY
FEATHERLESS_API_KEY
FEATHERLESS_API_KEY
```

Only key 1 is required. Keys 2 and 3 are optional failover slots.

Model defaults are non-secret:

```text
```

You can change model names in Render without changing code.

## 3. Signed action proof secret

The Blueprint contains:

```text
ACTION_RECEIPT_SECRET = generateValue: true
```

Render therefore generates a persistent strong secret for signed item/facility/plan/completion receipts. Do not replace it casually after people have created receipts: rotating it intentionally invalidates old signed proof.

For local development, set a stable random value with at least 32 characters if receipts should survive process restarts.

## 4. Location-service settings

The Blueprint includes:

```text
NOMINATIM_MIN_INTERVAL_MS=1100
GEOCODE_CACHE_MS=86400000
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org/search
OVERPASS_URL=https://overpass-api.de/api/interpreter
OUTBOUND_QUEUE_MAX=25
```

cleanup serializes/throttles public Nominatim work, caches geocoder results and bounds queued/external response work.

Browser location/address lookups use POST JSON to cleanup, so the user's query/coordinates are not placed in cleanup's own public request URL. The external location provider still receives the location because it is required for the requested search.

## 5. Featherless reliability settings

The default Blueprint also sets bounded failover values, including:

```text
FEATHERLESS_ATTEMPT_TIMEOUT_MS=15000
FEATHERLESS_TOTAL_TIMEOUT_MS=45000
FEATHERLESS_QUOTA_COOLDOWN_MS=60000
FEATHERLESS_ACCESS_COOLDOWN_MS=900000
FEATHERLESS_RESPONSE_MAX_BYTES=2097152
```

The browser wait budget is longer than the server's bounded failover budget so the UI does not normally abandon a request while the server is still rotating routes.

## 6. Verify after deployment

Open:

```text
https://YOUR-SERVICE.onrender.com/healthz
```

Expected shape for this release:

```json
{"ok":true,"service":"cleanup","version":"1.0.0"}
```

Then open:

```text
https://YOUR-SERVICE.onrender.com/api/health
```

Confirm Featherless is configured if you entered a key. This endpoint must never contain the actual key values.

## 7. Browser smoke test

1. Load the built-in demo.
2. Select the battery and confirm a non-matching/unknown destination cannot be selected as a valid special-handling destination.
3. Upload a real image and confirm cleanup shows the actual Featherless model that answered.
4. Search a city/area; if several geocoding results appear, choose one explicitly.
5. Pick a live material-matched facility and save a scheduled drop-off.
6. Confirm a future action shows `Scheduled` rather than an active completion button.
7. After its scheduled time, mark it complete and confirm the signed completion can be revalidated in Impact.
8. Confirm the UI still says physical handoff is self-reported.
9. Test at phone width and verify the bottom navigation remains usable.

## 8. Important proof limitation

Server-attested does **not** mean recycler-verified. It means cleanup signed the matched workflow and acknowledged completion after the scheduled time. A future recycler/QR/provider integration would be required to prove physical handoff independently.
