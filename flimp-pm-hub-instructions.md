# Frequency Tower — Project Instructions

> Describes the app **as built**. Where something is planned but not implemented,
> it says so explicitly. Repo name is still `flimp-pm-hub`; the product name is
> **Frequency Tower**.

## What this project is

A unified internal project management tool for Flimp, an animation/video
production company. It replaces a ClickUp-centred workflow with a custom web app
that consolidates nine tools — subtasks, email inbox, timeline, project info,
email templates, metrics, invoices, distribution emails, and closeout — into a
single interface organized around a flight-progress-strip (fps) UI per project.

Solo-user internal tool. No auth layer, no multi-user support, no row-level
security. The sole user is Andrew (Willis) at Flimp.

---

## Tech stack

- **Frontend:** Vanilla JS ES modules. No build step, no bundler, no npm on the
  frontend.
- **Alpine.js 3.14.1** via jsdelivr CDN — a *thin shell*, not the rendering
  engine. See "Alpine's actual role" below.
- **Persistence:** Supabase (Postgres) behind Vercel serverless functions.
  Credentials never reach the client.
- **Deployment:** Vercel — static files plus `/api/` functions. `package.json`
  exists only to give the serverless functions `@supabase/supabase-js`.
- **Fonts:** **Montserrat** (Google Fonts, loaded in `index.html`). Calibri is a
  fallback in the font stack, not the primary face.
- `vercel.json` only pins the `Content-Type` header for `/js/*` so native ES
  modules load correctly.

Native ES modules require the page be served over http(s) — `vercel dev`, not
`file://`.

---

## File structure

```
/flimp-pm-hub/
├── index.html                 static chrome: topbar, rail, 6 modals, popups
├── vercel.json                Content-Type header for /js/*
├── package.json               @supabase/supabase-js (server-side only)
├── css/
│   └── main.css               ~1900 lines, light "control room" theme
├── js/
│   ├── alpine.js              entry point — boots Alpine, imports app.js
│   ├── app.js                 module graph + global listeners + init()
│   ├── bus.js                 the `A` namespace object (register/lookup)
│   ├── state.js               `ui` — cross-module view state
│   ├── store.js               `db` state singleton + load()/save()
│   ├── render.js              render() + row mutators + detail panel
│   ├── utils.js               pure helpers (esc, dates, CSV, snippets)
│   ├── reorder.js             native HTML5 drag-and-drop for both tables
│   ├── clickup.js             ClickUp assign/unassign modals
│   ├── sync.js                the two header sync buttons
│   ├── data/
│   │   ├── constants.js       option lists + applyReference()
│   │   └── seed.js            demo dataset / offline fallback
│   ├── components/
│   │   ├── sidebar.js         filters, rail lists, banners
│   │   ├── strip.js           status popup menu
│   │   └── modals.js          date popup, project modal, task modal
│   └── panels/
│       ├── subtasks.js  emails.js   invoices.js
│       ├── closeout.js  metrics.js  timeline.js
│       ├── info.js      templates.js  distro.js
├── api/
│   ├── db.js                  Supabase proxy (GET/POST whole db)
│   ├── sync-clickup.js        ClickUp → clickup_tasks
│   ├── sync-gmail.js          Gmail labels → workspace.gmail_label_defs
│   ├── sync-gmail-threads.js  Gmail threads → workspace.gmail_emails
│   └── hello.js               health check
├── supabase/
│   └── 2026-07-23-gmail-threads.sql
└── templates/
    └── strip.html             reference markup for the fps strip
```

**Note:** `api/db.js` comments refer to a `schema.sql` that is not in this repo —
only the one migration file is checked in. The live schema is the source of
truth. `css/main.css` likewise refers to a `main.css.dark-backup` that no longer
exists.

---

## Architecture

### The `A` bus — cross-module function namespace

`js/bus.js` exports a single mutable object `A` and a `register()` helper. Every
module calls `register({ ...its public functions })` at module load. Cross-module
calls go through `A.fnName()`, which resolves at *call* time.

