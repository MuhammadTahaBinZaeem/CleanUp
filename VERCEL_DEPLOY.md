# Deploying cleanup to Vercel

This guide explains how to deploy **cleanup** on [Vercel](https://vercel.com) in minutes.

---

## Quick Deploy Options

### Option 1: Import GitHub Repository in Vercel Dashboard

1. Push your code to your GitHub repository.
2. Go to [vercel.com/new](https://vercel.com/new).
3. Import your **CleanUp** repository.
4. Set the **Framework Preset** to `Other`.
5. Under **Environment Variables**, add:
   - `FEATHERLESS_API_KEY`: Your Featherless AI API key (get one from [featherless.ai](https://featherless.ai)).
   - `ACTION_RECEIPT_SECRET`: A secure random string for HMAC cryptographic attestation receipts (e.g., generated with `openssl rand -hex 32`).
   - `NODE_ENV`: `production`
6. Click **Deploy**.

---

### Option 2: Deploy Using the Vercel CLI

1. Install the Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Log in and deploy:
   ```bash
   vercel
   ```

3. Add environment variables:
   ```bash
   vercel env add FEATHERLESS_API_KEY
   vercel env add ACTION_RECEIPT_SECRET
   ```

4. Deploy to production:
   ```bash
   vercel --prod
   ```

---

## Required Environment Variables

| Variable | Description | Required | Example |
| :--- | :--- | :--- | :--- |
| `FEATHERLESS_API_KEY` | Vision AI inference key | Optional (Demo analysis works without key) | `fl_...` |
| `ACTION_RECEIPT_SECRET` | Persistent HMAC signing secret for server attestation | Recommended (auto-generated in memory if omitted) | `a7f39...` |
| `NODE_ENV` | Environment mode | Optional | `production` |
| `HOST` | Binding address | Optional | `0.0.0.0` |

---

## Verification After Deployment

Once deployed, verify your deployment:
- Health check: `https://your-app.vercel.app/healthz`
- API health check: `https://your-app.vercel.app/api/health`
- Web UI: `https://your-app.vercel.app/`
