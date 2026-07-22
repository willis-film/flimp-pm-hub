// clickup.js — ClickUp integration: assign / unassign tasks to projects.

import { esc } from './utils.js';
import { db, save } from './db.js';
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
    id:'r'+Date.now(),
    parentId:projectId,
    clickupId:cuTask.id,
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
register({ openAssignCuTaskModal, closeAssignCuTaskModal, submitAssignCuTask, openClickUpManageModal, closeClickUpManageModal, unassignCuTaskAll });
