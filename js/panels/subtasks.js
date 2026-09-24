// subtasks.js — per-task field mutations used by the Subtasks panel table.

import { esc, fmtDate } from '../utils.js';
import { db, save } from '../store.js';
import { A, register } from '../bus.js';

function ufTask(id, field, value){
  const r=db.rows.find(x=>x.id===id); if(!r)return;
  const old=r[field];
  r[field]=value;
  A.logActivity(r,field,old,value);
  save();
  // Phase is the one field this app owns that ClickUp also has a home for, so
  // it's mirrored outward on change — but only once AUTO_PUSH_PHASE is on. It
  // is off for now, and the ⟳ button in the Phase cell is what actually writes.
  // Either way this runs AFTER save(), never instead of it: the board's copy
  // lands regardless of whether ClickUp answers.
  if(field==='phase') A.pushPhaseOnEdit(r);
  if(field==='distributionDate') A.pushDistDateOnEdit(r);
}

function ufTaskAndRender(id, field, value){
  const r=db.rows.find(x=>x.id===id); if(!r)return;
  const old=r[field];
  r[field]=value;
  if(field==='productType') r.productTier='';
  A.logActivity(r,field,old,value);
  save(); A.render();
}

function toggleTaskIO(id){
  const r=db.rows.find(x=>x.id===id); if(!r)return;
  const old=r.io;
  r.io=!r.io;
  A.logActivity(r,'io',old,r.io);
  save(); A.render();
}

function cycleNewUpdate(id){
  const r=db.rows.find(x=>x.id===id); if(!r)return;
  const cycle=['','New','Update'];
  const old=r.newOrUpdate||'';
  const idx=cycle.indexOf(old);
  r.newOrUpdate=cycle[(idx+1)%cycle.length];
  A.logActivity(r,'newOrUpdate',old,r.newOrUpdate);
  save(); A.render();
}

function updateTaskDueLbl(taskId){
  const r=db.rows.find(x=>x.id===taskId); if(!r)return;
  const lbl=document.getElementById('tdue-lbl-'+taskId);
  if(lbl) lbl.textContent=r.due?fmtDate(r.due):'—';
}

// Same job for the Dist. Date cell. This used to be an inline
// document.getElementById(...).textContent inside the cell's own onchange —
// safe only because that column was always rendered. Columns can now be
// hidden (SUBTASK_COLS), so a cell's element id can be absent from the DOM; an
// unguarded lookup would throw on the null. Guarded here, like its Due Date
// twin above, rather than left as a latent crash in a template string.
function setDistLbl(taskId, val){
  const lbl=document.getElementById('dist-lbl-'+taskId);
  if(lbl) lbl.textContent=val?fmtDate(val):'—';
}

// ── REVIEW LINK POPOVER ──────────────────────────────────────────────────────
//
// The Review cell is ONE cell over TWO fields (reviewStudioLink, boordsLink),
// labelled from whichever is set. The strip's inline single input can't edit
// that: one box can't show that the other link exists, and adding the second
// would mean typing over the first with nothing promising it survives. Two
// labelled boxes remove the question.
//
// Review links only. Dropbox is its own column with one link, so it uses the
// strip's inline edit instead (see the dropbox cell in subtask-columns.js).

let _lpId = null;