This exists because the call graph is genuinely mutual — `render()` calls panel
builders, panel handlers call `render()` — which would be an import cycle if
expressed as static ES `import`s. `app.js` then does `Object.assign(window, A)`
so the inline `on*` attributes in `index.html` and in `render()`'s generated HTML
strings resolve by bare name, and also exposes `window.A` for handlers written as
`A.fnName(...)`.

**Adding a module:** write it, call `register({...})` at the bottom, and add a
side-effect `import './your-module.js'` to `app.js`. Nothing else wires it up.

### `store.js` — the only persistence layer

Exports one mutable `db` object (deep-cloned from `SEED_DB`) plus `load()` and
`save()`. Nothing else in `js/` fetches. **Named `store.js`, not `db.js`, on
purpose** — it used to be `js/db.js` and collided with `api/db.js`; putting the
serverless file in `js/` makes the browser choke on the bare
`@supabase/supabase-js` specifier and the whole module graph dies before
`render()` runs, so the board silently never draws.

- `save()` is **debounced 400ms trailing**, fire-and-forget. Call sites
  throughout the app do `save(); render();` and none of them await — that
  contract is deliberate, so failures log rather than throw and a network hiccup
  can't break the UI someone is working in. A `beforeunload` handler flushes a
  pending save via `sendBeacon`.
- `load()` GETs `/api/db`, `Object.assign`s onto `db` in place (so the exported
  reference stays valid), then calls `applyReference()` to overwrite the
  hardcoded option lists with the Supabase reference tables. On failure it logs
  loudly and falls back to the `SEED_DB` clone already in `db`.
- `backfillInfoFields()` runs unconditionally after every load, adding missing
  Info-panel keys to each row. New per-row fields go in `ITEM_FIELD_DEFAULTS` or
  `PROJECT_FIELD_DEFAULTS` here — adding them to `seed.js` alone will not reach
  existing data, because `load()` replaces `rows` wholesale.
- `dailyIOReset()` clears every row's `io` flag on the first open of a new day.
  `localStorage` holds exactly one key (`flimp_last_open`) for this — it is a
  per-device marker, not project data.

### `render.js` — one imperative full-page render

`render()` clears `#list-wrap` and rebuilds the entire board: status sections,
every project strip, every open panel. It's called after mutations from 12 other
modules — 33 `A.render()` call sites, plus the internal ones in `render.js`
itself. At current row counts this is fast and correctness is easy to reason
about — **the full re-render is not the problem, the hand-written exceptions to
it are** (see "Known rough edges").

`render.js` also owns the cross-cutting row mutators (`uf`, `setStatus`,
`toggleField`, `toggleTag`, `deleteRow`) and the slide-out detail panel
(`openDetail` / `closeDetail`).

### `state.js` — cross-module view state

ES module live bindings are read-only for importers, so the three pieces of view
state multiple modules must *write* live on one mutable `ui` object:
`ui.currentFilter`, `ui.detailId`, `ui.sectionState`.

### Alpine's actual role

Alpine currently does three small things (`js/alpine.js`):

1. Owns startup — `<body x-data="flimpApp" x-init="boot()">` defers one
   microtask, then calls `init()` from `app.js`.
2. Registers `ui` as `Alpine.store('ui', ui)` so markup *can* bind reactively.
3. Provides the `flimpApp` `x-data` object.

**`db` is a plain object and is not reactive.** Alpine cannot observe project
data today. Any binding over project data needs `db` wrapped in
`Alpine.reactive()` first — see "Direction of travel".

### Panels are HTML-string builders, not Alpine components

Each `panels/*.js` module exports (via `register()`) either mutation handlers or
a `xxxPanelHtml(parent)` function returning a string. `render.js` mounts them:

```js
const infoWrap = document.createElement('div');
infoWrap.className = 'info-wrap' + (activePanel !== 'info' ? ' hidden' : '');
if (activePanel === 'info') infoWrap.innerHTML = A.infoPanelHtml(parent);
```

