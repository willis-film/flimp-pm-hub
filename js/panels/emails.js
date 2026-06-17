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
    if(!lbl) return '<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:#f3f4f6;color:#9ca3af;white-space:nowrap;border:1px dashed #d1d5db" title="Label no longer active">label moved<span onclick="removeGmailLabel(\''+parent.id+'\',\''+lid+'\')" style="cursor:pointer;font-size:10px;opacity:0.6;margin-left:2px;line-height:1" title="Remove">\u2715</span></span>';
    const displayName=lbl.name.includes('/')?lbl.name.split('/').pop():lbl.name;
    return '<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:'+lbl.bgColor+';color:'+lbl.textColor+';white-space:nowrap">'+esc(displayName)+'<span onclick="removeGmailLabel(\''+parent.id+'\',\''+lid+'\')" style="cursor:pointer;font-size:10px;opacity:0.6;margin-left:2px;line-height:1" title="Remove">\u2715</span></span>';
  }).join('');
  return '<div style="display:flex;gap:3px;align-items:center;flex-shrink:0;flex-wrap:nowrap">'+pills+'</div>';
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
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
      <div style="width:10px;height:10px;border-radius:50%;background:${lbl.bgColor||'#dcfce7'};flex-shrink:0"></div>
      <span style="flex:1;font-size:13px">${esc(displayName)}</span>
      <span style="font-size:11px;color:var(--text3)">${isAssigned?'→ '+assigned.map(r=>r.name.split('–')[0].trim()).join(', '):'unassigned'}</span>
      ${isAssigned
        ? `<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px;color:#b91c1c" onclick="unassignLabelAndRefresh('${lbl.id}')">Unassign</button>`
        : `<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px;color:#4f5de8" onclick="closeGmailLabelModal();openAssignLabelModal('${lbl.id}')">Assign</button>`}
    </div>`;
  }).join('')||`<div style="font-size:13px;color:var(--text3);font-style:italic">No labels match the current prefix.</div>`;
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
