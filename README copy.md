# Flimp Project Manager

Multi-file ES-module refactor of the single-file `flimp-pm-v3` build. Vanilla JS
+ Alpine.js 3, deployed to Vercel as static files, persisting to `localStorage`
today (Supabase migration scoped below).

## Running locally

Native ES modules require HTTP (not `file://`):

```bash
vercel dev            # or: npx serve  /  python3 -m http.server
```

Then open the served URL. Opening `index.html` directly will fail (modules + CORS).

## Architecture

The original was one imperative `render()` that rebuilt the list via innerHTML
strings, with ~90 global functions wired through inline `onclick=""` handlers.
That contract is preserved exactly; the code is split by domain, not rewritten.

```
index.html              static markup; <body x-data="flimpApp" x-init="boot()">
css/main.css            all styles (verbatim)
js/
  alpine.js             Alpine 3 entry: registers store + flimpApp, Alpine.start()
  app.js               imports every module (registers handlers), mirrors → window, init()
  bus.js               `A` namespace; cross-module calls go A.fnName() (no import cycles)
  state.js             `ui` = { currentFilter, detailId, sectionState } (writable across modules)
  db.js                `db` state singleton + save()/load()/dailyIOReset()  ← Supabase swap point
  utils.js             pure helpers (esc, dates, snippet builders, CSV)
  render.js            render() orchestrator + row mutators (uf/setStatus/…) + detail panel
  data/
    constants.js       enums, option lists, lookup tables
    seed.js            initial demo dataset
  components/
    sidebar.js         filters, sidebar collapse, Gmail/ClickUp lists + banners
    strip.js           flight-progress-strip status popup menu
    modals.js          date popup, product-tier cascade, project & task modals
  panels/
    subtasks.js  emails.js  invoices.js  closeout.js  metrics.js
    timeline.js  info.js  templates.js  distro.js      (stubs — "Coming soon")
  clickup.js           ClickUp task assign/unassign
templates/
  strip.html           externalized strip markup (reference; render() is the live impl)
```

### Why the `A` bus instead of imports

`render()` calls panel handlers and panel handlers call `render()` — mutual
references that would be circular ES imports. Each module instead registers its
functions onto the shared `A` object (`bus.js`); cross-module calls use
`A.fnName()`, resolved at call time. `app.js` also mirrors `A` onto `window` so
the inline `on*` attributes (and the handler strings generated inside
`render()`) keep working byte-for-byte.

## Supabase migration (not yet started)

All persistence is funneled through `db.js`. Only two function bodies change:

- `save()` → `supabase.from('…').upsert(…)`
- `load()` → `supabase.from('…').select()` then `Object.assign(db, …)`

Every caller already routes through these, so the rest of the app is
storage-agnostic. `dailyIOReset()` and the `flimp_last_open` key can stay
client-side or move server-side as preferred.

## Behavior notes (preserved from original)

- **Two CSS typos fixed.** `..row-dot.is-done` and `..ssl-done` had a leading
  double-dot in the source, making those two rules dead. Corrected to single-dot
  so the "Done" status dot/label colors apply as intended. (The only behavioral
  change in the whole refactor — flag if you'd rather keep them dead.)
- **Latent quirk kept as-is.** The New Task modal's Phase `<select>` in
  `index.html` contains a literal `${Object.entries(PHASE_LABELS)…}` string. It
  was static (non-interpolated) text in the original too, so it renders that
  literal string as an option. Preserved unchanged. One-line fix available:
  populate `#sm-phase` options in `openSubtaskModal()` the way the tier list is.
- **`seed.js` split out** of the data folder rather than living inside
  `constants.js` (~10 KB of demo rows). Easy to inline if you want the tree to
  match the original spec exactly.
- **Alpine is a thin shell.** It owns startup (`x-init`) and exposes `ui` as a
  store for future reactive bindings, but the imperative `render()` pipeline is
  untouched. This is the hybrid integration, not a full directive rewrite.

## Verification

Syntax-checked all 22 modules (`node --check`), statically verified every
import resolves and every `A.*` / inline-handler reference is registered, and
ran a jsdom smoke test exercising init, filtering, detail panel, panel toggles,
invoices, closeout, modals, activity logging, and CSV export.