Large panels (`info`, `timeline`, `distro`) are only built when actually open.
Subtasks, emails, invoices, and closeout are always built and toggled with
`.hidden`.

---

## Data flow

**Boot:** `alpine.js` → Alpine starts → `x-init="boot()"` → `app.init()` →
`await load()` → `dailyIOReset()` → `render()` + `renderGmailSidebar()` +
`renderGmailBanner()` + `renderClickUpSidebar()` + `renderCuBanner()`.

**Edit:** handler mutates `db` in place → `save()` (debounced) → `render()`.
Optimistic; the UI never waits on the network.

**Sync:** the two header buttons POST to a sync endpoint, then call `load()` and
re-render. **Deliberately no `save()` after a sync** — the endpoints own
`clickup_tasks`, `gmail_label_defs`, and `gmail_emails`, and `api/db.js` excludes
those from the client's upsert for exactly this reason. Calling `save()` after a
sync would POST the page's boot-time state back over what just landed.

### Column ownership

| Data | Written by | Client may write? |
|---|---|---|
| `rows` | browser `save()` | yes |
| `workspace.gmail_client_prefix` | browser `save()` | yes |
| `clickup_tasks` | `api/sync-clickup.js` | **no** |
| `workspace.gmail_label_defs` | `api/sync-gmail.js`, `sync-gmail-threads.js` | **no** |
| `workspace.gmail_emails` | `api/sync-gmail-threads.js` | **no** |
| reference tables | edited directly in Supabase | **no** |

---

## Data model

### One flat `rows` table — projects *and* subtasks

There is no separate `tasks` table. Projects are rows with `parentId === null`;
subtasks are rows with `parentId` set to a project id. The same mutators mostly
work on both, and the Info panel edits the same columns the Subtasks table does —
one record, no sync layer.

`api/db.js` splits each row between real Postgres columns and a `data` JSONB
catch-all. `KNOWN_FIELDS` in that file is the list of promoted columns; anything
not in it lands in `data`. **If a field is promoted to a real column in the
schema, add it to `KNOWN_FIELDS` too**, or the proxy keeps filing it under `data`
and the new column stays silently empty. `tags` is intentionally *not* promoted.

Field names are camelCase in the app, snake_case in Postgres, converted
mechanically (`activityLog` ↔ `activity_log`) — no manual mapping table.

Three write-path coercions live in `api/db.js` because HTML inputs produce `""`
where Postgres demands `null`, and one bad value fails the *entire* save:

- `DATE_COLUMNS` — `""` → `null`
- `NUMERIC_COLUMNS` — `""` → `null`
- `NOT_NULL_DEFAULTS` — backfills columns the client left unset

POST semantics are **full replace**: whatever's in the payload is truth, and rows
missing from it are deleted. That is how row deletion reaches the database —
there is no separate delete endpoint. Two guards protect this: duplicate row ids
are rejected with a 409, and the delete step is skipped on an empty payload.

**Row shape** (project rows carry the project-only keys):

```
id, parentId, clickupId, name, status, phase, collapsed, activePanel,
productType, productTier, productStyle, newOrUpdate, am,
startDate, due, oeStart, oeEnd, distributionDate, io, branding, sortOrder,
tags[], comments[], activityLog[], invoices[],
gmailLabels[], designer, animator, voArtist,
totalRevenue, designerCost, animatorCost, voCost, otherVendor1Cost, otherVendor2Cost,
timeline (jsonb|null), closeout (jsonb), distro (jsonb)
```

- **`invoices`** — a JSONB array on the parent row, not a table. Array order *is*
  display order.
- **`closeout`** — `{ [itemIndex]: boolean }` keyed to the `CLOSEOUT_ITEMS` array.
- **`timeline`** — a parsed Timeline Tool export; `null` until one is pasted.
- **`distro`** — working state for the current draft email, not a record of
  what was sent.
