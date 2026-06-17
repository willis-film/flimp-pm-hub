// modals.js — modal + popup controllers: date picker popup, product-tier
// cascade, the New/Edit Project modal, and the New/Edit Task modal.

import { PRODUCT_TIER_MAP, PHASE_LABELS } from '../data/constants.js';
import { esc, fmtDate, fmtNextActivity } from '../utils.js';
import { db, save } from '../db.js';
import { A, register } from '../bus.js';

let _dpRowId=null, _dpField=null, _dpTaskId=null, _dpTaskField=null;
let editingParentId=null, editingSubtaskId=null;

function openDatePicker(rowId, field, anchorId){
  _dpRowId=rowId; _dpField=field;
  const row=db.rows.find(r=>r.id===rowId);
  const popup=document.getElementById('date-popup');
  const input=document.getElementById('date-popup-input');
  input.value=row&&row[field]?row[field]:'';
  const anchor=document.getElementById(anchorId)||event.target;
  const rect=anchor.getBoundingClientRect();
  popup.style.top=(rect.bottom+6)+'px';
  popup.style.left=Math.min(rect.left, window.innerWidth-200)+'px';
  popup.classList.add('open');
  setTimeout(()=>input.focus(),50);
}

function openTaskDatePicker(taskId, field, anchorId){
  // Reuse popup but wire to ufTask
  _dpRowId=null; _dpField=null;
  _dpTaskId=taskId; _dpTaskField=field;
  const task=db.rows.find(r=>r.id===taskId);
  const popup=document.getElementById('date-popup');
  const input=document.getElementById('date-popup-input');
  input.value=task&&task[field]?task[field]:'';
  const anchor=document.getElementById(anchorId)||event.target;
  const rect=anchor.getBoundingClientRect();
  popup.style.top=(rect.bottom+6)+'px';
  popup.style.left=Math.min(rect.left, window.innerWidth-200)+'px';
  popup.classList.add('open');
  setTimeout(()=>input.focus(),50);
}

function datePopupChange(val){
  if(_dpRowId&&_dpField){
    A.uf(_dpRowId,_dpField,val);
    // Refresh the clicked label directly
    const lbl=document.getElementById((_dpField==='due'?'due-lbl-':_dpField==='oeStart'?'oe-lbl-':'na-lbl-')+_dpRowId);
    if(lbl) lbl.textContent=val?(_dpField==='nextActivity'?(fmtNextActivity(val)||val):fmtDate(val)):'—';
  } else if(_dpTaskId&&_dpTaskField){
    A.ufTask(_dpTaskId,_dpTaskField,val);
    const prefix=_dpTaskField==='due'?'tdue-lbl-':'dist-lbl-';
    const lbl=document.getElementById(prefix+_dpTaskId);
    if(lbl) lbl.textContent=val?fmtDate(val):'—';
  }
}

function datePopupClear(){
  document.getElementById('date-popup-input').value='';
  datePopupChange('');
  closeDatePopup();
}

function closeDatePopup(){
  document.getElementById('date-popup').classList.remove('open');
  _dpRowId=null; _dpField=null; _dpTaskId=null; _dpTaskField=null;
}

function updateModalTiers(type, selectedTier){
  const sel=document.getElementById('sm-tier');
  const tiers=PRODUCT_TIER_MAP[type]||[];
  sel.innerHTML=tiers.length
    ? '<option value="">—</option>'+tiers.map(t=>`<option value="${t}"${t===selectedTier?' selected':''}>${t}</option>`).join('')
    : '<option value="">— select type first —</option>';
}

function openParentModal(editId){
  editingParentId=editId||null;
  const row=editId?db.rows.find(r=>r.id===editId):null;
  document.getElementById('pm-modal-title').textContent=editId?'Edit Project':'New Project';
  document.getElementById('pm-name').value=row?row.name:'';
  document.getElementById('pm-status').value=row?row.status:'production';
  document.getElementById('pm-due').value=row?row.due||'':'';
  document.getElementById('pm-oestart').value=row?row.oeStart||'':'';
  document.getElementById('pm-am').value=row?row.am||'':'';
  document.getElementById('pm-submit').textContent=editId?'Save':'Create Project';
  document.getElementById('parent-overlay').classList.add('open');
  setTimeout(()=>document.getElementById('pm-name').focus(),50);
}

