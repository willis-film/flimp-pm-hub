// invoices.js — Invoices panel: add / edit / delete invoice rows, plus filing
// invoices that show up as 💰-labeled Gmail threads (see MONEY_LABEL_NAME).

import { db, save } from '../store.js';
import { A, register } from '../bus.js';
import { esc, newId, isProjectRow, gmailThreadUrl } from '../utils.js';
import { MONEY_LABEL_NAME } from '../data/constants.js';

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
  // Vendor is the one invoice field with a visible echo elsewhere on the
  // strip — the tool-grid "needs vendor" dot in render.js — so, same as
  // uf()'s needsRender set, it's the one edit here that needs a full
  // re-render rather than leaving the input's own value as the only trace.
  if(field==='vendor') A.render();
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

// ── 💰-LABELED EMAIL -> INVOICE ROW ──────────────────────────────────────────
//
// api/sync-gmail-threads.js pulls any thread carrying MONEY_LABEL_NAME into
// db.gmailEmails regardless of whether a project has claimed it (see the
// moneyLabel handling in that file). This module turns those threads into
// invoice rows.

function moneyLabelId(){
  const lbl=(db.gmailLabelDefs||[]).find(l=>l.name===MONEY_LABEL_NAME);
  return lbl?lbl.id:null;
}

// Every threadId already turned into an invoice, on any project. Filing an
// invoice is what takes a thread off the unfiled list — there's no separate
// dismiss step, and none is needed: a stray 💰 with no invoice wanted just
// never gets filed, and drops out of the banner the moment its label is
// removed in Gmail.
function filedThreadIds(){
  return new Set(db.rows.flatMap(r=>(r.invoices||[]).map(i=>i.threadId).filter(Boolean)));
}

// 💰-labeled threads nobody has filed yet, newest first. Shared by the sidebar
// banner (js/components/sidebar.js) and the manage modal below so both read
// one definition of "unfiled."
function unfiledMoneyThreads(){
  const mid=moneyLabelId(); if(!mid) return [];
  const filed=filedThreadIds();
  return (db.gmailEmails||[])
    .filter(e=>(e.labelIds||[]).includes(mid) && !filed.has(e.threadId))
    .sort((a,b)=>new Date(b.date)-new Date(a.date));
}

function blankInvoice(threadId){
  return {id:newId('inv'),sent:'',vendor:'',number:'',amount:'',tasks:[],status:'received',threadId};
}

// Run after every Gmail sync (see js/sync.js). A 💰 thread that ALSO carries a
// label some project has already claimed gets filed there automatically — a
// blank row with nothing but the source-email link, ready for the amount,
// vendor and invoice number to be read off the email and typed in. A thread
// with no matching project label is left alone; it surfaces in the
// unassigned-invoice-email banner instead, for a manual Assign.
function attachMoneyLabelInvoices(){
  const mid=moneyLabelId(); if(!mid) return false;
  const filed=filedThreadIds();
  const projects=db.rows.filter(isProjectRow);
  let changed=false;
  (db.gmailEmails||[]).forEach(email=>{
    if(!(email.labelIds||[]).includes(mid)) return;
    if(filed.has(email.threadId)) return;
    const project=projects.find(p=>(p.gmailLabels||[]).some(lid=>(email.labelIds||[]).includes(lid)));
    if(!project) return;
    if(!project.invoices) project.invoices=[];
    project.invoices.push(blankInvoice(email.threadId));
    filed.add(email.threadId);
    changed=true;
  });
  if(changed) save();
  return changed;
}

let _assigningMoneyThreadId=null;

function openMoneyManageModal(){
  const body=document.getElementById('mmm-body'); if(!body) return;
  const threads=unfiledMoneyThreads();
  body.innerHTML = threads.length ? threads.map(t=>`<div class="mrow">
      <div class="mrow-dot" style="background:#F2C94C"></div>
      <span class="mrow-name" title="${esc(t.subject)}">${esc(t.subject)}</span>
      <span class="mrow-assigned is-unassigned" title="${esc(t.from)}">${esc(t.from)}</span>
      <a class="btn btn-ghost btn-sm mrow-btn" href="${esc(gmailThreadUrl(t.threadId))}" target="_blank">Open</a>
      <button class="btn btn-ghost btn-sm mrow-btn mrow-btn-assign" onclick="closeMoneyManageModal();A.openAssignMoneyModal('${t.threadId}')">Assign</button>
    </div>`).join('') : `<div class="mrow-empty">No unassigned invoice emails.</div>`;
  document.getElementById('money-manage-overlay').classList.add('open');
}

function closeMoneyManageModal(){ document.getElementById('money-manage-overlay').classList.remove('open'); }

function openAssignMoneyModal(threadId){
  _assigningMoneyThreadId=threadId;
  const email=(db.gmailEmails||[]).find(e=>e.threadId===threadId);
  document.getElementById('amm-title').textContent='Assign "'+(email?email.subject:'invoice email')+'" to a project';
  const sel=document.getElementById('amm-project');
  const parents=db.rows.filter(isProjectRow);
  sel.innerHTML='<option value="">— select a project —</option>'+parents.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');
  document.getElementById('assign-money-overlay').classList.add('open');
}

function closeAssignMoneyModal(){ document.getElementById('assign-money-overlay').classList.remove('open'); _assigningMoneyThreadId=null; }

function submitAssignMoney(){
  const projectId=document.getElementById('amm-project').value; if(!projectId||!_assigningMoneyThreadId) return;
  const row=db.rows.find(r=>r.id===projectId); if(!row) return;
  if(!row.invoices) row.invoices=[];
  row.invoices.push(blankInvoice(_assigningMoneyThreadId));
  save(); A.render(); A.renderMoneyBanner(); closeAssignMoneyModal();
}

// Register on the app bus so other modules + inline handlers can reach these.
register({
  addInvoice, updateInvoice, toggleInvTask, deleteInvoice,
  attachMoneyLabelInvoices, unfiledMoneyThreads,
  openMoneyManageModal, closeMoneyManageModal,
  openAssignMoneyModal, closeAssignMoneyModal, submitAssignMoney
});