- **`sortOrder`** — must be a real column, not a `data` field: `api/db.js` does
  `ORDER BY sort_order` in SQL. Renumbered densely from 10 in steps of 10.

### `workspace` — singleton row (id = 1)

`gmail_client_prefix`, `gmail_label_defs`, `gmail_emails`.

### Reference tables

`people` (with a `role` column: am / designer / animator / vo / owner), `tags`,
`languages`, `product_topics`, `product_types`, `closeout_items`,
`product_options` (with `kind`: tier / style). All filtered on `active` and
ordered by `sort_order`.

`applyReference()` in `constants.js` overwrites the hardcoded lists in place at
load. It only replaces a list when the incoming one is **non-empty**, so a
half-populated table can't blank out a working dropdown. Edit these in Supabase
directly; a page reload picks up the change.

---

## The fps strip

The core UI unit. Each project renders as a horizontal flight-progress strip:

- **`.fps-tab`** — colored left edge; color reflects status, click toggles I/O
- **`.fps-body`** — name + edit pencil + signal-strength bars + Gmail label pills
  + status select, above a scrollable field row (Tags, Latest Comment, Next
  Activity, Days Left, Due Date, OE Start, AM, Zoho, Estimate, Dropbox, Branding)
- **`.tool-grid-wrap`** — 3×3 panel launcher grid, full strip height

```
Subtasks  | Inbox     | Timeline
Info      | Templates | Metrics
Invoices  | Distro    | Closeout
```

Clicking a grid button sets `activePanel` on the row; clicking the active one
collapses it. One panel open per project; multiple projects open at once. The
Inbox button carries an unread dot derived from `labelIds.includes('UNREAD')`.

**Signal-strength bars** are a staleness readout, not decoration: 4 bars =
touched within 2 days, down to 0 bars at 30+ days or never. Derived from the
newest timestamp in `activityLog` or `comments`.

Projects are grouped into collapsible status sections, ordered kickoff →
production → limbo → done → closed, and within a section by due date.

`templates/strip.html` is the externalized reference markup for this strip — the
readable source of truth for its structure, and the migration target if it ever
moves to `<template>` or `x-html` rendering. It is not loaded at runtime.

---

## Panels

| Panel | File | State |
|---|---|---|
| Subtasks | `subtasks.js` | **Built.** Table with drag-reorder; module holds per-task mutators, `render.js` builds the table. |
| Inbox | `emails.js` | **Built.** Gmail threads matched by assigned label; also owns label pills and the assign/manage modals. |
| Timeline | `timeline.js` | **Built as a receiver**, not a Gantt engine. Parses a pasted Timeline Tool export. |
| Info | `info.js` | **Built.** Widest field surface in the app; two scopes (project / item) selected from a left rail. |
| Templates | `templates.js` | **Stub.** File is `export {}`; renders the "Coming soon" card from `render.js`'s `_stubDefs`. |
| Metrics | `metrics.js` | **Panel is a stub**, but the module is live — it powers the activity log and CSV exports in the detail panel. |
| Invoices | `invoices.js` | **Built.** JSONB array with drag-reorder. |
| Distro | `distro.js` | **Built.** Two-template wizard; copy-to-clipboard only. |
| Closeout | `closeout.js` | **Built.** Checklist + progress bar. |

### Timeline — why it asks instead of inferring

A pasted plan says where you're *supposed* to be; it cannot say where you *are*.
An earlier version drew ticks left of TODAY as "past" and counted them as done —
a lie, since a passed date isn't finished work, and being ahead of schedule was
literally unrepresentable. The panel now asks you to select which plan task each
item is actually on, and health is a straight comparison of that task's planned
date against today. Selections live on the timeline object
(`tl.position[subtaskId]`), not on the subtask row, so they die with the plan on
re-paste rather than dangling.

