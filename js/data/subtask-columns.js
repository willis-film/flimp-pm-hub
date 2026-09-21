// subtask-columns.js — the subtask sheet's column definitions.
//
// The sheet used to be two hardcoded lists that had to agree by position: a
// <thead> string and a <td> sequence per row, sixteen columns each, coupled by
// nothing but their order. Adding, removing or reordering a column meant
// editing both the same way, and a mismatch produced a header naming a
// different column than the cell under it — silent, and only visible if you
// happened to read across the row.
//
// Here each column carries its header and its cell together, and SUBTASK_COLS
// at the bottom is the ordered list of which ones show. render.js builds
// <thead> and <tbody> from that one list, so the two can no longer drift apart,
// and hiding, showing or moving a column is a one-line edit to the list.
//
// IMPORTS ARE DELIBERATELY NARROW. render.js imports this file, so importing
// render.js back would close a module cycle. Anything a cell needs from the
// render layer arrives through `ctx` instead.
//
// `ctx` is built ONCE PER PARENT by render.js and passed to every cell in that
// sheet — see the note on cell() below.

import { esc, fmtDate, daysLeft, tagsHtml, fmtRelTime } from '../utils.js';
import {
  PHASE_LABELS, PRODUCT_TYPE_LIST, PRODUCT_TIER_MAP, PRODUCT_STYLE_MAP,
  DESIGNER_LIST, ANIMATOR_LIST, VO_LIST
} from './constants.js';
import { A } from '../bus.js';

// The reference lists above are MUTATED in place by applyReference() at load,
// never reassigned (see the note in constants.js). Reading them inside a cell
// body — rather than capturing them at module scope — is what makes a cell
// pick up the Supabase-backed values on the next render.

const SELECT_STYLE = 'font-family:var(--font);font-size: 12px;color:var(--text);background:none;border:none;outline:none;cursor:pointer;width:100%;max-width:150px';

// The people-list dropdowns (designer/animator/VO) are the same control three
// times over, differing only in field and option list.
function taskSelect(task, field, list) {
  const val = task[field] || '';
  return `<select style="font-family:var(--font);font-size: 12px;color:var(--text);background:none;border:none;outline:none;cursor:pointer;width:100%;max-width:130px" onchange="A.ufTask('${task.id}','${field}',this.value)">
          <option value="">—</option>
          ${list.map(n => `<option value="${n}"${val === n ? ' selected' : ''}>${n}</option>`).join('')}
        </select>`;
}

// Link cells: stored URLs may lack a protocol, so prefix one for the href.
function linkTo(v, text, cls = 'fps-link') {
  const href = (v.startsWith('http') ? '' : 'https://') + esc(v);
  return `<a class="${cls}" href="${href}" target="_blank" rel="noopener" title="${esc(v)}">${text}</a>`;
}
// Review edits through its popover (openLinkPair, subtasks.js).
const keyOpen = id =>
  `onclick="A.openLinkPair('${id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();A.openLinkPair('${id}')}"`;

// ── THE REGISTRY ─────────────────────────────────────────────────────────────
//
// Each entry:
//   label   — header text
//   thAttr  — attributes on the <th>; this is where the column's width lives
//   tdAttr  — attributes on the <td>. A string, or a function of the task when
//             the cell needs a per-row handler on the <td> itself.
//   cell(task, ctx) — the cell's inner HTML
//
// A cell must not assume it is rendered. Any code elsewhere that reaches into a
// cell by element id has to tolerate that id being absent, because a column is
// only in the DOM while SUBTASK_COLS lists it.