function openLinkPair(taskId){
  const r=db.rows.find(x=>x.id===taskId); if(!r)return;
  const pop=document.getElementById('link-pair-pop');
  const anchor=document.getElementById('lp-anchor-'+taskId);
  if(!pop||!anchor)return;
  if(_lpId) closeLinkPair();
  _lpId=taskId;
  pop.innerHTML=`
    <label class="lp-lab" for="lp-rs">ReviewStudio</label>
    <input class="lp-inp" id="lp-rs" value="${esc(r.reviewStudioLink||'')}" placeholder="Paste URL">
    <label class="lp-lab" for="lp-bo">Boords</label>
    <input class="lp-inp" id="lp-bo" value="${esc(r.boordsLink||'')}" placeholder="Paste URL">`;
  pop.classList.add('open');
  pop.querySelectorAll('.lp-inp').forEach(inp=>{
    inp.addEventListener('keydown',e=>{
      if(e.key==='Enter'){ e.preventDefault(); closeLinkPair(); }
      else if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closeLinkPair(); }
    });
  });
  positionLinkPair();
  document.getElementById('lp-rs').focus();
  document.addEventListener('mousedown',linkPairAway,true);
  window.addEventListener('resize',positionLinkPair);
  document.getElementById('list-wrap').addEventListener('scroll',positionLinkPair);
  // The sheet scrolls HORIZONTALLY under the popover — a listener the strip's
  // popovers never needed, because nothing they anchor to moves sideways.
  const wrap=anchor.closest('.subtask-wrap');
  if(wrap) wrap.addEventListener('scroll',positionLinkPair);
}

function positionLinkPair(){
  if(!_lpId)return;
  const pop=document.getElementById('link-pair-pop');
  const anchor=document.getElementById('lp-anchor-'+_lpId);
  if(!pop||!anchor)return;
  const r=anchor.getBoundingClientRect();
  const w=250;
  pop.style.width=w+'px';
  pop.style.left=Math.max(12,Math.min(r.left-8,window.innerWidth-w-12))+'px';
  const h=pop.offsetHeight;
  const roomBelow=window.innerHeight-r.bottom-14;
  pop.style.top=(roomBelow>=h||roomBelow>=r.top-14 ? r.bottom+6 : Math.max(12,r.top-h-6))+'px';
}

function linkPairAway(e){
  const pop=document.getElementById('link-pair-pop');
  if(pop&&pop.contains(e.target))return;
  closeLinkPair();
}

function closeLinkPair(){
  if(!_lpId)return;
  const id=_lpId;
  const pop=document.getElementById('link-pair-pop');
  const rs=document.getElementById('lp-rs'), bo=document.getElementById('lp-bo');
  const r=db.rows.find(x=>x.id===id);
  // Commit on close rather than per-keystroke, and only when something moved —
  // a no-op edit shouldn't cost a save() and a full repaint.
  let changed=false;
  if(r&&rs&&bo){
    const nrs=rs.value.trim(), nbo=bo.value.trim();
    if((r.reviewStudioLink||'')!==nrs){ r.reviewStudioLink=nrs; changed=true; }
    if((r.boordsLink||'')!==nbo){ r.boordsLink=nbo; changed=true; }
  }
  const anchor=document.getElementById('lp-anchor-'+id);
  const sw=anchor?anchor.closest('.subtask-wrap'):null;
  if(pop){ pop.classList.remove('open'); pop.innerHTML=''; pop.style.width=''; }
  document.removeEventListener('mousedown',linkPairAway,true);
  window.removeEventListener('resize',positionLinkPair);
  const lw=document.getElementById('list-wrap');
  if(lw) lw.removeEventListener('scroll',positionLinkPair);
  if(sw) sw.removeEventListener('scroll',positionLinkPair);
  _lpId=null;
  if(changed){ save(); A.render(); }
}

// Dropbox's inline input commits on blur. Only writes when the value moved, so
// opening the field and leaving it untouched costs no save or repaint.
function setDropboxLink(taskId, raw){
  const r=db.rows.find(x=>x.id===taskId); if(!r)return;
  const v=(raw||'').trim();
  if((r.dropboxLink||'')===v) return;
  ufTask(taskId,'dropboxLink',v);
  A.render();
}

// Register on the app bus so other modules + inline handlers can reach these.
register({ ufTask, ufTaskAndRender, toggleTaskIO, cycleNewUpdate, updateTaskDueLbl, setDistLbl,
           openLinkPair, closeLinkPair, setDropboxLink });
