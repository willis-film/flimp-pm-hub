// clickup.js — ClickUp integration: assign tasks to projects, and remove them
// again without destroying what the hub knows about them.

import { esc, newId, fmtDate, isDetached, isProjectRow } from './utils.js';
import { db, save } from './store.js';
import { ui } from './state.js';
import { PHASE_LABELS } from './data/constants.js';
import { A, register } from './bus.js';

let _assigningCuTaskId=null;

function openAssignCuTaskModal(taskId){
  _assigningCuTaskId=taskId;
  const task=(db.clickupTasks||[]).find(t=>t.id===taskId);
  // Falls back to the parked row's own name: a task deleted in ClickUp is gone
  // from db.clickupTasks on the next sync, but its parked row here still knows
  // what it was called and can still be restored.
  const parkedName=(detachedRowsFor(taskId)[0]||{}).name||'';
  document.getElementById('acm-title').textContent='Assign "'+(task?task.name:parkedName)+'" to a project';
  const sel=document.getElementById('acm-project');
  // isProjectRow(), not parentId===null — a task parked by a removal also has
  // a null parentId, and offering one as a destination would let a task be
  // filed under another task.
  const parents=db.rows.filter(isProjectRow);
  sel.innerHTML='<option value="">— select a project —</option>'+parents.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');

  // Says up front that this assignment RESTORES rather than starts fresh —
  // otherwise reviving a parked row looks like a bug the first time it happens
  // (a "new" subtask arriving with comments and costs already on it).
  const note=document.getElementById('acm-restore-note');
  if(note){
    const parked=detachedRowsFor(taskId)[0];
    if(parked){
      const from=db.rows.find(r=>r.id===parked.detachedFrom);
      note.textContent='This task was removed from '+(from?from.name:'a project')
        +(parked.detachedAt?' on '+fmtDate(parked.detachedAt.slice(0,10)):'')
        +'. Everything recorded against it here will be restored.';
      note.classList.remove('hidden');
    } else {
      note.textContent='';
      note.classList.add('hidden');
    }
  }
  document.getElementById('assign-cu-overlay').classList.add('open');
}

function closeAssignCuTaskModal(){ document.getElementById('assign-cu-overlay').classList.remove('open'); _assigningCuTaskId=null; }

function submitAssignCuTask(){
  const projectId=document.getElementById('acm-project').value; if(!projectId||!_assigningCuTaskId) return;

  // A row parked by an earlier removal is REVIVED rather than replaced, so the
  // phase, comments, dates, costs and links recorded against this task come
  // back with it. Without this branch the parked row would be stranded —
  // invisible on the board and shadowed by a blank second row for the same
  // ClickUp task.
  //
  // Newest first: repeated remove/assign cycles can leave more than one parked
  // row for a task, and the most recently removed one carries the latest edits.
  // Older ones stay parked and can be discarded from the manage modal.
  //
  // Checked BEFORE the synced task is looked up, because a parked row carries
  // its own name, product fields and ClickUp URL — so a task since deleted in
  // ClickUp (gone from db.clickupTasks on the next sync) can still be put back
  // on a project. Requiring the synced task first would strand it.
  const parked=detachedRowsFor(_assigningCuTaskId);
  if(parked.length){
    const row=parked[0];
    row.parentId=projectId;
    delete row.detachedFrom;
    delete row.detachedAt;
    // Lands at the end of its new siblings rather than wherever it sat under
    // the old project — a stale sortOrder would drop it into the middle of a
    // list it has never been part of. Moved to the end of db.rows for the same
    // reason: render() reads array order within a session, and only a reload
    // re-sorts by sortOrder.
    row.sortOrder=nextSortOrder(projectId);
    db.rows=db.rows.filter(r=>r.id!==row.id);
    db.rows.push(row);
    save(); A.render(); A.renderClickUpSidebar(); A.renderCuBanner(); closeAssignCuTaskModal();
    return;
  }

  // No parked row: this is a first assignment, which does need the synced task
  // to copy its name, dates and product fields from.
  const cuTask=(db.clickupTasks||[]).find(t=>t.id===_assigningCuTaskId); if(!cuTask) return;

  // Map ClickUp status to internal status
  const statusMap={'to do':'kickoff','in progress':'production','in review':'done','complete':'closed'};
  const newRow={
    id:newId('r'),
    parentId:projectId,
    clickupId:cuTask.id,
    // ClickUp's own task URL, carried over rather than rebuilt from the id.
    // The Subtasks table falls back to deriving app.clickup.com/t/<id> when
    // this is absent (rows assigned before this line existed), but the synced
    // URL is the authoritative one — it's whatever ClickUp itself returned.
    clickupUrl:cuTask.clickupUrl||'',
    collapsed:false,
    name:cuTask.name,
    status:statusMap[cuTask.status]||'kickoff',
    phase:'',
    tags:[],
    due:cuTask.due||'',
    oeStart:'',
    io:false,
    branding:false,
    am:'',
    newOrUpdate:'',
    productType:cuTask.productType||'',
    productTier:cuTask.productTier||'',
    productStyle:cuTask.productStyle||'',
    zohoLink:'',
    dropboxLink:'',
    nextActivity:null,
    designer:'',
    animator:'',
    voArtist:'',
    distributionDate:'',
    comments:[]
  };
  db.rows.push(newRow);
  save(); A.render(); A.renderClickUpSidebar(); A.renderCuBanner(); closeAssignCuTaskModal();
}

