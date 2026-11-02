# collegeinfo.neetpg

## Deploy

1. Create the Cloudflare Pages project `collegeinfo-neetpg` and an R2 bucket named `collegeinfo-neetpg-private-data`. Keep the bucket private.
2. Upload the original, verified `all.csv` to that bucket as `all.csv`. It must contain these exact column headings (case-insensitive): `Course, State, Institute, Stipend Year 1, Stipend Year 2, Stipend Year 3, Bond Years, Bond Penalty, BED`.
3. Apply `supabase/migrations/0001_schema.sql` in the Supabase SQL Editor. Enable Google as a Supabase Auth provider and add the deployed site URL plus its `/` callback to the Google OAuth and Supabase redirect allowlists.
4. Set the Cloudflare Pages R2 binding exactly as in `wrangler.toml`. Add these Pages secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Keep service-role and Razorpay secrets server-side only.
5. In Razorpay, configure a webhook to `https://YOUR-SITE-DOMAIN/api/payment/webhook`, subscribe to `payment.captured`, and use the same webhook secret in Cloudflare. Test mode works with `rzp_test_` credentials; live payments require live credentials and Razorpay activation.
6. Install dependencies with `npm install`, then publish with `npm run deploy`. For local preview use `npm run dev` after configuring `.dev.vars` and the R2 binding.

## Dataset and access model

The supplied conversation contained only the original `index.html`; it did not contain `all.csv`, so the real institute dataset is intentionally not fabricated or bundled. The site reads it from private R2 through the Pages Function. Anonymous/free responses contain original rows only when the original Institute field has A, B, or C as its literal first character (case-insensitive; leading whitespace does not qualify); all other rows are replaced server-side with redacted lock rows. The original restricted values are never sent to a free browser. Authenticated premium users receive the full dataset only after the Worker confirms a captured ₹1 Razorpay payment or a valid captured-payment webhook.

The SQL migration denies browser access to account, payment, and entitlement tables. Do not expose the Supabase service-role key, Razorpay secret, or webhook secret in `public/`, GitHub, or browser code.
