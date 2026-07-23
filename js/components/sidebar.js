// sidebar.js — left sidebar: view/status filters, sidebar collapse, and the
// Gmail + ClickUp sidebar lists and unassigned banners.

import { esc } from '../utils.js';
import { db, save } from '../store.js';
import { ui } from '../state.js';
import { A, register } from '../bus.js';

function matchesFilter(row){
  const today=new Date(); today.setHours(0,0,0,0);
  if(ui.currentFilter==='all') return true;
  if(ui.currentFilter==='production') return row.status==='production';
  if(ui.currentFilter==='kickoff')    return row.status==='kickoff';
  if(ui.currentFilter==='limbo')      return row.status==='limbo';
  if(ui.currentFilter==='done')       return row.status==='done';
  if(ui.currentFilter==='closed')     return row.status==='closed';
  if(ui.currentFilter==='overdue')    return row.due && new Date(row.due+'T00:00:00')<today && !['done','closed'].includes(row.status);
  if(ui.currentFilter==='nophase')    return !row.phase;
  return true;
}

function setFilter(f,el){
  ui.currentFilter=f;
  document.querySelectorAll('.sidebar-item').forEach(i=>i.classList.remove('active'));
  el.classList.add('active');
  const t={all:'All Projects',production:'In Production',kickoff:'Kickoff',limbo:'In Limbo',done:'Done',closed:'Closed',overdue:'Overdue',nophase:'No Phase'};
  document.getElementById('page-title').textContent=t[f]||'All Projects';
  A.render();
}

function toggleSidebar(){
  const sb=document.querySelector('.sidebar');
  sb.classList.toggle('collapsed');
}

function renderGmailBanner(){
  const prefix=(db.gmailClientPrefix||'').toLowerCase();
  const allLabels=(db.gmailLabelDefs||[]).filter(l=>!prefix||l.name.toLowerCase().startsWith(prefix));
  const assignedIds=new Set(db.rows.flatMap(r=>r.gmailLabels||[]));
  const unassigned=allLabels.filter(l=>!assignedIds.has(l.id)).length;
  const banner=document.getElementById('gmail-banner');
  const count=document.getElementById('gmail-banner-count');
  const plural=document.getElementById('gmail-banner-plural');
  if(!banner) return;
  if(unassigned===0){ banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  count.textContent=unassigned;
  plural.textContent=unassigned===1?'':'s';
}

function renderCuBanner(){
  const allTasks=db.clickupTasks||[];
  const assignedIds=new Set(db.rows.filter(r=>r.clickupId).map(r=>r.clickupId));
  const unassigned=allTasks.filter(t=>!assignedIds.has(t.id)).length;
  const banner=document.getElementById('cu-banner');
  const count=document.getElementById('cu-banner-count');
  const plural=document.getElementById('cu-banner-plural');
  if(!banner) return;
  if(unassigned===0){ banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  count.textContent=unassigned;
  plural.textContent=unassigned===1?'':'s';
}

function renderClickUpSidebar(){
  const list=document.getElementById('clickup-task-list'); if(!list) return;
  const allTasks=db.clickupTasks||[];
  // A CU task is "assigned" if a db.rows entry exists with that clickupId
  const assignedCuIds=new Set(db.rows.filter(r=>r.clickupId).map(r=>r.clickupId));
  const unassigned=allTasks.filter(t=>!assignedCuIds.has(t.id));
  const cuStatusColors={'to do':'#6b7280','in progress':'#d97706','in review':'#2563eb','complete':'#16a34a'};
  if(!unassigned.length){
    list.innerHTML='<div style="padding:4px 14px;font-size:12px;color:var(--text3);font-style:italic">'+(allTasks.length?'All tasks assigned':'No tasks synced yet')+'</div>';
    return;
  }
  list.innerHTML=unassigned.map(t=>'<div class="cu-task-item">'+
    '<div class="cu-task-dot" style="background:'+(cuStatusColors[t.status]||'#6b7280')+'"></div>'+
    '<span class="cu-task-name" title="'+esc(t.name)+'">'+esc(t.name)+'</span>'+
    '<span class="cu-task-assign" onclick="A.openAssignCuTaskModal(\''+t.id+'\')">Assign</span>'+
  '</div>').join('');
}

function renderGmailSidebar(){
  const list=document.getElementById('gmail-label-list'); if(!list) return;
  const prefix=(db.gmailClientPrefix||'').toLowerCase();
  const prefixInput=document.getElementById('gmail-prefix-input');
  if(prefixInput&&prefixInput!==document.activeElement) prefixInput.value=db.gmailClientPrefix||'';
  const allLabels=db.gmailLabelDefs||[];
  const assignedLabelIds=new Set(db.rows.flatMap(r=>r.gmailLabels||[]));
  const labels=prefix
    ? allLabels.filter(l=>l.name.toLowerCase().startsWith(prefix) && !assignedLabelIds.has(l.id))
    : allLabels.filter(l=>!assignedLabelIds.has(l.id));
  if(!labels.length){ list.innerHTML=`<div style="padding:4px 14px;font-size:12px;color:var(--text3);font-style:italic">${allLabels.length?'All labels assigned':'No labels synced yet'}</div>`; return; }
  list.innerHTML=labels.map(lbl=>{
    const displayName = lbl.name.includes('/') ? lbl.name.split('/').pop() : lbl.name;
    return `<div class="gmail-label-item">
      <div class="gmail-label-dot" style="background:${lbl.bgColor||'#dcfce7'}"></div>
      <span class="gmail-label-name" title="${esc(lbl.name)}">${esc(displayName)}</span>
      <span class="gmail-label-assign" onclick="A.openAssignLabelModal('${lbl.id}')">Assign</span>
    </div>`;
  }).join('');
}

function saveGmailPrefix(val){
  db.gmailClientPrefix=val.trim();
  save(); renderGmailSidebar(); renderGmailBanner();
}

// Register on the app bus so other modules + inline handlers can reach these.
register({ matchesFilter, setFilter, toggleSidebar, renderGmailBanner, renderCuBanner, renderClickUpSidebar, renderGmailSidebar, saveGmailPrefix });