// ── REMOVING A TASK FROM A PROJECT ───────────────────────────────────────────
// Taking a task off a project used to mean deleting its row, and a row is where
// everything the tower knows about that item lives — phase, comments, dates,
// designer/animator/VO, costs, the Info panel, the activity log. Deleting all of
// that is a brutal answer to what is usually a filing mistake: the ClickUp task
// still exists, and so does the work someone recorded against it here.
//
// So removal DETACHES instead. The row is kept whole; `parentId` is cleared and
// the project it came from is remembered in `detachedFrom`. Nothing renders it,
// because no project claims it as a child any more — from the board it looks
// exactly like a deletion — but the ClickUp task returns to the unassigned list
// in the rail, and assigning it again revives that same row (see
// submitAssignCuTask above) rather than starting a blank one.
//
// WHY parentId IS CLEARED rather than kept alongside a flag: every children
// lookup in the app is `parentId === <project id>` — render.js's getChildren,
// reorder.js's drag indices, metrics.js's CSV export. A row that stayed pointed
// at its old parent would have to be filtered out of each one, and reorder.js's
// indices would silently drift the moment a single site was missed, dragging the
// wrong subtask. Clearing parentId makes the row invisible to all of them at
// once. The cost is the mirror image — `parentId === null` is also how the app
// spots a PROJECT row — which is what isProjectRow() in utils.js exists to fix.
//
// Neither field is a real Postgres column, so both ride along in the `data`
// JSONB catch-all in api/db.js. No migration.
//
// The only way a detached row is destroyed is discardCuTaskData() below, or
// deleting the project it was removed from (deleteRow only sweeps CURRENT
// children, so a parked row survives that — but its `detachedFrom` then names a
// project that no longer exists, which the manage modal renders as "a deleted
// project" rather than pretending to know).

// Every parked row for a ClickUp task, most recently removed first.
function detachedRowsFor(cuId){
  return db.rows
    .filter(r=>r.clickupId===cuId && isDetached(r))
    .sort((a,b)=>String(b.detachedAt||'').localeCompare(String(a.detachedAt||'')));
}

// End of a project's child list. Siblings that have never been dragged carry no
// sortOrder at all (api/db.js sorts those last), so this only orders the row
// against the numbered ones — good enough, and one drag renumbers the group.
function nextSortOrder(projectId){
  const kids=db.rows.filter(r=>r.parentId===projectId);
  return kids.reduce((max,r)=>Math.max(max, Number(r.sortOrder)||0), 0)+10;
}

