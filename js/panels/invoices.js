// invoices.js — Invoices panel: add / edit / delete invoice rows.

import { db, save } from '../db.js';
import { A, register } from '../bus.js';
import { newId } from '../utils.js';

function addInvoice(parentId){
  const r=db.rows.find(x=>x.id===parentId); if(!r)return;
  if(!r.invoices) r.invoices=[];
  r.invoices.push({id:newId('inv'),sent:'',vendor:'',number:'',amount:'',tasks:[],status:'received'});
  save(); A.render();
}

function updateInvoice(parentId, idx, field, value){
  const r=db.rows.find(x=>x.id===parentId); if(!r||!r.invoices)return;
  r.invoices[idx][field]=value;
  save();
}

function toggleInvTask(parentId, idx, task){
  const r=db.rows.find(x=>x.id===parentId); if(!r||!r.invoices)return;
  const inv=r.invoices[idx]; if(!inv)return;
  if(!inv.tasks) inv.tasks=[];
  const i=inv.tasks.indexOf(task);
  if(i>=0) inv.tasks.splice(i,1); else inv.tasks.push(task);
  save(); A.render();
}

function deleteInvoice(parentId, idx){
  const r=db.rows.find(x=>x.id===parentId); if(!r||!r.invoices)return;
  r.invoices.splice(idx,1);
  save(); A.render();
}

// Register on the app bus so other modules + inline handlers can reach these.
register({ addInvoice, updateInvoice, toggleInvTask, deleteInvoice });
