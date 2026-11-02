# collegeinfo.neetpg — deploy notes

```
wrangler.toml          Worker + static-assets config (name: collegeinfo-neetpg)
src/index.js           Backend API (data delivery, username, Razorpay, webhook)
data/all.csv           PRIVATE data — bundled into the Worker, never served as a file
public/index.html      The website (only this + _headers are public)
supabase/schema.sql    Run once in Supabase → SQL Editor
```

## 1. Secrets (Cloudflare → Workers → collegeinfo-neetpg → Settings → Variables and Secrets, type "Secret")
Or from a terminal: `npx wrangler secret put NAME`

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` (no `/rest/v1`) |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` (server only) |
| `RAZORPAY_KEY_ID` | `rzp_test_...` |
| `RAZORPAY_KEY_SECRET` | Razorpay key secret |
| `RAZORPAY_WEBHOOK_SECRET` | any long random string you choose; use the same one in the Razorpay webhook |

Google Client ID/Secret belong **only** in Supabase (Authentication → Providers → Google), not in Cloudflare.

## 2. Supabase
1. SQL Editor → paste `supabase/schema.sql` → Run.
2. Authentication → URL Configuration: Site URL = your live URL; Redirect URLs = the live URL with a trailing `/` (and `http://localhost:8787/` for local tests).
3. Google OAuth client (Google Cloud) → Authorised redirect URI = `https://<project-ref>.supabase.co/auth/v1/callback`.

## 3. Razorpay webhook (test mode first)
Dashboard → Developers → Webhooks → Add: URL `https://<your-live-host>/api/webhook`, secret = `RAZORPAY_WEBHOOK_SECRET`, events `payment.captured`, `order.paid`, `payment.failed`.

## 4. Deploy
`npm install` then `npx wrangler deploy` (or connect the repo to Cloudflare Workers Builds). Keep the Git repo **private** — `data/all.csv` is in it.

To update the data: replace `data/all.csv`, redeploy.
To change the price: edit `PRICE_PAISE` in `src/index.js` (100 = ₹1), redeploy.