// The mutation itself, with no confirming or repainting — so the single-row and
// whole-task paths below can't drift apart in what "detached" means.
function detachRow(row){
  if(!row || row.parentId===null) return false;
  row.detachedFrom=row.parentId;
  row.detachedAt=new Date().toISOString();
  row.parentId=null;
  return true;
}

// Board-level removal: the ✕ at the end of a ClickUp-linked subtask row, and
// the button in that task's detail panel. Confirms, because ✕ is a small target
// sitting at the end of a row full of editable cells — but the wording says
// plainly that nothing is lost, so the dialog reads as a check rather than a
// warning.
function detachCuRow(rowId){
  const row=db.rows.find(r=>r.id===rowId); if(!row) return;
  const project=db.rows.find(r=>r.id===row.parentId);
  const msg='Remove "'+row.name+'" from '+(project?project.name:'this project')+'?\n\n'
    +'The ClickUp task and everything entered against it here are kept. '
    +'It goes back to the unassigned list in the ClickUp rail, and assigning it '
    +'to a project again restores all of it.';
  if(!confirm(msg)) return;
  if(!detachRow(row)) return;
  if(ui.detailId===rowId) A.closeDetail();
  save(); A.render(); A.renderClickUpSidebar(); A.renderCuBanner();
}

// The manage modal's Remove. No confirm: it's an explicit, labelled button, it
// destroys nothing, and the row it sits in repaints immediately to show the new
// state. Covers every row carrying this ClickUp id — normally one, but a task
// assigned to two projects by mistake is exactly the case this modal is for.
function detachCuTaskAll(cuId){
  let changed=false;
  db.rows.filter(r=>r.clickupId===cuId && !isDetached(r)).forEach(r=>{
    if(detachRow(r)){ changed=true; if(ui.detailId===r.id) A.closeDetail(); }
  });
  if(!changed) return;
  save(); A.render(); A.renderClickUpSidebar(); A.renderCuBanner(); openClickUpManageModal();
}

// The one destructive path, and it is deliberately two steps from the board: a
// task has to be removed from its project first, then discarded from here. That
// keeps "I filed this wrong" and "I never want this data again" as different
// gestures, which is the whole point of the change.
function discardCuTaskData(cuId){
  const parked=detachedRowsFor(cuId);
  if(!parked.length) return;
  const task=(db.clickupTasks||[]).find(t=>t.id===cuId);
  const msg='Permanently discard the saved data for "'+(task?task.name:cuId)+'"?\n\n'
    +'Comments, dates, costs, links and activity recorded in the hub are deleted '
    +'and cannot be recovered. The ClickUp task itself is untouched — it stays in '
    +'ClickUp and in the unassigned list here.';
  if(!confirm(msg)) return;
  const ids=new Set(parked.map(r=>r.id));
  db.rows=db.rows.filter(r=>!ids.has(r.id));
  save(); A.render(); A.renderClickUpSidebar(); A.renderCuBanner(); openClickUpManageModal();
}

// ── PHASE WRITE-BACK ─────────────────────────────────────────────────────────
// Phase edits push to ClickUp on their own. This was off during testing, when
// every write went through a per-row button — that proved the field mapping,
// and a button per phase change is too many clicks to keep.
//
// Set to false to go back to manual pushes; nothing at the call sites changes
// either way, and the ✕ retry button works in both modes.
const AUTO_PUSH_PHASE = true;

// Rows whose last push FAILED, keyed by row id -> the reason ClickUp gave.
// This is the whole indicator model: a successful push shows nothing at all,
// because a tick next to every phase in the table is noise once the thing is
// known to work. Only a failure earns pixels.
//
// In memory, not on the row: a row is persisted whole by save(), so parking
// this there would file a transient network error into Postgres (api/db.js
// would catch it in the `data` JSONB) and keep showing it long after it
// stopped being true.
//
// The cost of that choice is that a reload clears the marks — a failed write
// nobody noticed leaves the tower and ClickUp quietly disagreeing on that one
// phase. The console error survives; the mark doesn't. Re-picking the phase
// pushes again, which is the natural repair.
const phasePushErrors = new Map();

