# Flimp PM Hub — Project Instructions

## What this project is

A unified internal project management tool for Flimp, an animation/video production company. This replaces a ClickUp workflow with a custom-built web app that consolidates eight tools — project management, email inbox, timeline/Gantt, project info, email templates, metrics, invoices, distribution emails, and closeout — into a single interface organized around a flight-progress-strip (fps) UI per project.

This is a solo-user internal tool. There is no multi-user support, no auth layer, no row-level security. The sole user is Andrew (Willis) at Flimp.

---

## Tech stack

- **Frontend:** Vanilla JS ES modules + Alpine.js 3 (via CDN, no build step)
- **Persistence:** Supabase (Postgres), accessed via Vercel serverless functions — credentials never exposed client-side
- **Deployment:** Vercel (static files + `/api/` serverless functions)
- **Fonts:** Calibri as primary font everywhere (`font-family: Calibri, sans-serif`). No Google Fonts, no decorative imports unless explicitly requested.
- **No framework, no npm, no build tooling** on the frontend

---

## File structure

```
/flimp-pm/
├── index.html
├── css/
│   └── main.css
├── js/
│   ├── app.js
│   ├── db.js
│   ├── utils.js
│   ├── data/
│   │   └── constants.js
│   ├── components/
│   │   ├── sidebar.js
│   │   ├── strip.js
│   │   └── modals.js
│   └── panels/
│       ├── subtasks.js
│       ├── emails.js
│       ├── invoices.js
│       ├── closeout.js
│       ├── timeline.js
│       ├── info.js
│       ├── templates.js
│       ├── metrics.js
│       └── distro.js
└── api/
    ├── projects.js
    ├── tasks.js
    └── [other Vercel serverless functions]
```

---

## Architecture principles

### Alpine.js store as AppState
`js/app.js` registers a single Alpine store (`Alpine.store('app', {...})`) that is the source of truth for all UI state. All components read from and write to this store. No component manages its own persistent state — local Alpine state is for UI-only concerns (e.g. which row in a table is being edited).

```js
// app.js pattern
document.addEventListener('alpine:init', () => {
  Alpine.store('app', {
    projects: [],
    currentFilter: 'all',
    gmailEmails: [],
    get filteredProjects() { ... },
    updateProject(id, field, value) { ... },
    setPanel(id, panel) { ... },
  });
});
```

### db.js as the only persistence layer
Nothing outside `db.js` talks to Supabase or makes fetch calls to `/api/`. All other files call `db.js` functions only. This makes the Supabase migration and any future backend changes a single-file concern.

```js
// db.js — all data operations go here
export async function loadProjects() { ... }
export async function saveProject(project) { ... }
export async function deleteProject(id) { ... }
```

### Serverless proxy pattern
Browser → `/api/projects.js` (Vercel function) → Supabase. Supabase credentials live only in Vercel environment variables (`SUPABASE_URL`, `SUPABASE_KEY`). A shared secret header (`x-api-key`) gates all API endpoints. The frontend reads this from a build-time constant or Vite env var.

### Panels as self-contained Alpine components
Each file in `panels/` exports a single Alpine component function that receives a `projectId`, looks up the project from the store, and manages its own panel. Panels do not reach into each other.

```js
// panels/invoices.js pattern
window.invoicesPanel = function(projectId) {
  return {
    get project() { return this.$store.app.projects.find(p => p.id === projectId); },
    get invoices() { return this.project?.invoices || []; },
    addInvoice() { ... },
    updateInvoice(idx, field, value) { ... },
  }
}
```

### No render() function
There is no manual `render()` call anywhere in the codebase. DOM updates happen through Alpine reactivity — `x-show`, `x-for`, `x-text`, `:class`, `x-model`. If you find yourself writing `element.innerHTML = ...` or `document.createElement(...)` outside of a one-time setup, stop and use an Alpine binding instead.

---

## Data model (Supabase)

### `projects` — master record
```
id, client_name, project_name, pm_name, status, phase,
kickoff_date, due_date, oe_start_date,
gmail_labels (jsonb), clickup_task_id,
tags (jsonb), io (bool), branding (bool),
estimate_link, dropbox_link, zoho_link,
latest_comment, next_activity,
active_panel, notes,
created_at, updated_at
```

### `tasks` — subtasks per project
```
id, project_id, name, io (bool), tags (jsonb),
days_left, due_date, phase, new_or_update,
product_type, product_tier, designer, animator,
vo_talent, sort_order, created_at
```

### `invoices` — per project
```
id, project_id, invoice_number, label,
amount, status (draft/sent/paid/overdue),
issued_date, due_date, paid_date, notes
```

### `closeout` — per project (jsonb object, keyed by item index)
Stored as a JSONB column on the project record — not a separate table. Simple key/value of `{ 0: true, 1: false, ... }` mapping to `CLOSEOUT_ITEMS` array in `constants.js`.

### `email_drafts`
```
id, project_id, draft_type, subject, body, sent_at, created_at
```

### `documents` — kickoff docs and other generated docs
```
id, project_id, doc_type, content (jsonb), version, created_at, updated_at
```

---

## Key constants (in `js/data/constants.js`)

