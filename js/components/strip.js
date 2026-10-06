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
  // A ClickUp-linked item's status belongs to ClickUp (see STATUS FROM CLICKUP
  // in clickup.js), so its menu shows that status and a way to ClickUp rather
  // than choices. Nothing in it calls pickStatus().
  if (row && A.isCuLinked(row)) { menu.innerHTML = cuStatusMenuHtml(row); placeMenu(menu, e); return; }
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

function cuStatusMenuHtml(row){
  const cu = A.cuStatusFor(row);
  const url = A.cuTaskUrl(row);
  const note = !cu ? 'Not in the last ClickUp sync — showing the last status seen.'
    : !cu.known ? 'A ClickUp status the hub doesn\'t recognise yet.'
    : 'Set in ClickUp. Sync to pick up changes.';
  return `
    <div class="status-menu-item is-readonly">
      <div class="status-menu-dot is-${esc(row.status)}"${A.itemDotStyle(row)}></div>
      ${esc(A.itemStatusLabel(row))}
    </div>
    <div class="status-menu-note">${esc(note)}</div>
    ${url ? `<a class="status-menu-item" href="${esc(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Change in ClickUp ↗</a>` : ''}`;
}

function pickStatus(status){
  if(_statusMenuId) A.setStatus(_statusMenuId, status);
  document.getElementById('status-menu').classList.remove('open');
  _statusMenuId = null;
}

// Register on the app bus so other modules + inline handlers can reach these.
register({ openStatusMenu, pickStatus, pickItemStatus });

// Global click closes the open status menu (matches original top-level listener).
document.addEventListener('click', ()=>{
  document.getElementById('status-menu').classList.remove('open');
  _statusMenuId = null;
});
