// strip.js — flight-progress-strip interactions: the status popup menu.

import { STATUS_LABELS, STATUS_CYCLE, CU_STATUSES } from '../data/constants.js';
import { esc } from '../utils.js';
import { db } from '../store.js';
import { A, register } from '../bus.js';

let _statusMenuId = null;

function openStatusMenu(id, e){
  e.stopPropagation();
  _statusMenuId = id;
  const menu = document.getElementById('status-menu');
  const row = db.rows.find(r => r.id === id);
  // A ClickUp-linked item checks ClickUp live before offering anything — see
  // LINKED ITEMS below.
  if (row && A.isCuLinked(row)) { placeMenu(menu, e); openLinkedMenu(row); return; }
  // Every other item picks from the same thirteen statuses as ClickUp, with the
  // same dot colours — one status list for items, linked or not.
  if (row && A.isItem(row)) { menu.innerHTML = itemStatusMenuHtml(row); placeMenu(menu, e); return; }
  // Dots use the same `is-<status>` classes as the subtask row dots, so their
  // colors come from the --sig-* variables. (Previously a hardcoded
  // STATUS_DOT_COLORS map, which drifted out of sync with the palette.)
  menu.innerHTML = STATUS_CYCLE.map(s=>`
    <div class="status-menu-item" onclick="pickStatus('${s}')">
      <div class="status-menu-dot is-${s}"></div>
      ${STATUS_LABELS[s]}
    </div>`).join('');
  placeMenu(menu, e);
}

function placeMenu(menu, e){
  menu.dataset.busy = '';
  const rect = e.target.getBoundingClientRect();
  menu.style.top = (rect.bottom + 6) + 'px';
  menu.style.left = rect.left + 'px';
  menu.classList.add('open');
}

function itemStatusMenuHtml(row){
  const current = A.itemStatusLabel(row);
  return CU_STATUSES.map(st => {
    const dot = A.statusDotStyle(st.name);
    return `
    <div class="status-menu-item${st.name === current ? ' is-current' : ''}" onclick="pickItemStatus('${esc(st.name)}')">
      <div class="status-menu-dot is-${st.hub}"${dot}></div>
      ${esc(st.name)}
    </div>`;
  }).join('');
}

function pickItemStatus(name){
  if(_statusMenuId) A.setItemStatus(_statusMenuId, name);
  document.getElementById('status-menu').classList.remove('open');
  _statusMenuId = null;
}

// ── LINKED ITEMS ─────────────────────────────────────────────────────────────
// Opening the dot on a ClickUp-linked item asks ClickUp for the task's status
// right now, so whatever the hub shows was true a second ago — not as of the
// last Sync. If ClickUp has moved, the board updates before anything can be
// picked. There's never a question of which change is newer: the menu only
// ever offers choices against ClickUp's current status.
//
// Picking sends that status along with the one it replaces (`expected`).
// api/clickup-status.js writes only if ClickUp is still there; otherwise
// nothing is sent and the menu shows what changed. The hub's own dot changes
// only once ClickUp confirms — a failed send leaves both sides as they were.
//
// Whether a task may be changed from here at all is the clickup_status_write
// switch (see api/clickup-status.js). Tasks it doesn't cover get a view-only
// menu with a link to ClickUp.

let _menuSeq = 0;   // bumps on every open/send, so a late reply can't paint a menu that has moved on

async function openLinkedMenu(row){
  const seq = ++_menuSeq;
  paintLinked(row, 'checking');
  try {
    const res = await fetch('/api/clickup-status?taskId=' + encodeURIComponent(row.clickupId));
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || ('ClickUp check failed (' + res.status + ')'));
    if (seq !== _menuSeq) return;
    const before = A.itemStatusLabel(row);
    A.noteClickUpStatus(row, j.status);
    const after = A.itemStatusLabel(row);
    paintLinked(row, before === after ? 'current' : 'changed', before);
  } catch (err) {
    if (seq !== _menuSeq) return;
    console.error('Live ClickUp status check failed for task ' + row.clickupId + ':', err);
    paintLinked(row, 'check-failed');
  }
}