The parser handles three real quirks of the clipboard bytes: merged cells put raw
`\n` *inside* a cell (so lines are not record boundaries — tab count is: 4 fields
= 3 tabs), the title and footer have no tabs and must be peeled off by position
first, and the footer uses NBSP and `·`. Export dates carry no year, so they're
anchored on the title's year and walked forward, rolling the year when a date
goes backwards (OE work routinely runs Nov → Jan).

### Distro — three kinds of template content

The templates aren't flat merges. The panel's real job is telling apart merge
fields, optional blocks (the Video template's six distribution methods, which
**renumber** when some are cut so the client never sees "Option 1, Option 4"),
and instructions-to-self like "REPLACE THIS HYPERLINK" that must **never** reach
the client. Stripping those is the whole value over pasting the raw template.

---

## Integrations

**ClickUp** (`api/sync-clickup.js`) — pulls tasks assigned to Willis via the
"PM+" custom field from one List, full replace-sync into `clickup_tasks`. List
id, field id, and user id are constants at the top of the file; the product
type/tier/style custom fields are matched by *name*. Unassigned tasks surface in
the rail and a banner; assigning one creates a subtask row carrying `clickupId`.
Dropping off the ClickUp list never touches an already-created row.

**Gmail** (`api/sync-gmail.js`, `api/sync-gmail-threads.js`) — a one-time
out-of-band OAuth consent exchanged server-side for short-lived access tokens.
Scope is `gmail.readonly`; nothing here writes to Gmail.

- `sync-gmail.js` — labels only, full replace-sync. The rail's "Sync Labels"
  button is now a fallback, since the threads endpoint refreshes labels first.
- `sync-gmail-threads.js` — one entry per **thread**, storing the union of label
  ids across its messages plus a synthetic `UNREAD` marker. That marker is
  load-bearing: unread styling and the strip's unread dot both key off it.
  Strategy is full backfill once (bounded by `LOOKBACK_DAYS = 90`), then history
  deltas; an expired historyId falls back to a full pull. Backfill is resumable
  and may report `complete: false`, meaning "run again".

A label deleted in Gmail does **not** unassign it from a project — the stale id
stays on the row and renders as a "label moved" pill with a remove affordance. A
label vanishing upstream shouldn't silently rewrite project history.

**There is no cron.** Vercel Hobby rejects a `crons` block in `vercel.json`, so
the header buttons *are* the schedule. (The comment header in
`sync-gmail-threads.js` still claims a 15-minute cron — that is stale.)

---

## Design language

Light "control room" theme. All colors are CSS variables at the top of
`main.css`.

- **Font:** Montserrat throughout, via `--font` / `--font-headline` /
  `--font-display` / `--font-mono` (all currently resolve to Montserrat).
- **Accent:** Frequency Tower brand blue `--signal: #3478DF`, with
  `--signal-soft`, `--signal-deep`, `--signal-tint`, `--signal-glow`.
- **Surfaces:** `--bg #EEF1F4` canvas, `--panel #FFFFFF` raised plates,
  `--panel-2` inset wells. Ink ramps `--ink` → `--ink-4`.
- **Oxblood** (`--oxblood #A8323A`) is reserved for critical/destructive only.
- **Status signal code:** kickoff `#64788A` grey · production `#C32F38` red ·
  limbo `#C99A2E` gold · done `#4A9BD8` light blue · closed `#2F9159` green.
  `--sig-alert #E25A52` is a separate brighter red reserved for overdue.
  *(The comment above these vars in `main.css` says "limbo violet · done teal" —
  stale; trust the hex values.)*
- Tables use per-cell borders, not row striping. Compact information density.
- Grommet (corner dot) is a Flimp brand element for exports and formal documents.

**Class names are load-bearing.** `render.js` and the panel modules generate
markup targeting exact selectors. Restyle freely; renaming a class means editing
the JS that emits it.

---

## Known rough edges

Worth knowing before you touch the relevant code.