function closeParentModal(){ document.getElementById('parent-overlay').classList.remove('open'); }

function submitParent(){
  const name=document.getElementById('pm-name').value.trim(); if(!name)return;
  const fields={name,status:document.getElementById('pm-status').value,due:document.getElementById('pm-due').value,oeStart:document.getElementById('pm-oestart').value,am:document.getElementById('pm-am').value};
  if(editingParentId){ Object.assign(db.rows.find(r=>r.id===editingParentId),fields); }
  else { db.rows.push({id:'r'+Date.now(),parentId:null,collapsed:false,phase:'',tags:[],io:false,branding:false,newOrUpdate:'',productType:'',productTier:'',productStyle:'',zohoLink:'',estimateLink:'',dropboxLink:'',nextActivity:null,closeout:{},comments:[],...fields}); }
  save(); A.render(); closeParentModal();
}

function openSubtaskModal(defaultParentId,editId){
  editingSubtaskId=editId||null;
  const row=editId?db.rows.find(r=>r.id===editId):null;
  const parents=db.rows.filter(r=>r.parentId===null);
  const sel=document.getElementById('sm-parent');
  sel.innerHTML=`<option value="">(No parent)</option>`+parents.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  sel.value=defaultParentId||'';
  document.getElementById('sm-modal-title').textContent=editId?'Edit Task':'New Task';
  document.getElementById('sm-name').value=row?row.name:'';
  document.getElementById('sm-status').value=row?row.status:'production';
  const phaseSel=document.getElementById('sm-phase');
  phaseSel.innerHTML='<option value="">None</option>'+Object.entries(PHASE_LABELS).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('');
  phaseSel.value=row?row.phase||'':'';
  document.getElementById('sm-type').value=row?row.productType||'':'';
  updateModalTiers(row?row.productType||'':'', row?row.productTier||'':'');
  document.getElementById('sm-due').value=row?row.due||'':'';
  document.getElementById('sm-am').value=row?row.am||'':'';
  document.getElementById('sm-update').value=row?row.newOrUpdate||'':'';
  document.getElementById('sm-submit').textContent=editId?'Save':'Create Task';
  document.getElementById('subtask-overlay').classList.add('open');
  setTimeout(()=>document.getElementById('sm-name').focus(),50);
}

function closeSubtaskModal(){ document.getElementById('subtask-overlay').classList.remove('open'); }

function submitSubtask(){
  const name=document.getElementById('sm-name').value.trim(); if(!name)return;
  const parentId=document.getElementById('sm-parent').value||null;
  const fields={name,parentId,status:document.getElementById('sm-status').value,phase:document.getElementById('sm-phase').value||null,tags:[],due:document.getElementById('sm-due').value,io:false,branding:false,oeStart:'',am:document.getElementById('sm-am').value,newOrUpdate:document.getElementById('sm-update').value,productType:document.getElementById('sm-type').value,productTier:document.getElementById('sm-tier').value,productStyle:'',zohoLink:'',dropboxLink:'',nextActivity:null,comments:[]};
  if(editingSubtaskId){ Object.assign(db.rows.find(r=>r.id===editingSubtaskId),fields); }
  else { db.rows.push({id:'r'+Date.now(),collapsed:false,...fields}); }
  save(); A.render(); closeSubtaskModal();
}

// Register on the app bus so other modules + inline handlers can reach these.
register({ openDatePicker, openTaskDatePicker, datePopupChange, datePopupClear, closeDatePopup, updateModalTiers, openParentModal, closeParentModal, submitParent, openSubtaskModal, closeSubtaskModal, submitSubtask });

// Global click closes the date popup when clicking outside it (original listener).
document.addEventListener('click',function(e){
  const popup=document.getElementById('date-popup');
  if(popup.classList.contains('open')&&!popup.contains(e.target)&&!e.target.classList.contains('fps-next-label')) closeDatePopup();
});
