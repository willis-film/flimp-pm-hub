// subtasks.js — per-task field mutations used by the Subtasks panel table.

import { fmtDate } from '../utils.js';
import { db, save } from '../db.js';
import { A, register } from '../bus.js';

function ufTask(id, field, value){
  const r=db.rows.find(x=>x.id===id); if(!r)return;
  const old=r[field];
  r[field]=value;
  A.logActivity(r,field,old,value);
  save();
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

// Register on the app bus so other modules + inline handlers can reach these.
register({ ufTask, ufTaskAndRender, toggleTaskIO, cycleNewUpdate, updateTaskDueLbl });
