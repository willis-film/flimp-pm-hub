// strip.js — flight-progress-strip interactions: the status popup menu.

import { STATUS_LABELS, STATUS_CYCLE } from '../data/constants.js';
import { A, register } from '../bus.js';

let _statusMenuId = null;

function openStatusMenu(id, e){
  e.stopPropagation();
  _statusMenuId = id;
  const menu = document.getElementById('status-menu');
  // Dots use the same `is-<status>` classes as the subtask row dots, so their
  // colors come from the --sig-* variables. (Previously a hardcoded
  // STATUS_DOT_COLORS map, which drifted out of sync with the palette.)
  menu.innerHTML = STATUS_CYCLE.map(s=>`
    <div class="status-menu-item" onclick="pickStatus('${s}')">
      <div class="status-menu-dot is-${s}"></div>
      ${STATUS_LABELS[s]}
    </div>`).join('');
  const rect = e.target.getBoundingClientRect();
  menu.style.top = (rect.bottom + 6) + 'px';
  menu.style.left = rect.left + 'px';
  menu.classList.add('open');
}

function pickStatus(status){
  if(_statusMenuId) A.setStatus(_statusMenuId, status);
  document.getElementById('status-menu').classList.remove('open');
  _statusMenuId = null;
}

// Register on the app bus so other modules + inline handlers can reach these.
register({ openStatusMenu, pickStatus });

// Global click closes the open status menu (matches original top-level listener).
document.addEventListener('click', ()=>{
  document.getElementById('status-menu').classList.remove('open');
  _statusMenuId = null;
});
