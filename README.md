# t-Sandwich — Order Display

Calendar-driven display for the weekly sandwich order. Pick a day on the left, see the
per-collection breakdown on the right. On a computer you can also edit quantities, import
a week from a screenshot, and sync so everyone else sees the same data.

React + Vite front end, Netlify serverless functions, Netlify Blobs for shared storage.

Repo: https://github.com/nathapon188/t-sandwich

## Access model

Order data is **not** in the front-end bundle. It is served by `netlify/functions/orders.mjs`,
which compares the caller's key against the `WSH_KEY` environment variable before returning
anything. The key never reaches the browser bundle.

Two ways in:

- Open the site and type the key into the gate.
- Share a link with the key in it: `https://<site>/?key=YOUR_KEY`. The app strips the key
  from the address bar on load and keeps it in `sessionStorage` for that tab only.

This is shared-secret access, not per-user login. **One key does everything** — anyone with
the link and key can view, edit, import and sync. Treat it like a password and rotate it if
it spreads too far.

## What you can do

| Action | Desktop | Mobile |
|---|---|---|
| Browse the calendar, view any day's breakdown | yes | yes |
| Week summary, price list, print a day sheet | yes | yes |
| Edit quantities, add or delete a day | yes | no |
| Import a week from a screenshot | yes | no |
| Sync, restore an earlier version, export JSON | yes | no |

Mobile is deliberately view-only — phones get a single-column layout, larger calendar tap
targets, and wrapping item names so nothing scrolls sideways. The editing and import code
is not mounted at all below 760px, so a stray tap cannot change an order.

## Editing and syncing

1. Switch on **Edit mode**. Quantities become number inputs (full sandwiches; halves stay
   derived as full x 2).
2. Changes are local until you press **Sync changes**. The header shows "Unsaved changes"
   until then, and closing the tab warns you.
3. Syncing writes to Netlify Blobs, so everyone with the link and key sees it immediately.

**Conflicts:** each save sends the version you loaded. If somebody else synced in the
meantime the save is rejected with a clear message rather than overwriting their work —
press Reload, then redo your change.

**History:** every sync snapshots the version it replaced (last 40 kept). Restore loads an
old version into the editor; it only goes live once you sync it.

## Importing from a screenshot

Press **Import from image**, then paste (Ctrl+V), drop, or choose a screenshot of the order
spreadsheet. The image is sent to `netlify/functions/import-image.mjs`, which asks Claude
(`claude-opus-5`) to transcribe it and return structured JSON.

Because the sheet only names weekdays, you pick which week those weekdays belong to. The
result is shown for review before anything changes, along with:

- items or collection times that could not be matched
- cells that were redacted or unreadable (set to 0, never guessed)
- rows whose printed price or half count disagrees with this app's figures

Applying replaces the whole order for each day listed, then you sync as usual. Images are
downscaled in the browser to 2576px on the long edge (Claude's maximum useful resolution)
and capped at 4 MB.

**Cost:** roughly a few cents per image at `claude-opus-5` rates ($5 per million input
tokens, $25 per million output). A full-resolution screenshot is up to ~4,800 input tokens.

## Local development

```bash
npm install
cp .env.example .env      # then set WSH_KEY, and ANTHROPIC_API_KEY if you want image import
npm run dev
```

`npm run dev` runs Vite and serves `/api/*` from `dev-server/middleware.mjs`, which calls
**the same handlers as the Netlify functions** with a local file store (`data/.local-store/`,
git-ignored) standing in for Netlify Blobs. Local and production behaviour cannot drift.

Without `ANTHROPIC_API_KEY` everything works except image import, which returns a clear
error saying so.

Other scripts: `npm run build`, `npm run preview`, `npm run dev:netlify` (needs the Netlify CLI).

## Deploying to Netlify

1. Push this repo to GitHub.
2. In Netlify, "Add new site" > "Import an existing project" > pick the repo.
3. Build settings come from `netlify.toml`. No changes needed.
4. Site configuration > Environment variables:
   - `WSH_KEY` — the shared access key
   - `ANTHROPIC_API_KEY` — only needed for image import
   Do **not** prefix either with `VITE_`; that would expose them in the browser bundle.
5. Deploy. Netlify Blobs needs no setup — it is provisioned with the site.

## Data

`data/orders.json` is the **seed**: what the app serves before anything has ever been synced.
Once a sync happens, Netlify Blobs is the live source and the seed is no longer read.

- `catalogue` — items, unit price per **full** sandwich, `gf` flag, `halves: false` for items
  with no half option.
- `slots` — the collection times.
- `orders` — keyed by date (`YYYY-MM-DD`), then slot id, then item id. Quantities are **full**
  sandwiches; halves are derived as full x 2 for display.

Every document sent to the server is validated (known items and slots, whole-number
quantities 0–9999, `YYYY-MM-DD` date keys) before it is stored.

## Data assumptions

Taken from the source spreadsheet. Verified totals: Mon 17/08/2026 $188.00,
Tue 18/08/2026 $194.50, Wed 19/08/2026 $201.50.

- Halves are always full x 2 in the source data, so they are derived rather than stored.
- Unit prices back-solved from the sheet: Ham and Cheese $7.00, Chicken and Lettuce $7.50,
  Vegetarian $6.50, Gluten-free Chicken and Lettuce $8.00.
- Dairy Free Fruit cups are $0.00 with no half option (blacked-out cell in the sheet).
- Gluten-free Ham and Cheese ($8.00) and Gluten-free Vegetarian ($7.50) are **assumed**.
  All quantities for those two are zero in the seed, so no total is affected. Correct them
  in `data/orders.json` if the real prices differ.

## Layout

```
data/orders.json              seed order data
server/core.mjs               validation, load/save, snapshots, key comparison
server/extract.mjs            Claude vision call + structured-output schema
server/handlers.mjs           transport-agnostic request handlers
server/store-blobs.mjs        Netlify Blobs adapter (production)
server/store-file.mjs         local file adapter (dev)
netlify/functions/            orders, snapshots, import-image
dev-server/middleware.mjs     serves /api/* during npm run dev
src/lib/                      date and totals maths, API client, edit ops, import mapping
src/components/               Calendar, WeekSummary, PriceList, DayDetail, SlotCard,
                              SyncBar, HistoryCard, ImportDialog, KeyGate
prototype/standalone.html     original single-file mock-up, kept for reference
```
