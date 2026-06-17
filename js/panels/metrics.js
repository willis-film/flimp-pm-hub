// metrics.js — Metrics panel: activity log formatting + CSV export.

import { STATUS_LABELS, ACTIVITY_FIELD_LABELS, ACTIVITY_SKIP } from '../data/constants.js';
import { esc, fmtDate, downloadCSV } from '../utils.js';
import { db } from '../db.js';
import { A, register } from '../bus.js';

function fmtActivityVal(field, val){
  if(val===null||val===undefined||val==='') return '—';
  if(field==='io'||field==='branding') return val?'Yes':'No';
  if(Array.isArray(val)) return val.length?val.join(', '):'—';
  if(field==='status') return STATUS_LABELS[val]||val;
  if((field==='due'||field==='oeStart'||field==='nextActivity'||field==='distributionDate')&&val) return fmtDate(val)||val;
  return String(val);
}

function logActivity(row, field, oldVal, newVal){
  if(ACTIVITY_SKIP.has(field)) return;
  if(!ACTIVITY_FIELD_LABELS[field]) return;
  const oldStr=fmtActivityVal(field,oldVal);
  const newStr=fmtActivityVal(field,newVal);
  if(oldStr===newStr) return;
  if(!row.activityLog) row.activityLog=[];
  const now=new Date();
  row.activityLog.unshift({
    time:now.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}),
    field,
    from:oldStr,
    to:newStr
  });
  if(row.activityLog.length>100) row.activityLog.length=100;
}

function renderActivityLog(row){
  const log=row.activityLog||[];
  if(!log.length) return '<div class="no-activity">No activity recorded yet.</div>';
  return '<div class="activity-list">'+log.map(e=>`
    <div class="activity-entry">
      <span class="activity-time">${esc(e.time)}</span>
      <span class="activity-field">${esc(ACTIVITY_FIELD_LABELS[e.field]||e.field)}</span>
      <span class="activity-change">
        <span class="activity-old">${esc(e.from)}</span>
        <span class="activity-new">${esc(e.to)}</span>
      </span>
    </div>`).join('')+'</div>';
}

function exportRowActivity(id){
  const row=db.rows.find(r=>r.id===id); if(!row) return;
  const log=row.activityLog||[];
  if(!log.length){ alert('No activity to export.'); return; }
  const headers=['Time','Field','From','To','Row Name'];
  const csvRows=[headers,...log.map(e=>[e.time, ACTIVITY_FIELD_LABELS[e.field]||e.field, e.from, e.to, row.name])];
  downloadCSV((row.name||'activity').replace(/[^a-z0-9]/gi,'_')+'_activity.csv', csvRows);
}

function exportProjectActivity(parentId){
  const parent=db.rows.find(r=>r.id===parentId); if(!parent) return;
  const children=db.rows.filter(r=>r.parentId===parentId);
  const allRows=[parent,...children];
  const headers=['Time','Field','From','To','Row Name','Row Type'];
  const csvRows=[headers];
  allRows.forEach(row=>{
    const type=row.parentId===null?'Project':'Task';
    (row.activityLog||[]).forEach(e=>{
      csvRows.push([e.time, ACTIVITY_FIELD_LABELS[e.field]||e.field, e.from, e.to, row.name, type]);
    });
  });
  if(csvRows.length===1){ alert('No activity to export.'); return; }
  // Sort all entries by time descending (most recent first)
  const sorted=[csvRows[0],...csvRows.slice(1).sort((a,b)=>new Date(b[0])-new Date(a[0]))];
  downloadCSV((parent.name||'project').replace(/[^a-z0-9]/gi,'_')+'_full_activity.csv', sorted);
}

// Register on the app bus so other modules + inline handlers can reach these.
register({ fmtActivityVal, logActivity, renderActivityLog, exportRowActivity, exportProjectActivity });
