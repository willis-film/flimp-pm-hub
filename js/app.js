// app.js — application entry point.
//
// Importing each module below runs its top-level register() call, populating the
// shared `A` bus. We then mirror every bus function onto window so the inline
// on* handlers in index.html (and the handler strings generated inside render())
// resolve exactly as they did in the original single-file build. Finally we wire
// the global document listeners and run the boot sequence.

import { load, dailyIOReset } from './db.js';
import { A } from './bus.js';

// Side-effect imports: each registers its functions onto the `A` bus.
import './render.js';
import './components/strip.js';
import './components/sidebar.js';
import './components/modals.js';
import './clickup.js';
import './panels/subtasks.js';
import './panels/emails.js';
import './panels/invoices.js';
import './panels/closeout.js';
import './panels/metrics.js';
import './panels/timeline.js';
import './panels/info.js';
import './panels/templates.js';
import './panels/distro.js';

// Expose every registered handler globally for the inline on* attributes.
Object.assign(window, A);
// Also expose the bus object itself, so inline handlers written as
// `A.fnName(...)` in render.js resolve (not just the bare-name mirror above).
window.A = A;

// ── GLOBAL LISTENERS ─────────────────────────────────────────────────────────
// Wired once, immediately — these target static elements present in index.html.
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ A.closeDetail(); A.closeParentModal(); A.closeSubtaskModal(); A.closeAssignLabelModal(); A.closeGmailLabelModal(); A.closeAssignCuTaskModal(); A.closeClickUpManageModal(); } });
document.getElementById('parent-overlay').addEventListener('click',function(e){ if(e.target===this) A.closeParentModal(); });
document.getElementById('subtask-overlay').addEventListener('click',function(e){ if(e.target===this) A.closeSubtaskModal(); });
document.getElementById('assign-label-overlay').addEventListener('click',function(e){ if(e.target===this) A.closeAssignLabelModal(); });
document.getElementById('gmail-label-overlay').addEventListener('click',function(e){ if(e.target===this) A.closeGmailLabelModal(); });
document.getElementById('assign-cu-overlay').addEventListener('click',function(e){ if(e.target===this) A.closeAssignCuTaskModal(); });
document.getElementById('clickup-manage-overlay').addEventListener('click',function(e){ if(e.target===this) A.closeClickUpManageModal(); });

// ── BOOT ─────────────────────────────────────────────────────────────────────
// init() loads persisted state, applies the daily I/O reset, then does the first
// full render of the list, sidebar lists, and banners. Called by Alpine via
// x-init on <body> (see alpine.js), so Alpine owns startup ordering.
export async function init() {
  await load();
  dailyIOReset();
  A.render();
  A.renderGmailSidebar();
  A.renderGmailBanner();
  A.renderClickUpSidebar();
  A.renderCuBanner();
}

// Expose for Alpine's x-init and as a manual fallback.
window.__flimpInit = init;
