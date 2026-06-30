// render.js — the core render orchestrator plus the cross-cutting row
// mutators (uf/setStatus/toggleField/...) and the detail-panel controller.
// Kept together because they share render() and the `ui` view state.

import { STATUS_LABELS, PHASE_LABELS, STATUS_CYCLE, ALL_TAGS, AM_LIST, DESIGNER_LIST, ANIMATOR_LIST, VO_LIST, PRODUCT_TYPE_LIST, PRODUCT_STYLE_MAP, PRODUCT_TIER_MAP, CLOSEOUT_ITEMS } from './data/constants.js';
import { esc, fmtDate, daysLeft, fmtNextActivity, tagColor, tagTextColor, statusBadge, phasePill, tagsHtml, df } from './utils.js';
import { db, save } from './db.js';
import { ui } from './state.js';
import { A, register } from './bus.js';

function getChildren(pid){ return db.rows.filter(r=>r.parentId===pid); }

function latestComment(row){ return row.comments&&row.comments.length ? row.comments[row.comments.length-1] : null; }

function render(){
  const wrap=document.getElementById('list-wrap');
  wrap.innerHTML='';

  const STATUS_ORDER = { kickoff:0, production:1, limbo:2, done:3, closed:4 };
  const STATUS_SECTION_LABELS = { kickoff:'Kickoff', production:'In Production', limbo:'In Limbo', done:'Done', closed:'Closed' };
  const parents=db.rows.filter(r=>r.parentId===null).sort((a,b)=>{
    const sd=(STATUS_ORDER[a.status]??9)-(STATUS_ORDER[b.status]??9);
    if(sd!==0) return sd;
    if(!a.due && !b.due) return 0;
    if(!a.due) return 1;
    if(!b.due) return -1;
    return new Date(a.due)-new Date(b.due);
  });

  // Group parents by status, only showing groups that have visible cards
  const groups = {};
  STATUS_CYCLE.forEach(s=>{ groups[s]=[]; });

  parents.forEach(parent=>{
    const children=getChildren(parent.id);
    if(ui.currentFilter!=='all'){
      const selfOk=A.matchesFilter(parent);
      const childOk=children.some(c=>A.matchesFilter(c));
      if(!selfOk&&!childOk) return;
    }
    groups[parent.status].push(parent);
  });

  STATUS_CYCLE.forEach(status=>{
    const groupParents=groups[status];
    if(!groupParents||!groupParents.length) return;

    // Section header
    const header=document.createElement('div');
    header.className='status-section-header';
    header.style.cursor='pointer';
    const sectionCollapsed=ui.sectionState[status]||false;
    header.innerHTML=`
      <span class="status-section-caret" style="font-size:10px;color:var(--text3);transition:transform .15s;display:inline-block;transform:${sectionCollapsed?'rotate(-90deg)':'rotate(0deg)'}"">▼</span>
      <span class="status-section-label ssl-${status}">${STATUS_SECTION_LABELS[status]}</span>
      <span class="status-section-count">${groupParents.length}</span>
      <div class="status-section-line sll-${status}"></div>`;
    header.onclick=()=>toggleSection(status);
    wrap.appendChild(header);

    if(sectionCollapsed) return;

    groupParents.forEach(parent=>{
      const children=getChildren(parent.id);

    const block=document.createElement('div');
    block.className='fps-block';
    block.id='block-'+parent.id;

    // ── FLIGHT PROGRESS STRIP ────────────────────────────────────────────
    const dl=parent.due?daysLeft(parent.due):null;
    const daysStr=dl!==null?(dl<0?`<span class="overdue-val">${dl}</span>`:`<span>${dl}</span>`):`<span class="muted">—</span>`;
    const lastComment=latestComment(parent);
    const hasKids=children.length>0;

    const strip=document.createElement('div');
    strip.className='fps'+(parent.io?'':' io-unchecked');
    strip.id='fps-'+parent.id;

    strip.innerHTML=`
      <div class="fps-tab fps-tab-${parent.status}${parent.io?' io-checked':''}"></div>
      <div class="fps-body">
        <div class="fps-top">
          <span class="fps-name" onclick="openDetail('${parent.id}')">${esc(parent.name)}</span>
          ${A.gmailLabelTags(parent)}
          <div class="fps-status-wrap" style="position:relative;flex-shrink:0">
            <select class="fps-status fps-status-${parent.status}" onchange="setStatus('${parent.id}',this.value)" style="cursor:pointer;padding-right:4px">
              ${STATUS_CYCLE.map(s=>`<option value="${s}"${parent.status===s?' selected':''}>${STATUS_LABELS[s]}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="fps-fields">
          <div class="fps-field" style="width:36px">
            <div class="fps-field-label">I/O</div>
            <div class="fps-field-val"><div class="fps-cb${parent.io?' on':''}" onclick="toggleField('${parent.id}','io')"></div></div>
          </div>
          <div class="fps-field" style="width:144px;flex-shrink:0">
            <div class="fps-field-label">Tags</div>
            <div class="fps-field-val">
              <div class="fps-tags">${(parent.tags||[]).length ? (parent.tags||[]).map(t=>`<span class="tag tag-${t.toLowerCase()}">${t}</span>`).join('') : '<span style="color:var(--ink-4)">—</span>'}</div>
            </div>
          </div>
          <div class="fps-field" style="width:440px;flex-shrink:1;min-width:150px">
            <div class="fps-field-label">Latest Comment</div>
            <div class="fps-field-val">
              <div class="fps-comment-wrap" id="fc-${parent.id}">
                <div class="fps-comment-preview" onclick="openStripComment('${parent.id}')" title="Click to add comment" style="cursor:pointer">
                  ${(parent.comments&&parent.comments.length)
                    ? esc(parent.comments[parent.comments.length-1].text.slice(0,120))
                    : '<span style="color:var(--ink-4)">Click to add a comment…</span>'}
                </div>
                <div class="fps-comment-composer" id="fcc-${parent.id}" style="display:none;margin-top:4px">
                  <input class="fps-comment-input" id="fci-${parent.id}" placeholder="Add a comment…"
                    onkeydown="if(event.key==='Enter'&&this.value.trim()){stripPostComment('${parent.id}',this.value);this.value='';closeStripComment('${parent.id}');event.preventDefault()}
                               if(event.key==='Escape'){closeStripComment('${parent.id}');event.preventDefault()}">
                </div>
              </div>
            </div>
          </div>
          <div class="fps-field" style="width:110px;flex-shrink:0">
            <div class="fps-field-label">Next Activity</div>
            <div class="fps-field-val" style="position:relative">
              ${(()=>{
                const label=fmtNextActivity(parent.nextActivity);
                const pastClass=label&&(label.startsWith('Last')||label==='Yesterday')?'past':label==='Today'?'today':label&&(label==='Tomorrow'||label.startsWith('Next'))?'soon':'';
                return `<span class="fps-next-label ${pastClass}" onclick="A.openDatePicker('${parent.id}','nextActivity','na-${parent.id}')" title="Click to set date" style="cursor:pointer">${label||'—'}</span>
                <input type="date" id="na-${parent.id}" value="${parent.nextActivity||''}" onchange="uf('${parent.id}','nextActivity',this.value)" style="position:absolute;opacity:0;width:0;height:0;top:0;left:0">`;
              })()}
            </div>
          </div>
          <div class="fps-field" style="width:96px;flex-shrink:0">
            <div class="fps-field-label">Days Left</div>
            <div class="fps-field-val fps-days-val" style="white-space:nowrap">${daysStr}</div>
          </div>
          <div class="fps-field" style="width:84px">
            <div class="fps-field-label">Due Date</div>
            <div class="fps-field-val" style="position:relative">
              <span class="fps-next-label${parent.due&&daysLeft(parent.due)<0?' past':''}" id="due-lbl-${parent.id}" onclick="A.openDatePicker('${parent.id}','due','due-lbl-${parent.id}')" style="cursor:pointer">${fmtDate(parent.due)||'—'}</span>
              <input type="date" id="due-inp-${parent.id}" value="${parent.due||''}" onchange="uf('${parent.id}','due',this.value)" style="position:absolute;opacity:0;width:0;height:0;top:0;left:0">
            </div>
          </div>
          <div class="fps-field" style="width:84px">
            <div class="fps-field-label">OE Start</div>
            <div class="fps-field-val" style="position:relative">
              <span class="fps-next-label" id="oe-lbl-${parent.id}" onclick="A.openDatePicker('${parent.id}','oeStart','oe-lbl-${parent.id}')" style="cursor:pointer">${fmtDate(parent.oeStart)||'—'}</span>
              <input type="date" id="oe-inp-${parent.id}" value="${parent.oeStart||''}" onchange="uf('${parent.id}','oeStart',this.value)" style="position:absolute;opacity:0;width:0;height:0;top:0;left:0">
            </div>
          </div>
          <div class="fps-field" style="width:84px">
            <div class="fps-field-label">AM</div>
            <div class="fps-field-val">
              <select class="fps-select" onchange="uf('${parent.id}','am',this.value)">
                <option value="">—</option>
                ${AM_LIST.map(a=>`<option value="${a}"${parent.am===a?' selected':''}>${a}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="fps-field" style="width:100px;flex-shrink:1;min-width:60px">
            <div class="fps-field-label">Zoho</div>
            <div class="fps-field-val">
              ${parent.zohoLink
                ? `<span style="display:flex;align-items:center;gap:4px">
                    <a href="${parent.zohoLink.startsWith('http')?'':'https://'}${esc(parent.zohoLink)}" target="_blank" style="font-size:12px;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70px;text-decoration:none" title="${esc(parent.zohoLink)}">${esc(parent.zohoLink.replace(/^https?:\/\//,'').split('/')[0])}</a>
                    <input class="fps-input" value="${esc(parent.zohoLink||'')}" placeholder="URL" onblur="uf('${parent.id}','zohoLink',this.value)" style="display:none" id="zh-inp-${parent.id}">
                    <span style="cursor:pointer;color:var(--text3);font-size:10px" onclick="toggleLinkEdit('zh-inp-${parent.id}','zh-lnk-${parent.id}')" id="zh-lnk-${parent.id}" title="Edit">✎</span>
                  </span>`
                : `<input class="fps-input" value="" placeholder="URL" onblur="uf('${parent.id}','zohoLink',this.value)">`
              }
            </div>
          </div>
          <div class="fps-field" style="width:100px;flex-shrink:1;min-width:60px">
            <div class="fps-field-label">Estimate</div>
            <div class="fps-field-val">
              ${parent.estimateLink
                ? `<span style="display:flex;align-items:center;gap:4px">
                    <a href="${parent.estimateLink.startsWith('http')?'':'https://'}${esc(parent.estimateLink)}" target="_blank" style="font-size:12px;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70px;text-decoration:none" title="${esc(parent.estimateLink)}">${esc(parent.estimateLink.replace(/^https?:\/\//,'').split('/')[0])}</a>
                    <input class="fps-input" value="${esc(parent.estimateLink||'')}" placeholder="URL" onblur="uf('${parent.id}','estimateLink',this.value)" style="display:none" id="est-inp-${parent.id}">
                    <span style="cursor:pointer;color:var(--text3);font-size:10px" onclick="toggleLinkEdit('est-inp-${parent.id}','est-lnk-${parent.id}')" id="est-lnk-${parent.id}" title="Edit">✎</span>
                  </span>`
                : `<input class="fps-input" value="" placeholder="URL" onblur="uf('${parent.id}','estimateLink',this.value)">`
              }
            </div>
          </div>
          <div class="fps-field" style="width:100px;flex-shrink:1;min-width:60px">
            <div class="fps-field-label">Dropbox</div>
            <div class="fps-field-val">
              ${parent.dropboxLink
                ? `<span style="display:flex;align-items:center;gap:4px">
                    <a href="${parent.dropboxLink.startsWith('http')?'':'https://'}${esc(parent.dropboxLink)}" target="_blank" style="font-size:12px;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70px;text-decoration:none" title="${esc(parent.dropboxLink)}">${esc(parent.dropboxLink.replace(/^https?:\/\//,'').split('/')[0])}</a>
                    <input class="fps-input" value="${esc(parent.dropboxLink||'')}" placeholder="URL" onblur="uf('${parent.id}','dropboxLink',this.value)" style="display:none" id="db-inp-${parent.id}">
                    <span style="cursor:pointer;color:var(--text3);font-size:10px" onclick="toggleLinkEdit('db-inp-${parent.id}','db-lnk-${parent.id}')" id="db-lnk-${parent.id}" title="Edit">✎</span>
                  </span>`
                : `<input class="fps-input" value="" placeholder="URL" onblur="uf('${parent.id}','dropboxLink',this.value)">`
              }
            </div>
          </div>
          <div class="fps-field" style="width:74px">
            <div class="fps-field-label">Branding</div>
            <div class="fps-field-val"><div class="fps-cb${parent.branding?' on':''}" onclick="toggleField('${parent.id}','branding')"></div></div>
          </div>
        </div>
      </div>`;
    block.appendChild(strip);

    // ── TOOL GRID ─────────────────────────────────────────────────────────
    const gridWrap = document.createElement('div');
    gridWrap.className = 'tool-grid-wrap';
    const _ap = parent.activePanel||'none';
    const _assignedIds = (parent.gmailLabels||[]);
    const _unread = (db.gmailEmails||[]).filter(e=>_assignedIds.some(lid=>(e.labelIds||[]).includes(lid))&&(e.labelIds||[]).includes('UNREAD')).length;
    const _tools = [
      {id:'subtasks', label:'Subtasks'},
      {id:'emails',   label:'Inbox', badge:_unread},
      {id:'timeline', label:'Timeline'},
      {id:'info',     label:'Info'},
      {id:'templates',label:'Templates'},
      {id:'metrics',  label:'Metrics'},
      {id:'invoices', label:'Invoices'},
      {id:'distro',   label:'Distro'},
      {id:'closeout', label:'Closeout'},
    ];
    const _toolGrid = document.createElement('div');
    _toolGrid.className = 'tool-grid';
    _tools.forEach(t=>{
      const btn = document.createElement('div');
      btn.className = 'tg-btn'+(_ap===t.id?' active':'');
      btn.title = t.label;
      btn.onclick = (()=>{ const _id=parent.id,_t=t.id; return ()=>setPanel(_id,_t); })();
      btn.innerHTML = '<span class="tg-btn-label">'+t.label+(t.badge?'<span class="tg-unread"></span>':'')+'</span>';
      _toolGrid.appendChild(btn);
    });
    gridWrap.appendChild(_toolGrid);
    strip.appendChild(gridWrap);

    // ── STRIP ACTIONS ─────────────────────────────────────────────────────
    const _actWrap = document.createElement('div');
    _actWrap.className = 'fps-actions-wrap';
    if(!['done','closed'].includes(parent.status)){
      const _subBtn = document.createElement('button');
      _subBtn.className = 'btn btn-ghost btn-sm';
      _subBtn.textContent = '+ Subtask';
      _subBtn.onclick = (()=>{ const _id=parent.id; return ()=>A.openSubtaskModal(_id); })();
      _actWrap.appendChild(_subBtn);
    }
    const _editBtn = document.createElement('button');
    _editBtn.className = 'btn btn-ghost btn-sm';
    _editBtn.textContent = 'Edit';
    _editBtn.onclick = (()=>{ const _id=parent.id; return ()=>A.openParentModal(_id); })();
    _actWrap.appendChild(_editBtn);
    const _delBtn = document.createElement('button');
    _delBtn.className = 'btn btn-danger btn-sm';
    _delBtn.textContent = '✕';
    _delBtn.onclick = (()=>{ const _id=parent.id; return ()=>deleteRow(_id); })();
    _actWrap.appendChild(_delBtn);
    strip.appendChild(_actWrap);

    // ── SUBTASK TABLE ─────────────────────────────────────────────────────
    const activePanel=parent.activePanel||'none';

    const subWrap=document.createElement('div');
    subWrap.className='subtask-wrap'+(activePanel!=='subtasks'?' hidden':'');
    subWrap.id='sub-'+parent.id;

    const table=document.createElement('table');
    table.className='sheet';
    table.innerHTML=`
      <thead><tr>
        <th class="th-name">Name</th>
        <th style="width:42px">I/O</th>
        <th class="th-tags">Tags</th>
        <th class="th-days">Days Left</th>
        <th class="th-due">Due Date</th>
        <th class="th-phase">Phase</th>
        <th style="width:90px">CU</th>
        <th class="th-update">New/Update</th>
        <th class="th-type">Product Type</th>
        <th class="th-tier">Product Tier</th>
        <th class="th-style">Product Style</th>
        <th class="th-designer">Designer</th>
        <th class="th-animator">Animator</th>
        <th class="th-vo">VO Artist</th>
        <th class="th-distdate">Dist. Date</th>
        <th class="th-act"></th>
      </tr></thead>
      <tbody id="tbody-${parent.id}"></tbody>`;
    subWrap.appendChild(table);
    const tbody=table.querySelector('tbody');
    const visibleChildren=ui.currentFilter==='all' ? children : children.filter(c=>A.matchesFilter(c));

    visibleChildren.forEach(task=>{
      const tdl=task.due?daysLeft(task.due):null;
      const daysCell=tdl!==null?`<span class="${tdl<0?'overdue':''}">${tdl}</span>`:`<span class="dash">—</span>`;
      const dotCls=`is-${task.status}`;
      const tr=document.createElement('tr');
      tr.id='tr-'+task.id;

      function taskSelect(field, list){
        const val=task[field]||'';
        return `<select style="font-family:var(--font);font-size: 12px;color:var(--text);background:none;border:none;outline:none;cursor:pointer;width:100%;max-width:130px" onchange="A.ufTask('${task.id}','${field}',this.value)">
          <option value="">—</option>
          ${list.map(n=>`<option value="${n}"${val===n?' selected':''}>${n}</option>`).join('')}
        </select>`;
      }

      tr.innerHTML=`
        <td class="td-name">
          <div class="name-inner">
            <div class="toggle-spacer"></div>
            <div class="row-dot ${dotCls}" onclick="A.openStatusMenu('${task.id}',event)" title="Set status"></div>
            <span class="task-name-text" onclick="openDetail('${task.id}')" style="${task.io?'font-style:italic;color:var(--text2)':''}">${esc(task.name)}</span>
          </div>
        </td>
        <td style="text-align:center"><div class="cb${task.io?' on':''}" onclick="A.toggleTaskIO('${task.id}')"></div></td>
        <td>${tagsHtml(task.tags)}</td>
        <td>${daysCell}</td>
        <td style="position:relative">
          <span class="fps-next-label${task.due&&daysLeft(task.due)<0?' past':''}" id="tdue-lbl-${task.id}" onclick="A.openTaskDatePicker('${task.id}','due','tdue-lbl-${task.id}')" style="cursor:pointer;font-size: 12px">${fmtDate(task.due)||'—'}</span>
          <input type="date" id="tdue-inp-${task.id}" value="${task.due||''}" onchange="A.ufTask('${task.id}','due',this.value);A.updateTaskDueLbl('${task.id}')" style="position:absolute;opacity:0;width:0;height:0;top:0;left:0">
        </td>
        <td>
          <select style="font-family:var(--font);font-size: 12px;color:var(--text);background:none;border:none;outline:none;cursor:pointer;width:100%;max-width:170px" onchange="A.ufTask('${task.id}','phase',this.value)">
            <option value="">—</option>
            ${Object.entries(PHASE_LABELS).map(([k,v])=>`<option value="${k}"${task.phase===k?' selected':''}>${v}</option>`).join('')}
          </select>
        </td>
        <td style="text-align:center">
          ${task.clickupUrl
            ? `<a href="${esc(task.clickupUrl)}" target="_blank" style="font-size:12px;color:var(--accent);text-decoration:none;font-family:var(--font-mono)" title="${esc(task.clickupUrl)}">${esc(task.clickupUrl.split('/').pop())}</a>`
            : '<span class="dash">—</span>'}
        </td>
        <td style="cursor:pointer" onclick="A.cycleNewUpdate('${task.id}')" title="Click to cycle">
          ${task.newOrUpdate==='New'?'<span class="pill pill-blue">New</span>':task.newOrUpdate==='Update'?'<span class="pill pill-orange">Update</span>':'<span class="dash">—</span>'}
        </td>
        <td>
          <select style="font-family:var(--font);font-size: 12px;color:var(--text);background:none;border:none;outline:none;cursor:pointer;width:100%;max-width:150px" onchange="A.ufTaskAndRender('${task.id}','productType',this.value)">
            <option value="">—</option>
            ${PRODUCT_TYPE_LIST.map(t=>`<option value="${t}"${task.productType===t?' selected':''}>${t}</option>`).join('')}
          </select>
        </td>
        <td>
          ${(()=>{
            const tiers=PRODUCT_TIER_MAP[task.productType]||[];
            if(!tiers.length) return `<span class="dash">—</span>`;
            return `<select style="font-family:var(--font);font-size: 12px;color:var(--text);background:none;border:none;outline:none;cursor:pointer;width:100%;max-width:150px" onchange="A.ufTask('${task.id}','productTier',this.value)">
              <option value="">—</option>
              ${tiers.map(t=>`<option value="${t}"${task.productTier===t?' selected':''}>${t}</option>`).join('')}
            </select>`;
          })()}
        </td>
        <td>${(()=>{const styles=PRODUCT_STYLE_MAP[task.productType]||[];if(!styles.length)return '<span class="dash">—</span>';return '<select style="font-family:var(--font);font-size:12px;color:var(--text);background:none;border:none;outline:none;cursor:pointer;width:100%;max-width:150px" onchange="A.ufTask(\''+task.id+'\',\'productStyle\',this.value)"><option value="">—</option>'+styles.map(s=>'<option value="'+s+'"'+(task.productStyle===s?' selected':'')+'>'+s+'</option>').join('')+'</select>';})()}</td>
        <td>${taskSelect('designer',DESIGNER_LIST)}</td>
        <td>${taskSelect('animator',ANIMATOR_LIST)}</td>
        <td>${taskSelect('voArtist',VO_LIST)}</td>
        <td style="position:relative">
          <span class="fps-next-label" id="dist-lbl-${task.id}" onclick="A.openTaskDatePicker('${task.id}','distributionDate','dist-lbl-${task.id}')" style="cursor:pointer;font-size: 12px">${fmtDate(task.distributionDate)||'—'}</span>
          <input type="date" id="dist-inp-${task.id}" value="${task.distributionDate||''}" onchange="A.ufTask('${task.id}','distributionDate',this.value);document.getElementById('dist-lbl-${task.id}').textContent=this.value?fmtDate(this.value):'—'" style="position:absolute;opacity:0;width:0;height:0;top:0;left:0">
        </td>
        <td style="text-align:center">
          <button class="btn btn-ghost btn-sm" style="padding:1px 5px;font-size: 11px;color:var(--ink-3)" onclick="deleteRow('${task.id}')">✕</button>
        </td>`;
      tbody.appendChild(tr);
    });

    const addTr=document.createElement('tr');
    addTr.className='add-task-row';
    addTr.innerHTML=`
      <td class="td-name" style="background:var(--panel-2)">
        <div class="name-inner">
          <div class="toggle-spacer"></div>
          <button class="add-task-btn" onclick="A.openSubtaskModal('${parent.id}')">
            <span style="font-size: 14px;line-height:1">+</span>&nbsp;Add subtask
          </button>
        </div>
      </td>
      <td colspan="15"></td>`;
    tbody.appendChild(addTr);

    block.appendChild(subWrap);

    // ── EMAIL PANEL ────────────────────────────────────────────────────────
    const emailWrap=document.createElement('div');
    emailWrap.className='email-wrap'+(activePanel!=='emails'?' hidden':'');
    emailWrap.id='email-'+parent.id;

    const assignedLabelIds=(parent.gmailLabels||[]);
    const matchedEmails=(db.gmailEmails||[]).filter(e=>
      assignedLabelIds.some(lid=>e.labelIds&&e.labelIds.includes(lid))
    ).sort((a,b)=>new Date(b.date)-new Date(a.date));

    const emailTable=document.createElement('table');
    emailTable.className='email-sheet';
    emailTable.innerHTML=`
      <thead><tr>
        <th style="width:90px">Labels</th>
        <th style="width:200px">From</th>
        <th style="width:410px">Subject</th>
        <th style="width:100px">Latest</th>
        <th style="width:70px">Open</th>
      </tr></thead>
      <tbody id="emailbody-${parent.id}"></tbody>`;
    emailWrap.appendChild(emailTable);

    const emailTbody=emailTable.querySelector('tbody');

    if(!assignedLabelIds.length){
      const noLabelRow=document.createElement('tr');
      noLabelRow.innerHTML=`<td colspan="5" class="email-no-label">No Gmail labels assigned — use the sidebar to assign a label to this project.</td>`;
      emailTbody.appendChild(noLabelRow);
    } else if(!matchedEmails.length){
      const emptyRow=document.createElement('tr');
      emptyRow.innerHTML=`<td colspan="5" class="email-no-label">No emails found for assigned label(s).</td>`;
      emailTbody.appendChild(emptyRow);
    } else {
      matchedEmails.forEach(email=>{
        const isUnread=(email.labelIds||[]).includes('UNREAD');
        const unreadStyle=isUnread?'font-weight:700;color:var(--text)':'';
        const labelNames=(email.labelIds||[]).filter(lid=>lid!=='UNREAD'&&!(parent.gmailLabels||[]).includes(lid)).map(lid=>{
          const lbl=(db.gmailLabelDefs||[]).find(l=>l.id===lid);
          if(!lbl) return '';
          const displayName = lbl.name.includes('/') ? lbl.name.split('/').pop() : lbl.name;
          return `<span class="email-label-pill" style="background:${lbl.bgColor||'#dcfce7'};color:${lbl.textColor||'#14532d'}">${esc(displayName)}</span>`;
        }).join('');
        const tr=document.createElement('tr');
        tr.innerHTML=`
          <td style="max-width:90px;${unreadStyle}">${labelNames||'<span class="dash">—</span>'}</td>
          <td style="max-width:200px;${unreadStyle}">${esc(email.from||'—')}</td>
          <td style="max-width:410px;${unreadStyle}">${esc(email.subject||'—')}</td>
          <td style="white-space:nowrap;${unreadStyle}">${esc(email.date||'—')}</td>
          <td style="text-align:center">
            ${email.threadId
              ? `<a class="email-link" href="https://mail.google.com/mail/u/0/#all/${esc(email.threadId)}" target="_blank">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3M10 2h4m0 0v4m0-4L7 9"/></svg>
                  Open
                </a>`
              : '<span class="dash">—</span>'}
          </td>`;
        emailTbody.appendChild(tr);
      });
    }
    block.appendChild(emailWrap);

    // ── INVOICE TABLE ──────────────────────────────────────────────────────
    const invWrap=document.createElement('div');
    invWrap.className='inv-wrap'+(activePanel!=='invoices'?' hidden':'');
    invWrap.id='inv-'+parent.id;

    const INV_TASKS=['design','animation','voiceover'];
    const INV_STATUSES=['received','documented','zohod','paid'];
    const INV_STATUS_LABELS={received:'Received',documented:'Documented',zohod:"Zoho'd",paid:'Paid'};

    const invTable=document.createElement('table');
    invTable.className='inv-sheet';
    invTable.innerHTML=`
      <thead><tr>
        <th style="width:90px">Sent</th>
        <th style="width:160px">Vendor</th>
        <th style="width:120px">Invoice #</th>
        <th style="width:90px">Amount</th>
        <th style="width:200px">Tasks</th>
        <th style="width:120px">Status</th>
        <th style="width:34px"></th>
      </tr></thead>
      <tbody id="invbody-${parent.id}"></tbody>`;
    invWrap.appendChild(invTable);

    const invTbody=invTable.querySelector('tbody');
    const invoices=parent.invoices||[];

    invoices.forEach((inv,idx)=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td><input class="inv-input" type="date" value="${inv.sent||''}" onchange="A.updateInvoice('${parent.id}',${idx},'sent',this.value)" style="width:86px"></td>
        <td><input class="inv-input" value="${esc(inv.vendor||'')}" placeholder="Vendor" onblur="A.updateInvoice('${parent.id}',${idx},'vendor',this.value)"></td>
        <td><input class="inv-input" value="${esc(inv.number||'')}" placeholder="INV-000" onblur="A.updateInvoice('${parent.id}',${idx},'number',this.value)"></td>
        <td><input class="inv-input" value="${esc(inv.amount||'')}" placeholder="0.00" onblur="A.updateInvoice('${parent.id}',${idx},'amount',this.value)" style="width:80px"></td>
        <td>
          <div style="display:flex;gap:4px;align-items:center">
            ${INV_TASKS.map(t=>{
              const on=(inv.tasks||[]).includes(t);
              return `<button onclick="A.toggleInvTask('${parent.id}',${idx},'${t}')" style="font-family:var(--font);font-size: 11px;font-weight:600;padding:2px 7px;border-radius:3px;border:1.5px solid ${on?'transparent':'var(--line-2)'};cursor:pointer;background:${on?(t==='design'?'rgba(146,180,244,0.2)':t==='animation'?'rgba(189,147,189,0.22)':'rgba(69,187,200,0.18)'):'var(--panel)'};color:${on?(t==='design'?'#AcC6F4':t==='animation'?'#D2ADD2':'#7FD6E0'):'var(--ink-3)'};transition:all .13s">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`;
            }).join('')}
          </div>
        </td>
        <td>
          <select class="inv-select" onchange="A.updateInvoice('${parent.id}',${idx},'status',this.value)">
            ${INV_STATUSES.map(s=>`<option value="${s}"${inv.status===s?' selected':''}>${INV_STATUS_LABELS[s]}</option>`).join('')}
          </select>
        </td>
        <td style="text-align:center">
          <button class="btn btn-ghost btn-sm" style="padding:1px 5px;font-size: 11px;color:var(--ink-3)" onclick="A.deleteInvoice('${parent.id}',${idx})">✕</button>
        </td>`;
      invTbody.appendChild(tr);
    });

    // add invoice row
    const addInvTr=document.createElement('tr');
    addInvTr.className='add-task-row';
    addInvTr.innerHTML=`
      <td>
        <button class="add-inv-btn" onclick="A.addInvoice('${parent.id}')">
          <span style="font-size: 14px;line-height:1">+</span>&nbsp;Add invoice
        </button>
      </td>
      <td colspan="6"></td>`;
    invTbody.appendChild(addInvTr);
    block.appendChild(invWrap);

    // ── CLOSEOUT PANEL ─────────────────────────────────────────────────────
    {
      const coWrap=document.createElement('div');
      coWrap.className='closeout-wrap'+(activePanel!=='closeout'?' hidden':'');
      coWrap.id='co-'+parent.id;

      const closeout=parent.closeout||{};
      const total=CLOSEOUT_ITEMS.length;
      const completed=Object.values(closeout).filter(Boolean).length;
      const pct=Math.round(completed/total*100);

      coWrap.innerHTML=`
        <div class="closeout-progress">
          <div class="closeout-bar-wrap"><div class="closeout-bar" id="co-bar-${parent.id}" style="width:${pct}%"></div></div>
          <span class="closeout-count" id="co-count-${parent.id}">${completed} / ${total}</span>
        </div>
        <div class="closeout-grid">
          ${CLOSEOUT_ITEMS.map((item,i)=>{
            const done=!!closeout[i];
            return `<div class="closeout-item" onclick="A.toggleCloseoutItem('${parent.id}',${i})">
              <div class="closeout-check${done?' done':''}" id="co-check-${parent.id}-${i}"></div>
              <span class="closeout-label${done?' done':''}" id="co-label-${parent.id}-${i}">${esc(item)}</span>
            </div>`;
          }).join('')}
        </div>`;
      block.appendChild(coWrap);
    }

    // ── STUB PANELS ────────────────────────────────────────────────────────
    const _stubDefs=[
      { id:'timeline',  label:'Timeline',     body:'Gantt chart and feasibility check. The Timeline Tool will live here — dates and deliverables pre-fill from this project.' },
      { id:'info',      label:'Info',         body:'Project contacts, Zoho CRM link, Dropbox link, estimate link, and other key reference fields.' },
      { id:'templates', label:'Templates',    body:'Email drafts and kickoff document generator — all fields pre-filled from client name, contacts, deliverables, and dates.' },
      { id:'metrics',   label:'Metrics',      body:'Activity log, days spent per phase, and project health summary.' },
      { id:'distro',    label:'Distribution', body:'Build and send review link or final delivery emails. Contacts and deliverable links pre-fill from this project.' },
    ];
    _stubDefs.forEach(s=>{
      const w=document.createElement('div');
      w.className='closeout-wrap'+(activePanel!==s.id?' hidden':'');
      w.id=s.id+'-stub-'+parent.id;
      w.innerHTML='<div style="padding:34px 20px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">'+
        '<div style="font-family:var(--font-display);font-size:20px;font-weight:600;color:var(--ink);letter-spacing:0.2px">'+s.label+'</div>'+
        '<div style="font-size:13px;color:var(--ink-3);max-width:440px;line-height:1.7">'+s.body+'</div>'+
        '<div style="font-family:var(--font-mono);font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-4);border:1px solid var(--line-2);border-radius:20px;padding:3px 11px;margin-top:6px">Coming soon</div>'+
        '</div>';
      block.appendChild(w);
    });

    wrap.appendChild(block);
    }); // end groupParents.forEach
  }); // end STATUS_CYCLE.forEach

  // Add new project button
  const addRow=document.createElement('div');
  addRow.className='add-strip-row';
  addRow.innerHTML=`<button class="add-strip-btn" onclick="A.openParentModal()"><span style="font-size: 17px;line-height:1">+</span> New Project</button>`;
  wrap.appendChild(addRow);
}

function toggleSection(status){
  ui.sectionState[status]=!ui.sectionState[status];
  render();
}

function toggleLinkEdit(inputId, btnId){
  const inp=document.getElementById(inputId);
  const btn=document.getElementById(btnId);
  if(!inp) return;
  const hidden=inp.style.display==='none';
  inp.style.display=hidden?'inline-block':'none';
  if(btn) btn.textContent=hidden?'✕':'✎';
  if(hidden){ inp.focus(); inp.select(); }
}

function setPanel(id, panel){
  const r=db.rows.find(x=>x.id===id); if(!r)return;
  r.activePanel = r.activePanel===panel ? 'none' : panel;
  save(); render();
}

function toggleParent(id){
  const r=db.rows.find(x=>x.id===id); if(!r)return;
  r.collapsed=!r.collapsed;
  save(); render();
}

function setStatus(id, value){
  const r=db.rows.find(x=>x.id===id); if(!r)return;
  const oldStatus=r.status;
  if(oldStatus===value){ r.status=value; save(); render(); return; }
  A.logActivity(r,'status',oldStatus,value);

  // Only animate parent strips that will actually move sections
  const block=document.getElementById('block-'+id);
  if(!block || r.parentId!==null){
    r.status=value; save(); render(); return;
  }

  // Slide out
  block.classList.add('animating-out');
  setTimeout(()=>{
    r.status=value; save(); render();
    // Double rAF: first frame lets DOM settle, second triggers animation after paint
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        const newBlock=document.getElementById('block-'+id);
        if(newBlock){
          newBlock.classList.add('animating-in');
          newBlock.addEventListener('animationend',()=>{
            newBlock.classList.remove('animating-in');
          },{once:true});
        }
        if(ui.detailId===id) openDetail(id);
      });
    });
  }, 280);
}

function cycleStatus(id){
  const r=db.rows.find(x=>x.id===id); if(!r)return;
  const next=STATUS_CYCLE[(STATUS_CYCLE.indexOf(r.status)+1)%STATUS_CYCLE.length];
  setStatus(id, next);
}

function toggleField(id,field){
  const r=db.rows.find(x=>x.id===id); if(!r)return;
  const old=r[field];
  r[field]=!r[field];
  A.logActivity(r,field,old,r[field]);
  save(); render();
}

function toggleBranding(id){ toggleField(id,'branding'); }

function toggleTag(id,tag){
  const r=db.rows.find(x=>x.id===id); if(!r)return;
  if(!r.tags) r.tags=[];
  const oldTags=[...r.tags];
  const idx=r.tags.indexOf(tag);
  if(idx>=0) r.tags.splice(idx,1); else r.tags.push(tag);
  A.logActivity(r,'tags',oldTags,[...r.tags]);
  save(); render();
  if(ui.detailId===id) openDetail(id);
}

function uf(id,field,value){
  const r=db.rows.find(x=>x.id===id); if(!r)return;
  const old=r[field];
  r[field]=value;
  A.logActivity(r,field,old,value);
  save();
  // Only full re-render for fields that change visible strip elements
  const isParent=r.parentId===null;
  const needsRender=['status','activePanel','tags','io','branding'].includes(field)
    || (field==='due' && isParent); // due date on parents affects sort order
  if(needsRender){ render(); return; }
  // For date fields on parent rows, refresh just the days-left cell and detail meta
  if(field==='due'){
    const block=document.getElementById('block-'+id);
    if(block){
      const dl=r.due?daysLeft(r.due):null;
      const daysEl=block.querySelector('.fps-days-val');
      if(daysEl) daysEl.innerHTML=dl!==null?(dl<0?`<span class="overdue-val">${dl}</span>`:`<span>${dl}</span>`):`<span class="dash">—</span>`;
    }
  }
  if(field==='nextActivity'){
    const block=document.getElementById('block-'+id);
    if(block){
      const label=fmtNextActivity(r.nextActivity);
      const pastClass=!label?'':label==='Yesterday'||label.endsWith('ago')?'past':label==='Today'?'today':label==='Tomorrow'||(!label.endsWith('ago')&&label!=='Today'&&label!=='Yesterday')?'soon':'';
      const naEl=block.querySelector('.fps-next-label');
      if(naEl){ naEl.textContent=label||'—'; naEl.className='fps-next-label '+pastClass; }
      const naInput=document.getElementById('na-'+id);
      if(naInput) naInput.value=r.nextActivity||'';
    }
  }
  if(ui.detailId===id){
    document.getElementById('dp-meta').innerHTML=`${statusBadge(r.status)} ${phasePill(r.phase)} ${tagsHtml(r.tags)}`;
  }
}

function deleteRow(id){
  const r=db.rows.find(x=>x.id===id); if(!r)return;
  const kids=getChildren(id);
  if(!confirm(kids.length?'Delete this project and all its tasks?':'Delete this task?')) return;
  db.rows=db.rows.filter(x=>x.id!==id&&x.parentId!==id);
  if(ui.detailId===id) closeDetail();
  save(); render();
}

function openDetail(id){
  const row=db.rows.find(r=>r.id===id); if(!row)return;
  ui.detailId=id;
  const isParent=row.parentId===null;
  document.getElementById('dp-title').textContent=row.name;
  document.getElementById('dp-meta').innerHTML=`${statusBadge(row.status)} ${phasePill(row.phase)} ${tagsHtml(row.tags)}`;

  const fields=isParent ? `
    ${df('Status',`<select class="fi" onchange="uf('${id}','status',this.value)">${STATUS_CYCLE.map(s=>`<option value="${s}"${row.status===s?' selected':''}>${STATUS_LABELS[s]}</option>`).join('')}</select>`)}
    ${df('I/O',`<input type="checkbox"${row.io?' checked':''} onchange="uf('${id}','io',this.checked)">`)}
    ${df('Tags',`<div style="display:flex;gap:4px;flex-wrap:wrap;">${ALL_TAGS.map(t=>{const a=(row.tags||[]).includes(t);return `<button onclick="toggleTag('${id}','${t}')" style="font-family:var(--font);font-size: 12px;font-weight:400;padding:3px 9px;border-radius:3px;border:1.5px solid ${a?'transparent':'var(--line-2)'};cursor:pointer;color:${a?tagTextColor(t):'var(--ink-3)'};background:${a?tagColor(t):'var(--panel-2)'};transition:all .13s">${t}</button>`}).join('')}</div>`)}
    ${df('Due Date',`<input class="fi" type="date" value="${row.due||''}" onchange="uf('${id}','due',this.value)" style="width:160px">`)}
    ${df('OE Start',`<input class="fi" type="date" value="${row.oeStart||''}" onchange="uf('${id}','oeStart',this.value)" style="width:160px">`)}
    ${df('AM',`<select class="fi" onchange="uf('${id}','am',this.value)"><option value="">—</option>${AM_LIST.map(a=>`<option value="${a}"${row.am===a?' selected':''}>${a}</option>`).join('')}</select>`)}
    ${df('Zoho Link',`<input class="fi" value="${esc(row.zohoLink||'')}" onblur="uf('${id}','zohoLink',this.value)">`)}
    ${df('Estimate',`<input class="fi" value="${esc(row.estimateLink||'')}" onblur="uf('${id}','estimateLink',this.value)">`)}
    ${df('Dropbox',`<input class="fi" value="${esc(row.dropboxLink||'')}" onblur="uf('${id}','dropboxLink',this.value)">`)}
    ${df('Next Activity',`<input class="fi" type="date" value="${row.nextActivity||''}" onchange="uf('${id}','nextActivity',this.value)" style="width:160px">`)}
    ${df('Branding',`<input type="checkbox"${row.branding?' checked':''} onchange="uf('${id}','branding',this.checked)">`)}
  ` : `
    ${df('Status',`<select class="fi" onchange="uf('${id}','status',this.value)">${STATUS_CYCLE.map(s=>`<option value="${s}"${row.status===s?' selected':''}>${STATUS_LABELS[s]}</option>`).join('')}</select>`)}
    ${df('Phase',`<select class="fi" onchange="uf('${id}','phase',this.value)"><option value="">None</option>${Object.entries(PHASE_LABELS).map(([k,v])=>`<option value="${k}"${row.phase===k?' selected':''}>${v}</option>`).join('')}</select>`)}
    ${df('Tags',`<div style="display:flex;gap:4px;flex-wrap:wrap;">${ALL_TAGS.map(t=>{const a=(row.tags||[]).includes(t);return `<button onclick="toggleTag('${id}','${t}')" style="font-family:var(--font);font-size: 12px;font-weight:400;padding:3px 9px;border-radius:3px;border:1.5px solid ${a?'transparent':'var(--line-2)'};cursor:pointer;color:${a?tagTextColor(t):'var(--ink-3)'};background:${a?tagColor(t):'var(--panel-2)'};transition:all .13s">${t}</button>`}).join('')}</div>`)}
    ${df('Due Date',`<input class="fi" type="date" value="${row.due||''}" onchange="uf('${id}','due',this.value)" style="width:160px">`)}
    ${df('AM',`<select class="fi" onchange="uf('${id}','am',this.value)"><option value="">—</option>${AM_LIST.map(a=>`<option value="${a}"${row.am===a?' selected':''}>${a}</option>`).join('')}</select>`)}
    ${df('New / Update',`<select class="fi" onchange="uf('${id}','newOrUpdate',this.value)"><option value="">—</option><option value="New"${row.newOrUpdate==='New'?' selected':''}>New</option><option value="Update"${row.newOrUpdate==='Update'?' selected':''}>Update</option></select>`)}
    ${df('Product Type','<select class="fi" onchange="'+(isParent?'uf(\''+id+'\',\'productType\',this.value)':'A.ufTaskAndRender(\''+id+'\',\'productType\',this.value)')+'"><option value="">—</option>'+PRODUCT_TYPE_LIST.map(t=>'<option value="'+t+'"'+(row.productType===t?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select>')}
    ${df('Product Tier',(()=>{const tiers=PRODUCT_TIER_MAP[row.productType]||[];if(!tiers.length)return '<span style="font-size:12px;color:var(--text3)">Select a Product Type first</span>';return '<select class="fi" onchange="uf(\''+id+'\',\'productTier\',this.value)"><option value="">—</option>'+tiers.map(t=>'<option value="'+t+'"'+(row.productTier===t?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select>';})())}
    ${df('Product Style',(()=>{const styles=PRODUCT_STYLE_MAP[row.productType]||[];if(!styles.length)return '<span style="font-size:12px;color:var(--text3)">N/A for this product type</span>';return '<select class="fi" onchange="uf(\''+id+'\',\'productStyle\',this.value)"><option value="">—</option>'+styles.map(s=>'<option value="'+s+'"'+(row.productStyle===s?' selected':'')+'>'+esc(s)+'</option>').join('')+'</select>';})())}
    ${df('Branding',`<input type="checkbox"${row.branding?' checked':''} onchange="uf('${id}','branding',this.checked)">`)}
    ${df('Zoho Link',`<input class="fi" value="${esc(row.zohoLink||'')}" onblur="uf('${id}','zohoLink',this.value)">`)}
    ${df('Dropbox',`<input class="fi" value="${esc(row.dropboxLink||'')}" onblur="uf('${id}','dropboxLink',this.value)">`)}
    ${df('Next Activity',`<input class="fi" type="date" value="${row.nextActivity||''}" onchange="uf('${id}','nextActivity',this.value)" style="width:160px">`)}
  `;

  document.getElementById('dp-body').innerHTML=`
    <div class="dp-section">
      <div class="dp-section-label">${isParent?'Project Fields':'Task Fields'}</div>
      ${fields}
    </div>
    <div class="dp-section">
      <div class="dp-section-label">Comments</div>
      <div class="comments-list">${renderComments(row)}</div>
      <textarea class="comment-box" id="dp-comment-input" placeholder="Add a comment…"></textarea>
      <div style="margin-top:6px;display:flex;justify-content:flex-end">
        <button class="btn btn-primary btn-sm" onclick="postComment('${id}')">Post</button>
      </div>
    </div>
    <div class="dp-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;border-bottom:1px solid var(--border);padding-bottom:5px">
        <span class="dp-section-label" style="margin-bottom:0;border-bottom:none;padding-bottom:0">Activity Log</span>
        <div style="display:flex;gap:6px">
          ${isParent?`<button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="A.exportProjectActivity('${id}')">↓ Full Project CSV</button>`:''}
          <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="A.exportRowActivity('${id}')">↓ This ${isParent?'Project':'Task'} CSV</button>
        </div>
      </div>
      ${A.renderActivityLog(row)}
    </div>`;
  document.getElementById('detail-panel').classList.add('open');
}

function closeDetail(){ document.getElementById('detail-panel').classList.remove('open'); ui.detailId=null; }

function renderComments(row){
  if(!row.comments||!row.comments.length) return `<div class="no-comments">No comments yet.</div>`;
  return row.comments.map((c,i)=>`
    <div class="comment-card">
      <div class="comment-head">
        <span class="comment-author">${esc(c.author)}</span>
        <span class="comment-time">${esc(c.time)}</span>
        <button class="btn btn-ghost btn-sm" style="padding:1px 5px;font-size: 11px;color:var(--ink-3);margin-left:auto" onclick="delComment('${row.id}',${i})">✕</button>
      </div>
      <div class="comment-text">${esc(c.text)}</div>
    </div>`).join('');
}

function stripPostComment(id, txt){
  const row=db.rows.find(r=>r.id===id); if(!row||!txt.trim())return;
  if(!row.comments) row.comments=[];
  const now=new Date();
  row.comments.push({author:'Willis',time:now.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}),text:txt.trim()});
  save(); render();
  if(ui.detailId===id) openDetail(id);
}

function openStripComment(id){
  const composer=document.getElementById('fcc-'+id);
  const input=document.getElementById('fci-'+id);
  if(!composer||!input) return;
  composer.style.display='block';
  input.focus();
}

function closeStripComment(id){
  const composer=document.getElementById('fcc-'+id);
  if(composer) composer.style.display='none';
}

function postComment(id){
  const row=db.rows.find(r=>r.id===id); if(!row)return;
  const txt=document.getElementById('dp-comment-input').value.trim(); if(!txt)return;
  if(!row.comments) row.comments=[];
  const now=new Date();
  row.comments.push({author:'Willis',time:now.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}),text:txt});
  document.getElementById('dp-comment-input').value='';
  save(); render(); openDetail(id);
}

function delComment(id,idx){
  const row=db.rows.find(r=>r.id===id); if(!row||!row.comments)return;
  row.comments.splice(idx,1);
  save(); render(); openDetail(id);
}

// Register on the app bus so other modules + inline handlers can reach these.
register({ getChildren, latestComment, render, toggleSection, toggleLinkEdit, setPanel, toggleParent, setStatus, cycleStatus, toggleField, toggleBranding, toggleTag, uf, deleteRow, openDetail, closeDetail, renderComments, stripPostComment, openStripComment, closeStripComment, postComment, delComment });
