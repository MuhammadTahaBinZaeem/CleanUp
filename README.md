# 🌿 CleanUp — AI Waste Assistant & Attested Recycling System

[![Node.js](https://img.shields.io/badge/Node.js-20%20--%2024-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/Tests-179%20Passing-emerald.svg)](tests/server.test.js)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Deployment](https://img.shields.io/badge/Deploy-Render%20%7C%20Vercel-success.svg)](VERCEL_DEPLOY.md)

> **Know what to do with *anything* you are about to throw away.**
> Take a photo. CleanUp identifies the item, flags hazardous or special disposal requirements, generates actionable safety instructions, locates nearby recycling facilities with OpenStreetMap, and seals completed actions with server-signed cryptographic proofs.

---

## 📸 Visual Showcase & Workflow

```
[ 📷 Waste Photo ] ──▶ [ 🧠 Vision AI & Deterministic Safety Rules ]
                                │
                                ▼
                       [ 🏷️ Disposal Action Plan ]
                                │
                                ▼
                [ 📍 Nearby OpenStreetMap Facilities ]
                                │
                                ▼
             [ 📝 Plan Action & Server HMAC Pre-Attestation ]
                                │
                                ▼
            [ ⏱️ Complete Drop-off & Signed Impact Proof ]
```

---

## ✨ Key Features & Capabilities

- **Smart Multimodal AI Vision**: Upload photos or capture directly from camera. Large images are resized in-browser before upload to conserve bandwidth.
- **Deterministic Safety Overrides**: Hardened categorization overrides for hazardous items (lithium/alkaline batteries, e-waste, medical waste, sharp objects, and hazardous chemicals).
- **Server-Attested Drop-Off Proofs**: HMAC-SHA256 signed attestation chain linking recognized materials, matching facilities, scheduled plan receipts, and completion certificates.
- **Privacy-First Geolocation & Facility Matching**: Reverse geocoding via Nominatim with strict server-side rate limiting, query caching, and POST payloads to keep coordinates out of query strings.
- **Modern Flat UI Aesthetic**: Curated flat color palettes (emerald, mint, forest pine, crisp slate), Plus Jakarta Sans typography, and rich visual graphics.
- **Zero-Dependency Core**: Lightweight vanilla JavaScript, modern CSS, and native Node.js HTTP server.
- **PWA & Offline Fallback**: Service Worker shell caching with full offline demo fallback mode.
- **Deploy Anywhere**: Pre-configured for both **Render** (via `render.yaml`) and **Vercel** (via `vercel.json`).

---

## 🔒 Cryptographic Attestation Chain

CleanUp does **not** falsely claim physical possession of waste without recycler hardware; instead, it provides a tamper-evident workflow attestation chain:

1. **Item Proof**: Analyzed waste items receive a server-signed HMAC payload binding the material name and route tags.
2. **Facility Proof**: Facilities matching the signed material tags receive a signed compatibility token.
3. **Plan Receipt**: Scheduled drop-offs receive a pre-action plan receipt before the scheduled time.
4. **Completion Receipt**: Upon completion after the planned time, the server mints a verified completion receipt.
5. **Impact Audit**: Impact totals only count receipts that successfully re-verify against the server signing secret.

---

## 🚀 Quickstart & Local Setup

### Prerequisites
- Node.js `20.x` or `22.x` / `24.x`
- npm `10+`

### Installation & Run

1. **Clone the repository**:
   ```bash
   git clone https://github.com/MuhammadTahaBinZaeem/CleanUp.git
   cd CleanUp
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   ```

3. **Install and verify**:
   ```bash
   npm ci
   npm run check
   ```

4. **Start local development server**:
   ```bash
   npm start
   ```

5. **Open in browser**:
   ```text
   http://localhost:3000
   ```

> [!NOTE]
> Without a Featherless API key, the full demo analysis mode works seamlessly out of the box.

---

## 🌐 Deploy to Production

### Deploying to Vercel
See the complete [Vercel Deployment Guide](VERCEL_DEPLOY.md).

1. Import the repository into [Vercel](https://vercel.com).
2. Set Environment Variables:
   - `FEATHERLESS_API_KEY`: Your vision inference key.
   - `ACTION_RECEIPT_SECRET`: HMAC key for signing attestation receipts.
   - `NODE_ENV`: `production`
3. Deploy!

### Deploying to Render
See the complete [Render Deployment Guide](RENDER_DEPLOY.md).
- Automated single-service deployment configured via [`render.yaml`](render.yaml).

---

## 🧪 Testing & Verification

Run the full automated test suite (179 passing tests):

```bash
# Run unit and integration tests
npm test

# Run syntax check and full test suite
npm run check
```

### Health Endpoints
- `GET /healthz` — Service liveness check.
- `GET /api/health` — Safe configuration and model route availability status.

---

## 📄 License & Documentation

- [Changelog](CHANGELOG.md) — Detailed release history.
- [Vercel Guide](VERCEL_DEPLOY.md) — Step-by-step Vercel instructions.
- [Render Guide](RENDER_DEPLOY.md) — Render Blueprint deployment.
- [Project History](docs/PROJECT_HISTORY.md) — Architectural notes and engineering history.
