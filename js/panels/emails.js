// emails.js — Inbox panel: Gmail label pills, label assignment modals.

import { esc } from '../utils.js';
import { db, save } from '../db.js';
import { A, register } from '../bus.js';

let _assigningLabelId=null;

function gmailLabelTags(parent){
  const labels=(parent.gmailLabels||[]);
  if(!labels.length) return '';
  const pills=labels.map(lid=>{
    const lbl=(db.gmailLabelDefs||[]).find(l=>l.id===lid);
    if(!lbl) return '<span class="gl-pill gl-pill-moved" title="Label no longer active">label moved<span class="gl-pill-x" onclick="removeGmailLabel(\''+parent.id+'\',\''+lid+'\')" title="Remove">\u2715</span></span>';
    const displayName=lbl.name.includes('/')?lbl.name.split('/').pop():lbl.name;
    return '<span class="gl-pill" title="'+esc(lbl.name)+'"><span class="gl-pill-dot" style="background:'+(lbl.bgColor||'#9FB1BC')+'"></span>'+esc(displayName)+'<span class="gl-pill-x" onclick="removeGmailLabel(\''+parent.id+'\',\''+lid+'\')" title="Remove">\u2715</span></span>';
  }).join('');
  return '<div class="gl-pill-wrap">'+pills+'</div>';
}

function removeGmailLabel(projectId, labelId){
  const row=db.rows.find(r=>r.id===projectId); if(!row) return;
  row.gmailLabels=(row.gmailLabels||[]).filter(l=>l!==labelId);
  save(); A.render(); A.renderGmailSidebar(); A.renderGmailBanner();
}

function openAssignLabelModal(labelId){
  _assigningLabelId=labelId;
  const lbl=(db.gmailLabelDefs||[]).find(l=>l.id===labelId);
  document.getElementById('alm-title').textContent=`Assign "${lbl?lbl.name:''}" to a project`;
  const sel=document.getElementById('alm-project');
  const parents=db.rows.filter(r=>r.parentId===null);
  sel.innerHTML=`<option value="">— select a project —</option>`+parents.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  document.getElementById('assign-label-overlay').classList.add('open');
}

function closeAssignLabelModal(){ document.getElementById('assign-label-overlay').classList.remove('open'); _assigningLabelId=null; }

function submitAssignLabel(){
  const projectId=document.getElementById('alm-project').value; if(!projectId||!_assigningLabelId) return;
  const row=db.rows.find(r=>r.id===projectId); if(!row) return;
  if(!row.gmailLabels) row.gmailLabels=[];
  if(!row.gmailLabels.includes(_assigningLabelId)) row.gmailLabels.push(_assigningLabelId);
  save(); A.render(); A.renderGmailSidebar(); A.renderGmailBanner(); closeAssignLabelModal();
}

function openGmailLabelModal(){
  const prefix=(db.gmailClientPrefix||'').toLowerCase();
  const allLabels=db.gmailLabelDefs||[];
  const labels=prefix ? allLabels.filter(l=>l.name.toLowerCase().startsWith(prefix)) : allLabels;
  const parents=db.rows.filter(r=>r.parentId===null);
  document.getElementById('glm-body').innerHTML=labels.map(lbl=>{
    const displayName=lbl.name.includes('/')?lbl.name.split('/').pop():lbl.name;
    const assigned=parents.filter(r=>(r.gmailLabels||[]).includes(lbl.id));
    const isAssigned=assigned.length>0;
    // Split on the first real separator (–, —, or " - "); hyphenated names
    // previously slipped through an en-dash-only split and rendered in full.
    const assignedNames=assigned.map(r=>r.name.split(/\s[–—-]\s|[–—]/)[0].trim()).join(', ');
    const assignedLabel=isAssigned?('→ '+assignedNames):'unassigned';
    return `<div class="mrow">
      <div class="mrow-dot" style="background:${lbl.bgColor||'#dcfce7'}"></div>
      <span class="mrow-name" title="${esc(lbl.name)}">${esc(displayName)}</span>
      <span class="mrow-assigned${isAssigned?'':' is-unassigned'}"${isAssigned?` title="${esc(assigned.map(r=>r.name).join(', '))}"`:''}>${esc(assignedLabel)}</span>
      ${isAssigned
        ? `<button class="btn btn-ghost btn-sm mrow-btn mrow-btn-unassign" onclick="unassignLabelAndRefresh('${lbl.id}')">Unassign</button>`
        : `<button class="btn btn-ghost btn-sm mrow-btn mrow-btn-assign" onclick="closeGmailLabelModal();openAssignLabelModal('${lbl.id}')">Assign</button>`}
    </div>`;
  }).join('')||`<div class="mrow-empty">No labels match the current prefix.</div>`;
  document.getElementById('gmail-label-overlay').classList.add('open');
}

function closeGmailLabelModal(){ document.getElementById('gmail-label-overlay').classList.remove('open'); }

function unassignLabel(labelId){
  db.rows.forEach(r=>{ if(r.gmailLabels) r.gmailLabels=r.gmailLabels.filter(l=>l!==labelId); });
  save(); A.render(); A.renderGmailSidebar(); A.renderGmailBanner();
  openGmailLabelModal();
}

function unassignLabelAndRefresh(labelId){ unassignLabel(labelId); }

// Register on the app bus so other modules + inline handlers can reach these.
register({ gmailLabelTags, removeGmailLabel, openAssignLabelModal, closeAssignLabelModal, submitAssignLabel, openGmailLabelModal, closeGmailLabelModal, unassignLabel, unassignLabelAndRefresh });