export const SUBTASK_COLUMNS = {

  name: {
    label: 'Name',
    thAttr: 'class="th-name"',
    tdAttr: 'class="td-name"',
    cell: (task, ctx) => `
          <div class="name-inner">
            <!-- Handle occupies the existing 18px toggle-spacer, so adding
                 drag costs no horizontal layout change. Dragging is bound to
                 the handle rather than the row because the row's cells hold
                 inputs and selects, and a draggable ancestor makes selecting
                 text inside them fight the drag. -->
            <div class="toggle-spacer">${ctx.canReorder ? `<span class="drag-handle" title="Drag to reorder">⠿</span>` : ''}</div>
            <div class="row-dot is-${task.status}" onclick="A.openStatusMenu('${task.id}',event)" title="Set status"></div>
            <span class="task-name-text" onclick="openDetail('${task.id}')" style="${task.io ? 'font-style:italic;color:var(--text2)' : ''}">${esc(task.name)}</span>
          </div>`
  },

  io: {
    label: 'I/O',
    thAttr: 'class="th-io"',
    tdAttr: 'style="text-align:center"',
    cell: task => `<div class="cb${task.io ? ' on' : ''}" onclick="A.toggleTaskIO('${task.id}')"></div>`
  },

  tags: {
    label: 'Tags',
    thAttr: 'class="th-tags"',
    tdAttr: '',
    cell: task => tagsHtml(task.tags)
  },

  days: {
    label: 'Days Left',
    thAttr: 'class="th-days"',
    tdAttr: '',
    cell: task => {
      const tdl = task.due ? daysLeft(task.due) : null;
      return tdl !== null
        ? `<span class="${tdl < 0 ? 'overdue' : ''}">${tdl}</span>`
        : `<span class="dash">—</span>`;
    }
  },

  due: {
    label: 'Due Date',
    thAttr: 'class="th-due"',
    tdAttr: 'style="position:relative"',
    cell: task => `
          <span class="fps-next-label${task.due && daysLeft(task.due) < 0 ? ' past' : ''}" id="tdue-lbl-${task.id}" onclick="A.openTaskDatePicker('${task.id}','due','tdue-lbl-${task.id}')" style="cursor:pointer;font-size: 12px">${fmtDate(task.due) || '—'}</span>
          <input type="date" id="tdue-inp-${task.id}" value="${task.due || ''}" onchange="A.ufTask('${task.id}','due',this.value);A.updateTaskDueLbl('${task.id}')" style="position:absolute;opacity:0;width:0;height:0;top:0;left:0">`
  },

  phase: {
    label: 'Phase',
    thAttr: 'class="th-phase"',
    tdAttr: 'style="position:relative"',
    cell: task => `
          <!-- max-width is a ceiling only; the real constraint is the cell's
               content box (~129px at the current .th-phase width), so the
               longer labels ellipsize and the title is how you read them. -->
          <select title="${esc(PHASE_LABELS[task.phase] || '')}" style="font-family:var(--font);font-size: 12px;color:var(--text);background:none;border:none;outline:none;cursor:pointer;width:100%;max-width:150px;text-overflow:ellipsis" onchange="A.ufTask('${task.id}','phase',this.value)">
            <option value="">—</option>
            ${Object.entries(PHASE_LABELS).map(([k, v]) => `<option value="${k}"${task.phase === k ? ' selected' : ''}>${v}</option>`).join('')}
          </select>
          <!-- Failure indicator, taken OUT of the flow: absolutely positioned
               so it costs the cell nothing while empty, which is the normal
               case. Reserving inline space for it instead left ~14px of dead
               air on every row and just read as a badly-set column width.
               When it does appear it overlays the tail of the select — a few
               pixels of an ellipsis, on a row that's already telling you
               something is wrong. -->
          ${task.clickupId ? `<span id="cu-phase-ind-${task.id}" style="position:absolute;right:2px;top:50%;transform:translateY(-50%);line-height:1">${A.phaseIndicatorHtml(task.id)}</span>` : ''}`
  },

  cu: {
    label: 'CU',
    thAttr: 'style="width:92px"',
    tdAttr: 'style="text-align:center"',
    cell: task => {
      // clickupUrl first — that's ClickUp's own URL, copied onto the row
      // by submitAssignCuTask(). Falling back to deriving it from the id
      // covers every row assigned before that copy existed: those carry
      // only clickupId, so reading clickupUrl alone left this column
      // empty for every real synced subtask.
      const cuUrl = task.clickupUrl || (task.clickupId ? `https://app.clickup.com/t/${task.clickupId}` : '');
      if (!cuUrl) return '<span class="dash">—</span>';
      // Label reads off the linked URL, not clickupId, so the text can
      // never name a different task than the href points at.
      return `<a href="${esc(cuUrl)}" target="_blank" style="font-size:12px;color:var(--accent);text-decoration:none;font-family:var(--font-mono)" title="${esc(cuUrl)}">${esc(cuUrl.split('/').pop())}</a>`;
    }
  },

  update: {
    label: 'New/Update',
    thAttr: 'class="th-update"',
    // The whole cell is the click target, so the handler lives on the <td>.
    tdAttr: task => `style="cursor:pointer" onclick="A.cycleNewUpdate('${task.id}')" title="Click to cycle"`,
    cell: task => task.newOrUpdate === 'New'
      ? '<span class="pill pill-blue">New</span>'
      : task.newOrUpdate === 'Update'
        ? '<span class="pill pill-orange">Update</span>'
        : '<span class="dash">—</span>'
  },

  type: {
    label: 'Product Type',
    thAttr: 'class="th-type"',
    tdAttr: '',
    cell: task => `
          <select style="${SELECT_STYLE}" onchange="A.ufTaskAndRender('${task.id}','productType',this.value)">
            <option value="">—</option>
            ${PRODUCT_TYPE_LIST.map(t => `<option value="${t}"${task.productType === t ? ' selected' : ''}>${t}</option>`).join('')}
          </select>`
  },

  tier: {
    label: 'Product Tier',
    thAttr: 'class="th-tier"',
    tdAttr: '',
    cell: task => {
      const tiers = PRODUCT_TIER_MAP[task.productType] || [];
      if (!tiers.length) return `<span class="dash">—</span>`;
      return `<select style="${SELECT_STYLE}" onchange="A.ufTask('${task.id}','productTier',this.value)">
              <option value="">—</option>
              ${tiers.map(t => `<option value="${t}"${task.productTier === t ? ' selected' : ''}>${t}</option>`).join('')}
            </select>`;
    }
  },

  style: {
    label: 'Product Style',
    thAttr: 'class="th-style"',
    tdAttr: '',
    cell: task => {
      const styles = PRODUCT_STYLE_MAP[task.productType] || [];
      if (!styles.length) return '<span class="dash">—</span>';
      return `<select style="font-family:var(--font);font-size:12px;color:var(--text);background:none;border:none;outline:none;cursor:pointer;width:100%;max-width:150px" onchange="A.ufTask('${task.id}','productStyle',this.value)">`
        + '<option value="">—</option>'
        + styles.map(s => `<option value="${s}"${task.productStyle === s ? ' selected' : ''}>${s}</option>`).join('')
        + '</select>';
    }
  },

  designer: { label: 'Designer', thAttr: 'class="th-designer"', tdAttr: '', cell: task => taskSelect(task, 'designer', DESIGNER_LIST) },
  animator: { label: 'Animator', thAttr: 'class="th-animator"', tdAttr: '', cell: task => taskSelect(task, 'animator', ANIMATOR_LIST) },
  vo:       { label: 'VO Artist', thAttr: 'class="th-vo"',      tdAttr: '', cell: task => taskSelect(task, 'voArtist', VO_LIST) },

  distdate: {
    label: 'Dist. Date',
    thAttr: 'class="th-distdate"',
    tdAttr: 'style="position:relative"',
    cell: task => `
          <span class="fps-next-label" id="dist-lbl-${task.id}" onclick="A.openTaskDatePicker('${task.id}','distributionDate','dist-lbl-${task.id}')" style="cursor:pointer;font-size: 12px">${fmtDate(task.distributionDate) || '—'}</span>
          <input type="date" id="dist-inp-${task.id}" value="${task.distributionDate || ''}" onchange="A.ufTask('${task.id}','distributionDate',this.value);A.setDistLbl('${task.id}',this.value)" style="position:absolute;opacity:0;width:0;height:0;top:0;left:0">`
  },

  // ── PLAN COLUMNS ───────────────────────────────────────────────────────────
  //
  // These three read `ctx.tl` — the Map built once per sheet by
  // A.tlPositionsFor() (timeline.js). Three states each, and all three are
  // normal:
  //   ctx.tl === null      no plan pasted for this project
  //   no entry / no tasks  plan exists, but this item didn't match a deliverable
  //   entry with tasks     the real case
  //
  // Position is stored on the PARENT's timeline object, not on the subtask
  // (tl.position[subtaskId]) — it is a claim about THIS plan and dies with it
  // on re-paste. See the storage note at the top of timeline.js.

  // Stage and vs Plan share a cell: "where is this item" and "is that where it
  // should be" are one question. Picking a stage calls tlSetPos, which saves
  // and re-renders, so the drift tag beside it recomputes on the spot.
  stage: {
    label: 'Stage \u00b7 vs Plan',
    thAttr: 'class="th-stage"',
    tdAttr: '',
    cell: (task, ctx) => {
      if (!ctx.tl) {
        // Not a dead cell: the fix is one click away, so point at it.
        return `<span class="sv-noplan" title="No timeline imported for this project" onclick="A.setPanel('${ctx.parent.id}','timeline')">No plan</span>`;
      }
      const s = ctx.tl.get(task.id);
      if (!s || !s.tasks.length) {
        // The Timeline panel offers a deliverable picker here. Deliberately not
        // duplicated into a table cell — it names every deliverable in the
        // plan, and getting the join right deserves the panel's room.
        return `<span class="sv-noplan" title="This item didn't match a deliverable in the plan — link it in the Timeline panel" onclick="A.setPanel('${ctx.parent.id}','timeline')">Not in plan</span>`;
      }
      // No position set means no drift to report — the dash in the select
      // already says "not set", so no tag rather than a "No position set" one.
      // Tag colours are the Timeline panel's own .tl-h-* classes, so the two
      // never disagree about what "behind" looks like.
      const tag = s.health.key === 'none' ? ''
        : `<span class="sv-health ${s.health.cls}">${esc(s.health.label)}</span>`;
      // No max-width on the select: under auto layout the column sizes to its
      // longest task name, and a cap only clips names while the room sits
      // unused beside them (the mistake made twice in the two-view version).
      return `<div class="sv-stage-cell"><select class="sv-stage" style="font-family:var(--font);font-size: 12px;color:var(--text);background:none;border:none;outline:none;cursor:pointer" onchange="A.tlSetPos('${ctx.parent.id}','${task.id}',this.value)">
            <option value="">—</option>
            ${s.tasks.map((t, i) => `<option value="${i}"${i === s.selIdx ? ' selected' : ''}>${esc(t.task)}</option>`).join('')}
          </select>${tag}</div>`;
    }
  },

  nexttick: {
    label: 'Next Tick',
    thAttr: 'class="th-nexttick"',
    tdAttr: '',
    cell: (task, ctx) => {
      if (!ctx.tl) return '<span class="dash">—</span>';
      const s = ctx.tl.get(task.id);
      if (!s || !s.tasks.length) return '<span class="dash">—</span>';
      // No next tick with a position set means the last task is the current
      // one — finished, not missing. Without a position there is simply
      // nothing to be after.
      if (!s.next) return s.sel ? '<span class="sv-done">Complete</span>' : '<span class="dash">—</span>';
      // Two spans, not one string: the date must never be the part that gets
      // ellipsized. A cut task name is still readable ("Animation Rd…"); a cut
      // date ("9/9/…") is worse than useless. The task name shrinks, the date
      // does not — see .sv-next in main.css.
      //
      // Explicit "·" separator rather than spacing alone: task names routinely
      // end in a number ("Animation Rd 1") and the date starts with one, so a
      // margin on its own reads as "Rd 19/4/26".
      return `<span class="sv-next" title="${esc(s.next.task)} · ${esc(fmtDate(s.next.date))}"><span class="sv-next-t">${esc(s.next.task)}</span><span class="sv-next-d">· ${esc(fmtDate(s.next.date))}</span></span>`;
    }
  },

  // The review label names the tool you'd actually open. When both review
  // links exist, ReviewStudio takes the label (it's the later, client-facing
  // artifact) and the B chip opens Boords. ✎ — or the grey label on an empty
  // cell — opens the two-box popover; the id'd span is what it anchors to.
  review: {
    label: 'Review',
    thAttr: 'class="th-review"',
    tdAttr: '',
    cell: task => {
      const rs = task.reviewStudioLink || '', bo = task.boordsLink || '';
      const pencil = `<span class="sv-lp-edit" role="button" tabindex="0" title="Edit review links" ${keyOpen(task.id)}>\u270E</span>`;
      const inner = rs ? linkTo(rs, 'ReviewStudio') + (bo ? linkTo(bo, 'B', 'sv-lp-chip') : '') + pencil
                  : bo ? linkTo(bo, 'Boords') + pencil
                  : `<span class="sv-lp-empty" role="button" tabindex="0" title="Add a review link" ${keyOpen(task.id)}>Review</span>`;
      return `<span class="sv-links" id="lp-anchor-${task.id}">${inner}</span>`;
    }
  },

  // One link, so no popover: the same inline edit as the Zoho / Estimate /
  // Dropbox fields on the project strip. The label is the link; ✎ (or the grey
  // label when empty) swaps in the input, which pops out wide while editing
  // (.fps-link-editing) and saves on blur, Enter or Escape.
  dropbox: {
    label: 'Dropbox',
    thAttr: 'class="th-dropbox"',
    tdAttr: '',
    cell: task => {
      const v = task.dropboxLink || '';
      const inpId = `dbx-inp-${task.id}`, lnkId = `dbx-lnk-${task.id}`;
      const toggle = `onclick="toggleLinkEdit('${inpId}','${lnkId}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleLinkEdit('${inpId}','${lnkId}')}"`;
      const input = `<input class="fps-input" value="${esc(v)}" placeholder="URL" style="display:none" id="${inpId}" onblur="A.setDropboxLink('${task.id}',this.value)">`;
      if (!v) {
        return `<div class="fps-field-val"><span class="fps-empty" id="${lnkId}" role="button" tabindex="0" ${toggle}>Dropbox</span>${input}</div>`;
      }
      return `<div class="fps-field-val" style="gap:4px">${linkTo(v, 'Dropbox')}${input}<span class="fps-link-btn" role="button" tabindex="0" id="${lnkId}" title="Edit" ${toggle}>\u270E</span></div>`;
    }
  },

  touched: {
    label: 'Last Touched',
    thAttr: 'class="th-touched"',
    tdAttr: '',
    // activityLog is newest-first (metrics.js unshifts), so [0] is the most
    // recent edit. Rows that predate the log, or that nobody has touched since
    // it existed, simply have none — not an error.
    cell: task => {
      const e = task.activityLog && task.activityLog[0];
      if (!e) return '<span class="dash">\u2014</span>';
      const rel = fmtRelTime(e);
      // Stale is the whole point of the column, so it has to look different
      // from fresh. A week is the threshold the health chip already uses for
      // "real trouble" (see healthOf in timeline.js).
      const days = e.at ? Math.floor((Date.now() - new Date(e.at).getTime()) / 864e5) : 0;
      return `<span class="sv-touched${days >= 7 ? ' stale' : ''}" title="${esc(e.field || '')} \u00b7 ${esc(rel)}">${esc(rel)}</span>`;
    }
  },

  act: {
    label: '',
    thAttr: 'class="th-act"',
    tdAttr: 'style="text-align:center"',
    cell: task => task.clickupId
      // A ClickUp-linked row's ✕ REMOVES it from the project; it doesn't
      // delete it. The task goes back to the unassigned list in the rail
      // with everything recorded here intact, and re-assigning restores
      // it — see the note above detachCuRow() in clickup.js. Deleting
      // that data for good is a separate, deliberate step in the ClickUp
      // manage modal.
      ? `<button class="btn btn-ghost btn-sm" style="padding:1px 5px;font-size: 11px;color:var(--ink-3)" title="Remove from this project — keeps the task and everything on it" onclick="A.detachCuRow('${task.id}')">✕</button>`
      // A hand-made subtask has no ClickUp task behind it and nowhere to
      // go back to, so ✕ still means delete.
      : `<button class="btn btn-ghost btn-sm" style="padding:1px 5px;font-size: 11px;color:var(--ink-3)" title="Delete this task" onclick="deleteRow('${task.id}')">✕</button>`
  }
};

// ── WHAT SHOWS, AND IN WHAT ORDER ────────────────────────────────────────────
//
// One list. To hide a column take its key out; to bring one back, put it back.
// Order here is order on screen.
//
// Hidden for now, still defined above:
//   'io' — the daily in/out checkbox. Went unused; restore it after 'name'.

export const SUBTASK_COLS = [
  'name', 'tags', 'cu', 'days', 'due', 'phase', 'stage', 'nexttick',
  'update', 'type', 'tier', 'style', 'review', 'dropbox',
  'designer', 'animator', 'vo', 'distdate', 'touched', 'act'
];
