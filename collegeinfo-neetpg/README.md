# collegeinfo.neetpg

## Deploy

1. In your existing Supabase project, open **Storage**, create a bucket named `college-data`, and keep it **private**. Upload your original `all.csv` to the bucket root. Required CSV headings (case-insensitive): `Course, State, Institute, Stipend Year 1, Stipend Year 2, Stipend Year 3, Bond Years, Bond Penalty, BED`.
2. Apply `supabase/migrations/0001_schema.sql` in the Supabase SQL Editor. Enable Google in Supabase Auth and allow your deployed Pages URL in Supabase and Google OAuth redirect settings.
3. In Cloudflare Pages project settings, add these secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Keep service-role and Razorpay secrets server-side only. Set variables `SUPABASE_STORAGE_BUCKET=college-data` and `DATA_KEY=all.csv`.
4. Deploy the repository as a Cloudflare Pages project with build command blank and output directory `public`. The Pages Functions in `functions/` provide `/api/*`. Alternatively run `npm install` and `npm run deploy` after creating the Pages project.
5. Configure a Razorpay webhook at `https://YOUR-SITE-DOMAIN/api/payment/webhook`, subscribe to `payment.captured`, and set the matching webhook secret in Cloudflare. Test mode works with `rzp_test_` credentials; live payments require live credentials and Razorpay activation.

## Data and access

The supplied project files did not include the original `all.csv`; do not use fabricated data. Upload the real CSV to the private Supabase Storage bucket above. The Pages Function retrieves it server-side using `SUPABASE_SERVICE_ROLE_KEY`, so the storage bucket stays private and the CSV is not a public Pages/GitHub asset. Anonymous/free responses include original rows only when the original Institute field begins with A, B, or C (case-insensitive; leading whitespace does not qualify); other rows are redacted server-side. Premium users receive the full dataset only after server-side verification of a captured ₹1 Razorpay payment or a valid captured-payment webhook.

Never commit `.dev.vars`, API secrets, the service-role key, or the dataset to a public repository.
