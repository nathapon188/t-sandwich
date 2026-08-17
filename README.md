# t-Sandwich — Order Display

Calendar-driven display for the weekly sandwich order. Pick a day on the left, see the
per-collection breakdown on the right.

Built with React + Vite. Deploys to Netlify as a static site plus one serverless function
that gates access behind a shared key.

Repo: https://github.com/nathapon188/t-sandwich

## Access model

The order data is **not** in the front-end bundle. It is served by
`netlify/functions/orders.mjs`, which compares the caller's key against the `WSH_KEY`
environment variable before returning anything. The key never reaches the browser bundle.

Two ways in:

- Open the site and type the key into the gate.
- Share a link with the key in it: `https://<site>/?key=YOUR_KEY`. The app strips the key
  from the address bar on load and keeps it in `sessionStorage` for that tab only.

This is shared-secret access, not per-user login. Anyone with the link and key sees
everything, so treat the key like a password and rotate it if it spreads too far.

## Local development

```bash
npm install
cp .env.example .env      # then edit WSH_KEY
npm run dev
```

`npm run dev` runs Vite and serves `/api/orders` from a small dev middleware in
`vite.config.js`, so local behaviour matches production without needing the Netlify CLI.
Edits to `data/orders.json` are picked up on the next request, no restart needed.

If you have the Netlify CLI installed and want to exercise the real function:

```bash
npm run dev:netlify
```

Other scripts: `npm run build` (outputs to `dist/`), `npm run preview`.

## Deploying to Netlify

1. Push this repo to GitHub.
2. In Netlify, "Add new site" > "Import an existing project" > pick the repo.
3. Build settings come from `netlify.toml` (build `npm run build`, publish `dist`,
   functions `netlify/functions`). No changes needed.
4. Site configuration > Environment variables > add `WSH_KEY` with your key.
   Do **not** prefix it with `VITE_` — that would expose it in the browser bundle.
5. Deploy. Every push to the default branch redeploys.

## Updating orders

All data lives in `data/orders.json`:

- `catalogue` — items, unit price per **full** sandwich, `gf` flag, `halves: false` for
  items with no half option.
- `slots` — the collection times.
- `orders` — keyed by date (`YYYY-MM-DD`), then slot id, then item id. Quantities are
  **full** sandwiches; halves are derived as full x 2 for display.

Commit the change and push; Netlify rebuilds and the new data is live.

## Data assumptions

Taken from the source spreadsheet. Verified totals: Mon 17/08/2026 $188.00,
Tue 18/08/2026 $194.50, Wed 19/08/2026 $201.50.

- Halves are always full x 2 in the source data, so they are derived rather than stored.
- Unit prices back-solved from the sheet: Ham and Cheese $7.00, Chicken and Lettuce $7.50,
  Vegetarian $6.50, Gluten-free Chicken and Lettuce $8.00.
- Dairy Free Fruit cups are $0.00 with no half option (blacked-out cell in the sheet).
- Gluten-free Ham and Cheese ($8.00) and Gluten-free Vegetarian ($7.50) are **assumed**.
  All quantities for those two are zero in the current data, so no total is affected.
  Correct them in `data/orders.json` if the real prices differ.

## Layout

```
data/orders.json           order data (the single source of truth)
netlify/functions/orders.mjs  key-gated API
src/lib/orders.js          date and totals helpers
src/lib/api.js             fetch + key handling
src/components/            Calendar, WeekSummary, PriceList, DayDetail, SlotCard, KeyGate
prototype/standalone.html  original single-file mock-up, kept for reference
```