// The Phase cell's indicator slot, rendered by render.js on every row that has
// a ClickUp task. Empty — a reserved 12px of nothing — until a push fails, so
// the ✕ appearing never shifts the row's layout.
//
// The ✕ is a button, not a glyph: clicking it retries that one push. A failure
// you can act on where you're already looking beats one that sends you to the
// console.
function phaseIndicatorHtml(taskId){
  const err=phasePushErrors.get(taskId);
  if(!err) return '';
  return '<button class="btn btn-ghost btn-sm" style="padding:0;font-size: 11px;line-height:1;color:var(--sig-alert);background:none;border:none;cursor:pointer"'
    + ' title="'+esc('ClickUp phase sync failed — '+err+' (click to retry)')+'"'
    + ' onclick="A.syncTaskPhase(\''+taskId+'\',this)">✕</button>';
}

// Repaints one row's slot in place. Used after a push resolves, so the mark
// appears or clears without a full render() — re-rendering the whole board on
// a background network result would fight whatever the user is doing in
// another cell.
function refreshPhaseIndicator(taskId){
  const slot=document.getElementById('cu-phase-ind-'+taskId);
  if(slot) slot.innerHTML=phaseIndicatorHtml(taskId);
}

// Single place a push result becomes UI state, so the automatic path and the
// manual retry can never disagree about what's on screen.
function recordPhasePush(taskId, result){
  if(result.ok) phasePushErrors.delete(taskId);
  else phasePushErrors.set(taskId, result.error);
  refreshPhaseIndicator(taskId);
}

// Mirrors a subtask's phase into the linked ClickUp task's own "Phase" custom
// field. The phase is authored here, not in ClickUp — without this, anyone
// looking at the ClickUp task saw no sign of where the item actually was.
//
// Only rows carrying a clickupId go anywhere: a subtask created by hand in the
// tower has no ClickUp counterpart to write to, and parents never do. Calling
// this with either is a no-op, so call sites don't need to check first.
//
// Fire-and-forget, and failures are logged rather than thrown — the same
// contract save() has. The board's own copy of the phase is already saved by
// the time this runs; ClickUp being unreachable must not undo an edit someone
// just made, and the next change to that phase pushes again anyway.
//
// The label goes over the wire alongside the key because the ClickUp dropdown
// options are named after the labels a human reads, not the internal keys;
// api/clickup-phase.js matches on the label and falls back to the key.
// Resolves to { ok, error } rather than throwing — the ⟳ button needs to show
// the outcome, and an automatic push needs to not take the UI down with it.
// Never rejects, so callers that don't care can ignore the promise entirely.
async function pushPhaseToClickUp(row){
  if(!row) return { ok:false, error:'No such row' };
  if(!row.clickupId) return { ok:false, error:'Subtask is not linked to a ClickUp task' };
  const phase=row.phase||'';
  try{
    const res=await fetch('/api/clickup-phase',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ clickupId:row.clickupId, phase, phaseLabel:phase?(PHASE_LABELS[phase]||phase):'' })
    });
    const json=await res.json().catch(()=>({}));
    // A 422 means the write is misconfigured, not down — the task has no Phase
    // field, or none of its options match. The reason ClickUp gave is logged
    // verbatim and handed back for the button's tooltip;
    // GET /api/clickup-phase?taskId=<id> reports the field and its options when
    // this needs chasing down.
    if(!res.ok) throw new Error(json.error||('/api/clickup-phase -> '+res.status));
    return { ok:true, cleared:!phase, json };
  }catch(e){
    console.error('ClickUp phase write-back failed for task '+row.clickupId+':',e);
    return { ok:false, error:e.message||String(e) };
  }
}

// The automatic path, called by every phase editor. Gated on AUTO_PUSH_PHASE
// above; a no-op while that's false. Rows with no clickupId (hand-made
// subtasks, parents) fall out inside pushPhaseToClickUp, so call sites don't
// need to check either condition.
async function pushPhaseOnEdit(row){
  if(!AUTO_PUSH_PHASE || !row || !row.clickupId) return;
  recordPhasePush(row.id, await pushPhaseToClickUp(row));
}

