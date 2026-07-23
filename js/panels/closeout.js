// closeout.js — Closeout checklist panel.

import { CLOSEOUT_ITEMS } from '../data/constants.js';
import { db, save } from '../store.js';
import { A, register } from '../bus.js';

function toggleCloseoutItem(parentId, idx){
  const r=db.rows.find(x=>x.id===parentId); if(!r) return;
  if(!r.closeout) r.closeout={};
  r.closeout[idx]=!r.closeout[idx];
  save();
  // Update just the checkbox and label without full re-render
  const check=document.getElementById('co-check-'+parentId+'-'+idx);
  const label=document.getElementById('co-label-'+parentId+'-'+idx);
  const done=r.closeout[idx];
  if(check){ check.className='closeout-check'+(done?' done':''); }
  if(label){ label.className='closeout-label'+(done?' done':''); }
  // Update progress bar
  const total=CLOSEOUT_ITEMS.length;
  const completed=Object.values(r.closeout).filter(Boolean).length;
  const bar=document.getElementById('co-bar-'+parentId);
  const count=document.getElementById('co-count-'+parentId);
  if(bar) bar.style.width=Math.round(completed/total*100)+'%';
  if(count) count.textContent=completed+' / '+total;
}

// Register on the app bus so other modules + inline handlers can reach these.
register({ toggleCloseoutItem });
