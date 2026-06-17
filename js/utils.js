// utils.js — pure, stateless helpers: escaping, date formatting, small HTML
// snippet builders, and CSV utilities. Extracted verbatim from the original.
// No DOM mutation and no app-state mutation lives here.

import {
  STATUS_LABELS, PHASE_LABELS, PRODUCT_TIER_MAP, PRODUCT_STYLE_MAP,
} from './data/constants.js';

// ── ESCAPING / FORMATTING ────────────────────────────────────────────────────
export function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function fmtDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return `${+m}/${+d}/${y.slice(2)}`;
}

export function daysLeft(iso) {
  if (!iso) return null;
  const due = new Date(iso + 'T00:00:00');
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((due - t) / 86400000);
}

export function fmtNextActivity(iso) {
  if (!iso) return null;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const date = new Date(iso + 'T00:00:00');
  if (isNaN(date.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((date - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff <= 7) return DAYS[date.getDay()];
  if (diff < 0) return Math.abs(diff) + ' days ago';
  return fmtDate(iso);
}

// ── COLORS ───────────────────────────────────────────────────────────────────
export function tagColor(t) {
  return { EV: '#E8985E', DP: '#92DCE5', HRLV: '#CCB7AE', PPTV: '#BD93BD', TRAN: '#FABC2A', FCV: '#177E89', TV: '#92B4F4', SUB: '#8D918B', RC: '#0B7189', VBS: '#33658A' }[t] || '#6b7280';
}
export function tagTextColor(t) {
  return { DP: '#0e6b74', HRLV: '#5a4036', TRAN: '#7a5200', TV: '#1a3a7a' }[t] || '#fff';
}

// ── SMALL HTML SNIPPET BUILDERS ──────────────────────────────────────────────
export function statusBadge(s) { return `<span class="badge badge-${s}">${STATUS_LABELS[s] || s}</span>`; }
export function phasePill(p) { if (!p) return `<span class="dash">—</span>`; return `<span class="phase-pill phase-${p}">${PHASE_LABELS[p] || p}</span>`; }
export function tagsHtml(tags) { if (!tags || !tags.length) return `<span class="dash">—</span>`; return `<div class="tags-wrap">${tags.map(t => `<span class="tag tag-${t.toLowerCase()}">${t}</span>`).join('')}</div>`; }
export function linkHtml(url) { if (!url) return `<span class="dash">—</span>`; const short = url.replace(/^https?:\/\//, '').split('/')[0]; return `<span class="link-cell"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3M10 2h4m0 0v4m0-4L7 9"/></svg>${esc(short)}</span>`; }
export function avatarHtml(a) { if (!a) return `<span class="dash">—</span>`; const init = a[0]; return `<div class="avatar av-${init}" title="${esc(a)}">${init}</div>`; }

// df(): detail-panel field row wrapper.
export function df(label, html) { return `<div class="dp-field"><div class="dp-field-label">${label}</div><div class="dp-field-val">${html}</div></div>`; }

// ── CSV ──────────────────────────────────────────────────────────────────────
export function csvEscape(val) {
  const s = String(val || '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
