// clickup.js — ClickUp integration: assign / unassign tasks to projects.

import { esc, newId } from './utils.js';
import { db, save } from './store.js';
import { PHASE_LABELS } from './data/constants.js';
import { A, register } from './bus.js';

let _assigningCuTaskId=null;

function openAssignCuTaskModal(taskId){
  _assigningCuTaskId=taskId;
  const task=(db.clickupTasks||[]).find(t=>t.id===taskId);
  document.getElementById('acm-title').textContent='Assign "'+(task?task.name:'')+'" to a project';
  const sel=document.getElementById('acm-project');
  const parents=db.rows.filter(r=>r.parentId===null);
  sel.innerHTML='<option value="">— select a project —</option>'+parents.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');
  document.getElementById('assign-cu-overlay').classList.add('open');
}

function closeAssignCuTaskModal(){ document.getElementById('assign-cu-overlay').classList.remove('open'); _assigningCuTaskId=null; }

function submitAssignCuTask(){
  const projectId=document.getElementById('acm-project').value; if(!projectId||!_assigningCuTaskId) return;
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

// ── PHASE WRITE-BACK ─────────────────────────────────────────────────────────
// TESTING POSTURE: phase edits do NOT reach ClickUp on their own. Each synced
// subtask carries its own ⟳ button in the Phase cell, so a write happens only
// when someone points at one row and asks for it. That keeps a bad field
// mapping (or a bad match) to one task instead of quietly rewriting every
// subtask the moment its phase is touched.
//
// The automatic path is written and wired — every phase editor already calls
// pushPhaseOnEdit() — it's just switched off here. Flipping this to true is
// the whole change when per-row confirmation stops being wanted; nothing at
// the call sites needs revisiting.
const AUTO_PUSH_PHASE = false;

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
function pushPhaseOnEdit(row){
  if(!AUTO_PUSH_PHASE) return;
  pushPhaseToClickUp(row);
}

// The per-row ⟳ button in the Subtasks table's Phase cell. Pushes THIS
// subtask's phase and reports back on the button itself, because there is
// nowhere else for the result to go: the write is invisible from this side of
// the app, and a button that just sprang back to ⟳ would look identical
// whether ClickUp took the value or refused it. The failure reason lands in
// the tooltip, in full, so it can be read without opening the console.
async function syncTaskPhase(taskId, btn){
  const row=db.rows.find(r=>r.id===taskId); if(!row) return;
  const restore=btn?{ text:btn.textContent, color:btn.style.color, title:btn.title }:null;
  if(btn){ btn.disabled=true; btn.textContent='…'; btn.title='Writing phase to ClickUp…'; }

  const result=await pushPhaseToClickUp(row);

  // The row can be re-rendered out from under an in-flight push (any edit
  // anywhere calls render()), which leaves this button detached. Writing to a
  // detached node is harmless, so there's no need to guard — but it does mean
  // the result may go unseen, which is the other reason it's also console'd.
  if(btn){
    btn.textContent=result.ok?'✓':'✕';
    // --sig-closed / --sig-alert, not a fresh pair of hexes: those are the
    // palette's existing green and red. (--sig-done is deliberately NOT used
    // for the success state — it's the light blue of the Done status, and would
    // read as a status colour rather than a result.)
    btn.style.color=result.ok?'var(--sig-closed)':'var(--sig-alert)';
    btn.title=result.ok
      ? (result.cleared?'Phase cleared in ClickUp':'Phase written to ClickUp')
      : ('ClickUp sync failed — '+result.error);
    setTimeout(()=>{
      btn.disabled=false;
      btn.textContent=restore.text;
      btn.style.color=restore.color;
      btn.title=restore.title;
    },2500);
  }
}

function openClickUpManageModal(){
  const allTasks=db.clickupTasks||[];
  const cuStatusColors={'to do':'#6b7280','in progress':'#d97706','in review':'#2563eb','complete':'#16a34a'};
  document.getElementById('cum-body').innerHTML=allTasks.map(t=>{
    const assignedRow=db.rows.find(r=>r.clickupId===t.id);
    // shortName(): take the first segment of the project name for the compact
    // "→ project" column. Original split only on en-dash (–); real project
    // names use hyphens (-) and other separators, so it never fired and the
    // whole long name rendered. Split on the first of –, —, or " - ".
    const rawName=assignedRow?(db.rows.find(r=>r.id===assignedRow.parentId)||{name:'Unknown'}).name:'';
    const assignedToName=rawName.split(/\s[–—-]\s|[–—]/)[0].trim();
    const isAssigned=!!assignedRow;
    const assignedLabel=isAssigned?('→ '+assignedToName):'unassigned';
    return '<div class="mrow">'+
      '<div class="mrow-dot" style="background:'+(cuStatusColors[t.status]||'#6b7280')+'"></div>'+
      '<span class="mrow-name" title="'+esc(t.name)+'">'+esc(t.name)+'</span>'+
      '<span class="mrow-assigned'+(isAssigned?'':' is-unassigned')+'"'+(isAssigned?' title="'+esc(rawName)+'"':'')+'>'+esc(assignedLabel)+'</span>'+
      (isAssigned
        ? '<button class="btn btn-ghost btn-sm mrow-btn mrow-btn-unassign" onclick="unassignCuTaskAll(\''+t.id+'\')">Unassign</button>'
        : '<button class="btn btn-ghost btn-sm mrow-btn mrow-btn-assign" onclick="closeClickUpManageModal();openAssignCuTaskModal(\''+t.id+'\')">Assign</button>')+
    '</div>';
  }).join('')||'<div class="mrow-empty">No ClickUp tasks defined yet.</div>';
  document.getElementById('clickup-manage-overlay').classList.add('open');
}

function closeClickUpManageModal(){ document.getElementById('clickup-manage-overlay').classList.remove('open'); }

function unassignCuTaskAll(cuId){
  db.rows=db.rows.filter(r=>r.clickupId!==cuId);
  save(); A.render(); A.renderClickUpSidebar(); A.renderCuBanner(); openClickUpManageModal();
}

// Register on the app bus so other modules + inline handlers can reach these.
register({ openAssignCuTaskModal, closeAssignCuTaskModal, submitAssignCuTask, openClickUpManageModal, closeClickUpManageModal, unassignCuTaskAll, pushPhaseToClickUp, pushPhaseOnEdit, syncTaskPhase });
