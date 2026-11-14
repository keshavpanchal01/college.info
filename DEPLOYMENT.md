# Seatwise – Deployment Guide (for beginners)

You will set up three things, in this order:

1. **Backend** (a free Cloudflare Worker) – checks Google sign-in, verifies Razorpay payments, remembers who is Premium.
2. **Google** – tell Google which website may use your sign-in.
3. **Website** (GitHub Pages) – upload the files.

Supabase is **not used** anywhere. Ignore any Supabase keys.

---

## Before you start: rotate the secrets you pasted in chat

The Google client secret, Supabase secret key and Razorpay **Key Secret** were pasted into a chat, so treat them as exposed.

- **Razorpay:** Dashboard → Account & Settings → API Keys → Regenerate Live Key. You get a **new Key ID and new Key Secret**. Use the new ones in the steps below (put the new Key ID in `worker/wrangler.toml`, the new Key Secret in Step 1.6). This is the only one that matters for safety.
- **Google client secret:** this website does not use it at all. You can reset it in Google Cloud Console → APIs & Services → Credentials.
- **Supabase:** unused. Delete the project or rotate its keys.

---

## Step 1 – Backend (Cloudflare Worker)

1. Create a free account at https://dash.cloudflare.com/sign-up.
2. Install Node.js (LTS) from https://nodejs.org.
3. Open a terminal (Windows: "Command Prompt"; Mac: "Terminal") and go into the `worker` folder of this project:
   `cd path/to/seatwise/worker`
4. Log in: `npx wrangler login` (a browser window opens; click Allow).
5. Create the storage: `npx wrangler kv namespace create SEATWISE`
   It prints an `id = "..."`. Open `worker/wrangler.toml` in Notepad and replace `REPLACE-WITH-KV-NAMESPACE-ID` with that id.
6. In the same file, replace `https://REPLACE-WITH-YOUR-GITHUB-USERNAME.github.io` with your site's origin, for example `https://rahul.github.io` (only the part up to `.github.io`, no `/seatwise`, no trailing slash).
7. Store the secrets (each command asks you to paste the value, then press Enter):
   - `npx wrangler secret put RAZORPAY_KEY_SECRET` → paste your Razorpay **Key Secret**
   - `npx wrangler secret put SESSION_SECRET` → paste any long random text (40+ characters, e.g. mash the keyboard). Keep it private.
8. Deploy: `npx wrangler deploy`
   It prints your Worker address, like `https://seatwise-api.yourname.workers.dev`. **Copy it.**
9. Test it: open that address in a browser. You should see `{"ok":true,"service":"seatwise-api"}`.

### Optional (recommended): payment safety net

If a buyer pays but closes the tab before the website confirms, this webhook still gives them Premium.

1. Razorpay Dashboard → Account & Settings → Webhooks → Add New Webhook.
2. URL: `https://YOUR-WORKER-ADDRESS/webhook`. Choose any secret text. Tick events **payment.captured** and **order.paid**.
3. Run `npx wrangler secret put RAZORPAY_WEBHOOK_SECRET` and paste the same secret text.

---

## Step 2 – Google sign-in

1. https://console.cloud.google.com → your project → APIs & Services → Credentials → open your existing **OAuth 2.0 Client ID** (the one ending `...apps.googleusercontent.com`).
2. Under **Authorized JavaScript origins** click Add URI and enter your site origin, e.g. `https://rahul.github.io` (same value as in Step 1.6). Save.
3. No redirect URI and no client secret are needed. (The old Supabase callback URL is not used.)
4. OAuth consent screen: set it to **In production** if you want everyone (not just test users) to sign in.

Changes can take a few minutes to start working.

## Step 3 – Website (GitHub Pages)

1. Open `index.html` in Notepad, find the line
   `var API_BASE = '';`
   and put your Worker address between the quotes, e.g.
   `var API_BASE = 'https://seatwise-api.yourname.workers.dev';`
   Save. (Or send me the address and I will do it for you.)
2. On GitHub, create a repository (or use your existing one) and upload **`index.html`** and **`all.csv`** to the top level (not inside a folder). The `worker`, `tests` and `.md` files are optional for the website; keeping them there is harmless (they contain no secrets).
3. Repository → Settings → Pages → Source: "Deploy from a branch" → Branch `main`, folder `/ (root)` → Save.
4. After a minute or two your site is live at `https://USERNAME.github.io/REPOSITORY/`.

## Updating the data every day

Replace `all.csv` in the GitHub repository (Add file → Upload files → same name → Commit). Nothing else.
GitHub Pages republishes in roughly 1–2 minutes; after that every visitor gets the new file automatically (the page asks for a fresh copy on every load). The Course, State, Bond Years and Bond Penalty dropdowns rebuild themselves from the new file. The CSV must keep the same nine column headings.

---

## Settings reference

| Name | Where to set it | Secret? | Value |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | `worker/wrangler.toml` (already filled) and `index.html` (already filled) | No (public) | your `...apps.googleusercontent.com` ID |
| `RAZORPAY_KEY_ID` | `worker/wrangler.toml` | No (public) | `rzp_live_...` |
| `ALLOWED_ORIGIN` | `worker/wrangler.toml` | No | `https://USERNAME.github.io` |
| KV namespace `SEATWISE` | `worker/wrangler.toml` | No | id from Step 1.5 |
| `RAZORPAY_KEY_SECRET` | `npx wrangler secret put` | **Yes** | Razorpay Key Secret |
| `SESSION_SECRET` | `npx wrangler secret put` | **Yes** | long random text |
| `RAZORPAY_WEBHOOK_SECRET` | `npx wrangler secret put` (optional) | **Yes** | same text as in Razorpay webhook |
| `API_BASE` | `index.html` | No | your Worker address |

Never put a secret in `index.html`, `wrangler.toml` or GitHub.

## First live test

Razorpay live payments need your Razorpay account to be fully activated (KYC done). Sign in, choose a username, click **Buy Premium – ₹10**, pay ₹10, and the ✓ should appear next to your username. Sign out and sign in again with the same Google account; the ✓ returns. If you need your ₹10 back, refund it from the Razorpay dashboard.
