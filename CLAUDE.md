# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev     # live-server on :7925, entry dgr.html, no browser open
npm start       # same, opens browser
```

There is **no build step, no bundler, no linter, and no test suite**. Files ship exactly as written. Deployment is Vercel-on-push-to-`main` (`vercel.json` rewrites `/` → `/dgr.html`).

Supabase edge functions are deployed separately:

```bash
supabase functions deploy sync-to-sheets
supabase functions deploy fetch-suryalog
```

## What this is

PM KUSUM DGR — a mobile-first PWA where solar site engineers file a **Daily Generation Report** for ~35 sites in Rajasthan. Reports go through pending → approved/rejected review, then sync to a Google Sheet. Live at `dgr-app.vercel.app`.

## Architecture

### No modules — ordered globals

`dgr.html` is the whole SPA. Every JS file is a plain `<script>` tag; there are no `import`/`export` statements and every function and `let` is a browser global. **Load order in `dgr.html` is the dependency graph** and must be preserved:

`app-shell.js` (Supabase client, global state, routing, tabs) → `auth.js` → `dgr-flow.js` → `history-approvals.js` → `admin-insights.js` → `export-offline.js` → `overview.js` → `app-init.js` (runs the IIFE that boots the app)

### Cache busting — bump `?v=N` on every asset

All nine asset refs in `dgr.html` carry `?v=12`. **When you change any file under `assets/`, bump the version on ALL of them together**, not just the file you touched. Field users are on cached PWAs; a partial bump ships a mismatched set. Much of the commit history is exactly this ("fix: bump asset version to v=12 for cache busting").

### Service worker lives inline, not in dgr_sw.js

`app-init.js` builds the real service worker as a **string, wraps it in a Blob, and registers that**; `/dgr_sw.js` is only the fallback if blob registration fails. Editing `dgr_sw.js` alone changes nothing for most users — edit the `swCode` template in `app-init.js` and bump its `CACHE='dgr-vN'` constant. HTML is deliberately never cached; a separate watcher HEAD-polls `/dgr.html` every 5 min and force-reloads when the etag changes.

### Auth is custom, and authorization is client-side only

This does **not** use Supabase Auth. `auth.js` SHA-256s the password in the browser, compares it against `users.password_hash` via an anon-key `select`, and stores the session in `localStorage`. The Supabase URL and anon key are hardcoded in `app-shell.js` — intentional for a static app; real enforcement has to live in RLS policies, not in JS.

Roles are `engineer` | `manager` | `admin` | `director`, ranked in that order by `ROLE_RANK` in `app-shell.js` (`super_admin` is treated as admin, `employee` as engineer — both come from another app sharing the `users` table). Never compare `session.role` to a string; use `isEngineer()` / `isManagerUp()` / `isAdminUp()` / `isDirector()`. The role is cached in the `localStorage` session at login, so a role change in the database only applies after that user logs in again. Role decides bottom tabs (`buildBottomTabs`), which sites are visible (engineers see only `session.assigned_sites`), and hash-route access. Engineers can only edit their own submissions.

### The 10-screen wizard

`goToScreen(n)` hides all screens, shows `#screenN`, and calls `buildScreenN()`, which sets `innerHTML` wholesale. There is no diffing and no framework: **the update pattern is mutate the global `formData`, then call `buildScreenN()` again.** Screens 1–9 are the form (Site & Date, Inverter Generation, Performance, Grid & Plant Outage, Transformer, Cleaning, Weather & Activity, Photos, Review & Submit); 10 is the confirmation with a WhatsApp share message.

Business rule enforced in `goNext()`: a report dated **today cannot be advanced past screen 1 before 18:00** local time.

### Routing

Hash-based, handled by `navTo()`/`handleHashNav()` in `app-shell.js`: `#dgr`, `#history`, `#approvals`, `#insights`, `#overview`, `#admin/<subtab>` (subtabs: dgr, users, sites, approvals, settings, weather, import). Role checks are re-applied on every hash nav.

## Data model

`dgr_submissions` is keyed by **`(site_name, report_date)`** — every write is `upsert(payload, {onConflict:'site_name,report_date'})`. Never plain `insert`.

JSONB array columns, all positional per inverter: `inv_gen`, `inv_strings`, `inv_strings_count`, `inv_modules_cleaned`, `grid_outage_details`, `plant_outage_details`, `image_urls`.

`review_note` is **dual-format**: either a JSON object of `{fieldName: note, general: note}` for field-level rejection, or a plain string. Always parse it through `getFieldNotes()` (`dgr-flow.js`), which normalizes a plain string to `{general: ...}`.

Other tables: `site_config` (capacity, inverter count, strings, lat/lng), `users`, `dgr_settings` (JSONB key-value app config), `scada_*` (populated by `fetch-suryalog`, consumed by `monitor.html`). Storage buckets: `dgr-photos` (public URLs written into `image_urls`), `suryalog-data`.

`supabase/migrations/001_sheets_sync.sql` is **entirely commented out** — it documents DDL already applied out-of-band. The schema is not reproducible from this directory alone; treat migrations as reference, not source of truth.

## Domain formulas — duplicated in four places

Each inverter's DC capacity is **`strings × 15.4 kW`**. From that:

