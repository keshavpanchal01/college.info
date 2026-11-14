# Seatwise – Testing Report

Run on 14 Nov 2026 against your real `all.csv` (2,658 rows). Backend tests: `node tests/worker.test.mjs` (38 checks). Browser tests in real Chrome: `node tests/browser.test.mjs` (71 checks). **All 109 passed, no console errors.**

## Files

**Modified:** `index.html` (only the parts for requirements 1–8 and 11; header, colours, table, pager, footer and CSV parser are unchanged).
**Created:** `worker/worker.js`, `worker/wrangler.toml`, `worker/package.json`, `DEPLOYMENT.md`, `TESTING_REPORT.md`, `tests/` (test scripts and screenshots).
**Copied unchanged:** `all.csv`.

## The six institute types (read from all.csv)

| Type (derived from Course) | Records |
|---|---|
| Diploma Government | 456 |
| Diploma Private | 701 |
| Diploma Public Sector | 12 |
| DNB Government | 528 |
| DNB Private | 946 |
| DNB Public Sector | 15 |

They are computed by code from the Course text after dropping NBE, Bond, Stipend, PDF (and the stray number in `..._Stipend_1.pdf`); the typo "DIiploma" is read as "Diploma". Nothing is hardcoded, so a new type in a future CSV would appear automatically. Each filter count above matched the CSV exactly.

## What was tested and works

- **Filters** individually and combined: type, state, bond years, bond penalty, BED, stipend year + greater-than. Counts matched an independent count of the CSV.
- **Search:** middle-of-name matches ("hosp", "Ramachandra"), upper/lower case, several words, spaces ignored, works together with other filters.
- **Sorting:** bond years low→high, click again high→low (toggles); stipend and BED sorts unchanged.
- **Clear All:** resets search, stipend year/amount, BED, all four dropdowns and sorting.
- **CSV:** loaded fresh on every visit (cache-busting). A replaced CSV with different values, quotes, commas and ₹ formatting rebuilt all dropdowns and rows with no code change. A missing CSV shows a clear error.
- **Pages:** nav order Home → Premium → Contact; Contact shows only 🩺 and seatwise01@gmail.com; all four policy pages and the footer links open.
- **Layout:** desktop and 375px mobile, no sideways page scroll (screenshots in `tests/`).
- **Backend security (simulated Google and Razorpay):** forged signatures rejected; fake/failed/wrong-amount payments rejected; one account cannot claim another's order; one payment cannot unlock two accounts; the amount is fixed at ₹10 on the server; tampered session tokens rejected; premium survives sign-out and returns on sign-in with the same Google account; webhook signature checked.
- **Premium page (browser, simulated services):** sign-in, username, cancelled payment, failed payment, backend verification failure (no success is claimed), success with ✓, sign-out, restore on sign-in, reload.
- **Secrets:** no Razorpay secret, Google secret or Supabase key appears in any project file.

## What I could NOT test (needs your accounts)

- A **real Google sign-in** (needs your site origin added in Google Cloud, Step 2) and a **real ₹10 Razorpay payment** (needs your live account activated). Google and Razorpay were simulated, so please do one real test after deploying, as described at the end of `DEPLOYMENT.md`.
- Deploying the Worker and GitHub Pages themselves.

## Things you should know

- **Rotate your keys.** The Razorpay Key Secret and the other secrets were pasted into chat. See the top of `DEPLOYMENT.md`.
- **Policies:** I could not find Zynerd's own policy pages through search, so I wrote them from the usual structure of education-platform policies and Indian law (IT Act 2000, DPDP Act 2023, Consumer Protection Act 2019). They state only what the site actually does. Have them looked over by a lawyer before relying on them. I did not invent a company name, address, registration or court city.
- **Refund policy** uses the cautious wording I proposed (no refunds for change of mind; refunds for duplicate/failed-activation/error charges). Change it if you want a different practice.
- **Premium has no stated benefits or expiry** because you did not specify any; the pages say only that membership is linked to the Google account.
- **Usernames** are unique ignoring case; two people choosing the same name at the exact same instant could in theory collide (very unlikely at this scale).
- **Search** keeps its existing behaviour of also matching the state and course text, in addition to the institute name.