**Hand-written partial updates are drifting from `render()`.** To avoid a full
re-render, several places patch the DOM directly — and those patches are second
implementations of rules `render()` already owns. They have already diverged:
`fmtNextActivity` never returns a string starting with "Last" or "Next", so the
initial-render class logic (`render.js` ~line 202) leaves weekday labels and
"5 days ago" unstyled, while the post-edit patch (~line 816) uses different tests
that give "5 days ago" → `past` and "Friday" → `soon`. Set a next-activity date
and the pill picks up styling it loses again on reload. Same shape of risk in
`uf()`'s days-left patch, `closeout.js`'s whole body, and
`datePopupChange()` in `modals.js`.

**Drag-to-reorder is disabled while a filter is active**, on purpose: an index
into a filtered view doesn't address the same record in the full sibling array,
so dragging row 2 of 3 visible when 7 exist would move the wrong subtask. The
handles simply aren't rendered when `ui.currentFilter !== 'all'`.

**`_infoScope` in `info.js` is module-local and not persisted** despite
`setInfoScope()` calling `save()` — the selected Info scope resets on reload.

**Dead code:** `datePopupChange()` looks up `na-lbl-<id>`, but `render.js` gives
the next-activity label no `id`. Harmless today because `A.uf()` updates that
label first via `querySelector`.

---

## Direction of travel — where Alpine bindings would help

Not a mandate; a ranked plan for when the imperative code gets in the way. The
`render()` + `A` bus architecture is fine and does **not** need replacing.

**Prerequisite for anything touching project data:** make `db` reactive in
`store.js` — `Alpine.reactive(structuredClone(SEED_DB))`. `Object.assign(db,
saved)` and `JSON.stringify(db)` both work through the proxy.

**Tier 1 — static chrome in `index.html`; no reactive `db` needed, best ROI.**
The six modals (`modals.js` is 40 `getElementById` calls that only read and write
form fields; `x-model` collapses them, and this absorbs the six overlay listeners
and the Escape chain in `app.js`); the sidebar filter active state and page title
(`ui` is *already* an Alpine store); the two banners (`x-show` + `x-text`); the
Gmail prefix input, whose `!== document.activeElement` guard is exactly what
`x-model` solves.

**Tier 2 — needs reactive `db`, self-contained.** The closeout panel — 18 lines
whose only job is hand-patching DOM `render.js` already builds. The Gmail and
ClickUp rail lists → `x-for`.

**Tier 3 — leave alone.** The strip and subtask table in `render.js`. Entangled
with the DnD handlers `reorder.js` attaches to a live `tbody`, the two-phase
enter/exit animation in `setStatus`, and date-popup anchoring by element id.

---

## Not implemented

Named here so nobody assumes they exist:

- **PDF generation.** No jsPDF, no pdfmake, no Puppeteer. The only export today
  is CSV (activity log, via `utils.downloadCSV`).
- **`x-api-key` / shared-secret gating on `/api/`.** The endpoints are open.
- **Gmail draft creation.** Distro is copy-to-clipboard only; the copy path is
  built so a "create draft" button can slot in beside it when OAuth write scope
  lands.
- **Kickoff doc generator, email draft builder** (the Templates panel).
- **Scheduled syncs.** Manual buttons only.

---

## What to avoid

- Don't hardcode Supabase, ClickUp, or Google credentials in anything under
  `js/` — server-side `api/` files and Vercel env vars only.
- Don't call Supabase directly from the frontend — always through `/api/`.
- Don't add a `js/db.js`. See the naming note under `store.js`.
- Don't call `save()` after a sync. Read back with `load()` instead.
- Don't add a field to a panel without adding it to `store.js`'s field defaults,
  and to `KNOWN_FIELDS` in `api/db.js` if it gets a real column.
- Don't add more hand-written DOM patches to dodge a re-render — that's the one
  pattern already causing bugs. Either call `render()` or convert that piece to
  an Alpine binding.
- Don't build multi-user features, auth, or RLS.
- Don't rename CSS classes without updating the JS that emits them.