// Retry for one row, wired to the ✕ that a failed push leaves behind. Also the
// manual path when AUTO_PUSH_PHASE is off.
//
// Success makes the button disappear rather than turn green: the indicator's
// whole contract is that a working sync is invisible, and a ✓ that lingers
// would be the noise the ✕ exists to avoid.
async function syncTaskPhase(taskId, btn){
  const row=db.rows.find(r=>r.id===taskId); if(!row) return;
  if(btn){ btn.disabled=true; btn.textContent='…'; btn.title='Retrying phase write to ClickUp…'; }

  const result=await pushPhaseToClickUp(row);

  // recordPhasePush() replaces the slot's contents wholesale, which discards
  // this button — including the disabled/'…' state set above. Nothing to
  // restore, and nothing to leak if the row was re-rendered mid-flight.
  recordPhasePush(taskId, result);
}

// ── DIST. DATE WRITE-BACK ────────────────────────────────────────────────────
// Same contract as the phase push above: fires after save(), never throws,
// and only rows linked to a ClickUp task go anywhere. api/clickup-dist-date.js
// finds the task's distribution date field by name and writes it.
//
// Lighter failure UI than phase: no retry button, just the Dist. Date label in
// the Subtasks table turning red with the reason on hover. Re-picking the date
// pushes again. Like the phase marks, it lives in memory and a reload clears it.
const distPushErrors = new Map();

function refreshDistIndicator(taskId){
  const lbl=document.getElementById('dist-lbl-'+taskId); if(!lbl) return;
  const err=distPushErrors.get(taskId);
  lbl.style.color=err?'var(--sig-alert)':'';
  lbl.title=err?'ClickUp Dist. Date sync failed — '+err+' (pick the date again to retry)':'';
}

async function pushDistDateOnEdit(row){
  if(!row || !row.clickupId) return;
  try{
    const res=await fetch('/api/clickup-dist-date',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ clickupId:row.clickupId, date:row.distributionDate||'' })
    });
    const json=await res.json().catch(()=>({}));
    // 422 = the ClickUp task has no field this recognises as a distribution
    // date. GET /api/clickup-dist-date?taskId=<id> lists the names it does have.
    if(!res.ok) throw new Error(json.error||('/api/clickup-dist-date -> '+res.status));
    distPushErrors.delete(row.id);
  }catch(e){
    console.error('ClickUp Dist. Date write-back failed for task '+row.clickupId+':',e);
    distPushErrors.set(row.id, e.message||String(e));
  }
  refreshDistIndicator(row.id);
}

