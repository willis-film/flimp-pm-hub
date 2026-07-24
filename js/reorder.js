// reorder.js — drag-to-reorder for the subtask and invoice tables.
//
// Uses native HTML5 drag-and-drop rather than pointer events. The tradeoff:
// pointer events give finer control over the drag image and work identically
// on touch, but require reimplementing autoscroll, drop detection and
// cancellation by hand. Native DnD gets those from the browser, and this hub
// is a desktop tool — there's no build step to pull in a drag library, and
// hand-rolling the pointer version is a lot of code to maintain for a list of
// five to ten rows.
//
// The two tables store order differently, so both are driven through one
// implementation parameterized on read/commit:
//   - subtasks live in db.rows as separate records sharing a parentId, and
//     carry an explicit sortOrder column (see the 2026-07-23 migration)
//   - invoices are plain objects inside parent.invoices, a JSONB array whose
//     element order IS the order — no field needed
//
// Rows are made draggable by a handle, not the whole row: the cells contain
// inputs and selects, and a draggable ancestor makes text selection inside
// them fight the drag.

import { db, save } from './store.js';
import { A, register } from './bus.js';

// Module-scoped rather than per-table: only one drag can be in flight at a
// time, and a dragend can fire after the DOM has been re-rendered out from
// under it, so this has to survive that.
let dragState = null;

// Where the dragged row would land if dropped now. Derived from the pointer's
// position within the hovered row: past the midpoint means "after".
function insertionIndex(overRow, clientY) {
  const r = overRow.getBoundingClientRect();
  return (clientY - r.top) / r.height > 0.5 ? 1 : 0;
}

function clearMarkers(tbody) {
  tbody.querySelectorAll('.drag-over-above, .drag-over-below')
    .forEach(el => el.classList.remove('drag-over-above', 'drag-over-below'));
}

// Attaches drag behaviour to one tbody.
//
// `commit(fromIdx, toIdx)` does the actual data move and is the only part that
// differs between the two tables. It is called with indices into the ordered
// sibling list, already normalized so that toIdx is the final resting position
// after removal — callers don't have to think about the off-by-one that
// splice-then-insert introduces when moving downward.
function makeSortable(tbody, commit) {
  tbody.querySelectorAll('tr[data-idx]').forEach(tr => {
    const handle = tr.querySelector('.drag-handle');
    if (!handle) return;

    // The handle sets draggable on the row only while the pointer is on it,
    // then clears it. Leaving the row permanently draggable breaks text
    // selection in its inputs; setting it on mousedown alone leaves it stuck
    // if the drag never starts.
    handle.addEventListener('mousedown', () => { tr.draggable = true; });
    handle.addEventListener('mouseup',   () => { tr.draggable = false; });

    tr.addEventListener('dragstart', e => {
      dragState = { tbody, fromIdx: Number(tr.dataset.idx) };
      tr.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox refuses to start a drag unless some data is set.
      e.dataTransfer.setData('text/plain', tr.dataset.idx);
    });

    tr.addEventListener('dragend', () => {
      tr.draggable = false;
      tr.classList.remove('dragging');
      clearMarkers(tbody);
      dragState = null;
    });

    tr.addEventListener('dragover', e => {
      if (!dragState || dragState.tbody !== tbody) return;
      e.preventDefault();                    // required to allow a drop
      e.dataTransfer.dropEffect = 'move';
      clearMarkers(tbody);
      const after = insertionIndex(tr, e.clientY);
      tr.classList.add(after ? 'drag-over-below' : 'drag-over-above');
    });

    tr.addEventListener('drop', e => {
      if (!dragState || dragState.tbody !== tbody) return;
      e.preventDefault();
      e.stopPropagation();
      const from = dragState.fromIdx;
      let to = Number(tr.dataset.idx) + insertionIndex(tr, e.clientY);
      clearMarkers(tbody);
      // Moving down: removing the source first shifts everything after it up
      // by one, so the target index has to come back down to match.
      if (from < to) to -= 1;
      if (from !== to) commit(from, to);
      dragState = null;
    });
  });

  // Dropping in the gap below the last row appends. Without this the drop is
  // simply ignored, which reads as the drag having failed.
  tbody.addEventListener('dragover', e => {
    if (dragState && dragState.tbody === tbody) e.preventDefault();
  });
}

// ── SUBTASKS ─────────────────────────────────────────────────────────────────

// Renumbers a parent's children densely from 10 in steps of 10. Dense
// renumbering (rather than computing a single fractional value between
// neighbours) keeps the numbers readable and avoids drift over many moves;
// the cost is writing every sibling, which is nothing at these list sizes.
function renumberChildren(parentId) {
  db.rows
    .filter(r => r.parentId === parentId)
    .forEach((r, i) => { r.sortOrder = (i + 1) * 10; });
}

function moveSubtask(parentId, fromIdx, toIdx) {
  // Operate on the sibling group, then write the result back into db.rows in
  // place. db.rows is a flat list holding parents and children interleaved, so
  // splicing it directly by sibling index would move the wrong record.
  const kids = db.rows.filter(r => r.parentId === parentId);
  if (fromIdx < 0 || fromIdx >= kids.length || toIdx < 0 || toIdx >= kids.length) return;

  const [moved] = kids.splice(fromIdx, 1);
  kids.splice(toIdx, 0, moved);

  // Reassign sortOrder to match the new sequence, then reorder db.rows itself
  // so an immediate re-render (which reads array order, not sortOrder) agrees
  // with what was just persisted. Without this the row snaps back until the
  // next load().
  kids.forEach((r, i) => { r.sortOrder = (i + 1) * 10; });
  const others = db.rows.filter(r => r.parentId !== parentId);
  const anchor = db.rows.findIndex(r => r.parentId === parentId);
  db.rows = anchor === -1
    ? [...others, ...kids]
    : [...others.slice(0, anchor), ...kids, ...others.slice(anchor)];

  save();
  A.render();
}

// ── INVOICES ─────────────────────────────────────────────────────────────────

function moveInvoice(parentId, fromIdx, toIdx) {
  const parent = db.rows.find(r => r.id === parentId);
  if (!parent || !Array.isArray(parent.invoices)) return;
  const inv = parent.invoices;
  if (fromIdx < 0 || fromIdx >= inv.length || toIdx < 0 || toIdx >= inv.length) return;

  // No sortOrder needed — this is a JSONB array and its element order is the
  // stored order, round-tripping through api/db.js untouched.
  const [moved] = inv.splice(fromIdx, 1);
  inv.splice(toIdx, 0, moved);

  save();
  A.render();
}

// Called by render.js after each table's rows are built.
function attachSubtaskDnD(tbody, parentId) {
  makeSortable(tbody, (from, to) => moveSubtask(parentId, from, to));
}
function attachInvoiceDnD(tbody, parentId) {
  makeSortable(tbody, (from, to) => moveInvoice(parentId, from, to));
}

register({ attachSubtaskDnD, attachInvoiceDnD, renumberChildren });