All of these are extracted from the existing single-file tool and live here:

- `STATUS_CYCLE` and `STATUS_LABELS` — project status values and display names
- `PHASE_LABELS` — production phase display names
- `PRODUCT_TIER_MAP` — product type → available tiers mapping
- `DESIGNER_LIST`, `ANIMATOR_LIST`, `VO_LIST` — staff dropdowns
- `CLOSEOUT_ITEMS` — ordered array of closeout checklist items
- `TAG_COLORS` — tag label → color mapping
- `PRODUCT_TYPES` — available product type options

---

## The fps strip

The core UI unit. Each project renders as a horizontal flight-progress-strip with:

- **Color tab** on left edge — color reflects project status
- **fps-body** — project name, Gmail label badge, status select, and scrollable field row (I/O checkbox, tags, latest comment, next activity, days left, due date, OE start, AM, estimate link, Dropbox link, branding checkbox)
- **tool-grid-wrap** — 3×3 grid of panel launcher buttons, spans full strip height
- **fps-actions-wrap** — `+ Subtask`, `Edit`, `✕` buttons, spans full strip height

The 3×3 grid layout:
```
Subtasks  | Inbox    | Timeline
Info      | Templates| Metrics
Invoices  | Distro   | Closeout
```

Clicking a grid button sets `activePanel` on the project and expands the corresponding panel below the strip. Clicking the active button collapses it. Only one panel open per project; multiple projects can be open simultaneously.

---

## Panel descriptions

| Panel | File | Contents |
|---|---|---|
| Subtasks | `panels/subtasks.js` | Task table — name, I/O, tags, days left, due date, phase, new/update, product type, product tier, designer, animator, VO |
| Inbox | `panels/emails.js` | Gmail threads assigned to this project via label matching |
| Timeline | `panels/timeline.js` | Gantt chart + feasibility check (port of existing Timeline Tool) |
| Info | `panels/info.js` | Contacts, Zoho link, Dropbox link, estimate link, key reference fields |
| Templates | `panels/templates.js` | Email draft builder + kickoff doc generator |
| Metrics | `panels/metrics.js` | Activity log, days per phase, project health |
| Invoices | `panels/invoices.js` | Invoice table — number, label, amount, status, dates |
| Distro | `panels/distro.js` | Distribution email builder — contacts pre-fill from project |
| Closeout | `panels/closeout.js` | Checklist + AP storyboard export |

---

## PDF generation

PDFs are generated client-side on demand from stored data — never stored in Supabase. The database holds the structured record; the PDF is rendered fresh each time from that data. This applies to kickoff docs, timeline exports, and AP storyboard exports.

Generation approach: client-side via `jsPDF` or `pdfmake` for simple layouts; Vercel serverless function with Puppeteer for pixel-accurate HTML-to-PDF exports where layout fidelity matters.

---

## Supabase / persistence notes

- **No Row Level Security** — solo user, not needed
- **No auth layer** — no login screen, no session management
- **Credentials** — `SUPABASE_URL` and `SUPABASE_KEY` in Vercel env vars only, never in client JS
- **Auto-save pattern** — changes debounce ~1000ms then write to Supabase via `/api/`. AppState updates immediately (optimistic), Supabase write fires in background
- **On load** — app fetches all projects from Supabase, hydrates Alpine store. `localStorage` stores only the last-viewed project ID so the app reopens in context
- **Free tier safe** — dataset is text/JSON only, no file uploads, well within 500MB storage and 5GB bandwidth limits

---

## Existing tools to port (in order of priority)

1. **Subtasks** — already in v3, needs Alpine conversion
2. **Invoices** — already in v3, needs Alpine conversion
3. **Inbox/Emails** — already in v3, needs Alpine conversion
4. **Closeout** — already in v3, needs Alpine conversion
5. **Timeline** — existing standalone tool (`flimp-timeline-tool`), port into `panels/timeline.js`
6. **Templates** — email drafts + kickoff doc, new build
7. **Info** — contacts + reference links, new build
8. **Distro** — distribution email builder, existing tool to port
9. **Metrics** — activity log view, new build

---

## Style notes

- Design language: the existing ClickDown tool. Dark accent (`#08212D` Flimp Blue), green highlight (`#7DFA65` Flimp Green), clean flat UI with subtle borders, compact information density
- Status colors are fixed: production = red, kickoff = gray, limbo = amber, done = purple, closed = green
- All interactive tables use `border-collapse: separate` with per-cell borders — not row striping
- Font: **Calibri, sans-serif** everywhere. No exceptions unless explicitly requested
- Grommet (corner dot) is a Flimp brand element — small filled circle, used in exports and formal documents

---

## What to avoid

- Do not use `document.createElement` or `innerHTML` assignment for reactive UI — use Alpine bindings
- Do not hardcode Supabase credentials anywhere in client-side files
- Do not add Google Fonts or external font imports
- Do not build multi-user features, auth, or RLS — this is a solo tool
- Do not store generated PDFs in Supabase — generate on demand from data
- Do not call Supabase directly from frontend JS — always go through `/api/` proxy
- Do not write a monolithic `render()` function — panels are self-contained Alpine components