async function pickLinkedStatus(name){
  const row = db.rows.find(r => r.id === _statusMenuId);
  if (!row || !A.cuWriteAllowed(row)) return;
  const expected = A.itemStatusLabel(row);
  if (name === expected) { closeMenu(); return; }
  const seq = ++_menuSeq;
  paintLinked(row, 'sending');
  try {
    const res = await fetch('/api/clickup-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clickupId: row.clickupId, expected, status: name })
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 409) {
      // Someone moved it in the second or two since the menu opened.
      A.noteClickUpStatus(row, j.status);
      if (seq === _menuSeq) paintLinked(row, 'conflict', expected);
      return;
    }
    if (res.status === 403) { if (seq === _menuSeq) paintLinked(row, 'off'); return; }
    if (!res.ok) throw new Error(j.error || ('ClickUp update failed (' + res.status + ')'));
    A.noteClickUpStatus(row, j.status);
    if (seq === _menuSeq) closeMenu();
  } catch (err) {
    console.error('ClickUp status update failed for task ' + row.clickupId + ':', err);
    if (seq === _menuSeq) paintLinked(row, 'send-failed', '', err.message || String(err));
  }
}

function paintLinked(row, state, from, detail){
  const menu = document.getElementById('status-menu');
  if (_statusMenuId !== row.id || !menu.classList.contains('open')) return;
  const now = A.itemStatusLabel(row);
  const writable = A.cuWriteAllowed(row);
  const NOTES = {
    checking:      ['busy', 'Checking ClickUp…'],
    current:       ['ok',   'Up to date with ClickUp'],
    changed:       ['warn', 'Moved in ClickUp: ' + from + ' → ' + now],
    conflict:      ['warn', 'Changed in ClickUp just now: ' + from + ' → ' + now + '. Nothing was sent.'],
    sending:       ['busy', 'Sending to ClickUp…'],
    off:           ['busy', 'Status changes from the hub are switched off for this task.'],
    'check-failed':['err',  'Couldn’t reach ClickUp — showing the status from the last sync.'],
    'send-failed': ['err',  'ClickUp wasn’t updated' + (detail ? ': ' + detail : '') + '. Nothing changed.']
  };
  const [kind, text] = NOTES[state];
  const busy = state === 'checking' || state === 'sending';
  // Choices are only offered against a status ClickUp just confirmed. After a
  // failed check the hub can't vouch for what it's showing, so view-only.
  const offerChoices = writable && state !== 'check-failed' && state !== 'off';
  const url = A.cuTaskUrl(row);
  const list = offerChoices
    ? CU_STATUSES.map(st => `
      <div class="status-menu-item${st.name === now ? ' is-current' : ''}" onclick="event.stopPropagation();pickLinkedStatus('${esc(st.name)}')">
        <div class="status-menu-dot is-${st.hub}"${A.statusDotStyle(st.name)}></div>
        ${esc(st.name)}
      </div>`).join('')
    : `<div class="status-menu-item is-readonly">
        <div class="status-menu-dot is-${esc(row.status)}"${A.itemDotStyle(row)}></div>
        ${esc(now)}
      </div>`;
  menu.dataset.busy = state === 'sending' ? 'sending' : '';
  menu.innerHTML = `
    <div class="status-menu-banner is-${kind}">${esc(text)}</div>
    <div class="status-menu-list${busy ? ' is-busy' : ''}">${list}</div>
    ${url ? `<a class="status-menu-item" href="${esc(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${offerChoices ? 'Open in ClickUp' : 'Change in ClickUp'} ↗</a>` : ''}`;
}

function closeMenu(){
  const menu = document.getElementById('status-menu');
  menu.dataset.busy = '';
  menu.classList.remove('open');
  _statusMenuId = null;
}

function pickStatus(status){
  if(_statusMenuId) A.setStatus(_statusMenuId, status);
  document.getElementById('status-menu').classList.remove('open');
  _statusMenuId = null;
}

// Register on the app bus so other modules + inline handlers can reach these.
register({ openStatusMenu, pickStatus, pickItemStatus, pickLinkedStatus });

// Global click closes the open status menu (matches original top-level listener)
// — except while a status is being sent to ClickUp: the menu is where a failed
// send or a conflict gets reported, so it stays until the answer is in.
document.addEventListener('click', ()=>{
  const menu = document.getElementById('status-menu');
  if (menu.dataset.busy === 'sending') return;
  menu.classList.remove('open');
  _statusMenuId = null;
});