function openClickUpManageModal(){
  const allTasks=db.clickupTasks||[];
  const cuStatusColors={'to do':'#6b7280','in progress':'#d97706','in review':'#2563eb','complete':'#16a34a'};
  // shortName(): first segment of a project name, for the compact "→ project"
  // column. Splits on the first of –, — or " - "; the original split only on
  // en-dash, so real hyphenated names never matched and rendered in full.
  const shortName=n=>String(n||'').split(/\s[–—-]\s|[–—]/)[0].trim();
  let rows=allTasks.map(t=>{
    const assignedRow=db.rows.find(r=>r.clickupId===t.id && !isDetached(r));
    // A task with no live row may still have a parked one — data kept from a
    // previous assignment. That is a third state, not "unassigned": the label
    // has to say so, or the only way to find out is to assign it and be
    // surprised by what comes back.
    const parked=assignedRow?[]:detachedRowsFor(t.id);
    const rawName=assignedRow
      ? (db.rows.find(r=>r.id===assignedRow.parentId)||{name:'Unknown'}).name
      : '';
    let label, title='', buttons;
    if(assignedRow){
      label='→ '+shortName(rawName);
      title=rawName;
      buttons='<button class="btn btn-ghost btn-sm mrow-btn mrow-btn-unassign" title="Remove from the project — the task and its data are kept" onclick="detachCuTaskAll(\''+t.id+'\')">Remove</button>';
    } else if(parked.length){
      const from=db.rows.find(r=>r.id===parked[0].detachedFrom);
      label='unassigned · data kept';
      title='Removed from '+(from?from.name:'a deleted project')
        +(parked[0].detachedAt?' on '+fmtDate(parked[0].detachedAt.slice(0,10)):'')
        +' — assigning it to a project restores everything.';
      buttons='<button class="btn btn-ghost btn-sm mrow-btn mrow-btn-assign" onclick="closeClickUpManageModal();openAssignCuTaskModal(\''+t.id+'\')">Assign</button>'
        +'<button class="btn btn-ghost btn-sm mrow-btn mrow-btn-discard" title="Permanently delete the hub data kept for this task" onclick="discardCuTaskData(\''+t.id+'\')">Discard</button>';
    } else {
      label='unassigned';
      buttons='<button class="btn btn-ghost btn-sm mrow-btn mrow-btn-assign" onclick="closeClickUpManageModal();openAssignCuTaskModal(\''+t.id+'\')">Assign</button>';
    }
    return '<div class="mrow">'+
      '<div class="mrow-dot" style="background:'+(cuStatusColors[t.status]||'#6b7280')+'"></div>'+
      '<span class="mrow-name" title="'+esc(t.name)+'">'+esc(t.name)+'</span>'+
      '<span class="mrow-assigned'+(assignedRow?'':' is-unassigned')+'"'+(title?' title="'+esc(title)+'"':'')+'>'+esc(label)+'</span>'+
      buttons+
    '</div>';
  }).join('');

  // Parked rows whose ClickUp task is no longer in the synced list — the task
  // was deleted in ClickUp after someone removed it from a project here. The
  // loop above iterates db.clickupTasks, so without this pass those rows are
  // unreachable: invisible on the board, absent from the rail, and holding data
  // that can be neither restored nor discarded. Listed last, under their own
  // label, because "not in ClickUp any more" is a different problem from "not
  // on a project yet".
  const syncedIds=new Set(allTasks.map(t=>t.id));
  const orphanIds=[...new Set(db.rows.filter(r=>r.clickupId&&isDetached(r)&&!syncedIds.has(r.clickupId)).map(r=>r.clickupId))];
  rows+=orphanIds.map(cuId=>{
    const parked=detachedRowsFor(cuId)[0];
    const from=db.rows.find(r=>r.id===parked.detachedFrom);
    const title='Removed from '+(from?from.name:'a deleted project')
      +(parked.detachedAt?' on '+fmtDate(parked.detachedAt.slice(0,10)):'')
      +' — this task is no longer in the synced ClickUp list, but its data is still here.';
    return '<div class="mrow">'+
      '<div class="mrow-dot" style="background:#6b7280"></div>'+
      '<span class="mrow-name" title="'+esc(parked.name)+'">'+esc(parked.name)+'</span>'+
      '<span class="mrow-assigned is-unassigned" title="'+esc(title)+'">not in ClickUp · data kept</span>'+
      '<button class="btn btn-ghost btn-sm mrow-btn mrow-btn-assign" onclick="closeClickUpManageModal();openAssignCuTaskModal(\''+cuId+'\')">Assign</button>'+
      '<button class="btn btn-ghost btn-sm mrow-btn mrow-btn-discard" title="Permanently delete the hub data kept for this task" onclick="discardCuTaskData(\''+cuId+'\')">Discard</button>'+
    '</div>';
  }).join('');

  document.getElementById('cum-body').innerHTML=rows||'<div class="mrow-empty">No ClickUp tasks defined yet.</div>';
  document.getElementById('clickup-manage-overlay').classList.add('open');
}

function closeClickUpManageModal(){ document.getElementById('clickup-manage-overlay').classList.remove('open'); }

// Register on the app bus so other modules + inline handlers can reach these.
register({ openAssignCuTaskModal, closeAssignCuTaskModal, submitAssignCuTask, openClickUpManageModal, closeClickUpManageModal, detachCuRow, detachCuTaskAll, discardCuTaskData, detachedRowsFor, pushPhaseToClickUp, pushPhaseOnEdit, syncTaskPhase, phaseIndicatorHtml, pushDistDateOnEdit });