- `dcCuf = kWh / (dc × 24) × 100`
- `loss = ((maxDcCuf − dcCuf) × 24 × dc) / kWh` — relative to the best inverter that day
- Plant-level: `dc_cuf_pct = total/(dc×24)×100`, `ac_cuf_pct = total/(ac×24)×100`, `pr_pct = total/(poa×dc)×100`

These are reimplemented independently in `dgr-flow.js` (`calcDCPerf`), `export-offline.js` (`formatDgrRowForSheet`), `overview.js`, and `supabase/functions/sync-to-sheets/index.ts`. **Changing one requires changing all four**, or the app, the Excel export, and the Google Sheet will disagree.

## Offline & resilience

Three independent layers, all in play:

1. `localStorage` `dgr_draft` — written *before* the network call in `submitReport()`, cleared on success.
2. IndexedDB `dgr_offline_queue` — `saveOffline()` when `navigator.onLine` is false; `syncQueue()` drains it on the `online` event.
3. `localStorage` mirrors of `dgr_sites` and `dgr_app_settings` — `loadSites()`/`loadAppSettings()` fall back to these when Supabase is unreachable. `loadSites()` also seeds `site_config` from the `DEFAULT_SITES` list if the table comes back empty.

Freshness comes from both a Realtime `postgres_changes` subscription on `dgr_submissions` and a 30s poll, plus a `visibilitychange` refresh — all routed through `_refreshCurrentScreen()`.

## Edge functions

- **`sync-to-sheets`** — pulls `status='approved' AND synced_to_sheet=false`, flattens each row to a fixed ~155-column layout (18 scalars + six 20-wide inverter blocks + outage/transformer/weather tail), POSTs to a Google Apps Script web app URL stored in `dgr_settings.sheets_script_url`, then marks rows synced. Triggered manually from Admin → Settings, optionally by pg_cron every 30 min. Column order is load-bearing for the destination sheet.
- **`fetch-suryalog`** — polls the Suryalog SCADA API for a 5-minute window across all sites, archives raw JSON to Storage, parses into `scada_*` tables. Needs `SURYALOG_SECRET` and `SURYALOG_SITES` (JSON array of `{site_name, plant_key}`) as function secrets.

## Tickets (`tickets.js`)

One table, `dgr_tickets`, two lifecycles told apart by `source`:

- **Requests** (engineer-raised): `open → (l1_approved) → approved → closure_requested → closed`, or `rejected`/`cancelled`. Amount-based approval against `dgr_settings.ticket_l2_threshold`. Closure request records `actual_cost`, shown against `approved_amount`.
- **Alerts** (`source='auto'`, raised by database triggers/cron via `auto_raise_ticket()`): `open → acknowledged → resolved`, with `snoozed_until`. No approval. `auto_raise_ticket` dedups against any live ticket for the same rule and site and stays quiet while snoozed.

Any ticket can be assigned (`assigned_to_phone/name/kind`): engineer, manager, or a vendor from `dgr_settings.ticket_vendors` (no login, phone null). `TICKET_LIVE` / `TICKET_DONE` in `tickets.js` are the status sets to use; never list statuses inline. The "Report a problem" quick form sets category Repair and priority medium/high; managers fill the rest with Edit. Home-screen pieces (`buildEngineerJobsCard`, `buildManagerSummary`) live here and are called from `showHomeScreen()`.

## Insights dashboard (`dashboard/`)

The Insights tab (managers and up) is an iframe of `dashboard/index.html?embed`, the Stockwell DGR Dashboard: its own HTML/JS (`engine.js` pure metrics, `ops.js` loss/issues, `app.js` UI, `theme.js`), outside the `assets/` versioning. Treat `engine.js`/`ops.js`/`app.js`/`theme.js`/`index.html` as vendored — the only DGR-specific file is `dashboard/dgr-config.js`, which:

- gates on the `dgr_session` in localStorage (same origin; client-side only, like the rest of the app),
- feeds `DGR_CONFIG.loadRows` entirely from Supabase — no static data files: `dgr_submissions` (non-rejected) merged with `dgr_history` (CUF-workbook generation for site-days with no DGR, `_src:'cuf'`), plus a site master built from `site_config` (capacity, lat/lng, district, tariff, PVsyst, tilt, `peer_sites`, `colocated_sites`), `site_meter_monthly`, and `dgr_settings` keys `insights_seasonal` / `insights_rename`. Every manager sees every site,
- holds back trailing days until 80% of the usual site count has filed, because the dashboard reads its latest date as a complete day,
- then loads the dashboard scripts in order.

`insights_rename` is `{"map": {}}`: Insights shows DGR-app site names (Gajroopdesar -1 is the 4 MW plant; the budget sheet names the pair the other way round, and the map can swap them for display if that ever changes). A new site needs `peer_sites` in `site_config` to get a "vs nearby plants" benchmark. When any dashboard file changes, bump `VER` in `dgr-config.js`, the `?v=` on its script tag in `dashboard/index.html`, and the `&v=` on the iframe src in `admin-insights.js`.

## Standalone pages

`monitor.html` (SCADA live dashboard, dark theme, reads `scada_*` directly) and `appraisal.html` (self-contained annual appraisal page) are independent of the DGR app — separate HTML, own inline CSS/JS, not part of the `assets/` bundle or its versioning.
