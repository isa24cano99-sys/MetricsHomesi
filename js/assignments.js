import { state } from './state.js';
import { norm, getField, fmtNow, initials } from './utils.js';
import { BADGE } from './config.js';
import { sbFetch } from './supabase.js';
import { renderSummary } from './ui.js';
import { renderLog } from './log.js';

export function clearAssignFilters() {
  ['assign-filter-owner', 'assign-filter-branch', 'assign-filter-med'].forEach(id => {
    const el = document.getElementById(id);
    if (el) Array.from(el.options).forEach(o => o.selected = false);
  });
  const status = document.getElementById('assign-filter-status');
  if (status) status.value = '';
  renderAssignCards();
}

function getAssignStatus(key) {
  const m = state.masterMap.get(key);
  if (!m || !m.owner) return 'unassigned';
  if (m.confirmed === true || m.confirmed === 'true') return 'confirmed';
  return 'pending';
}

export function renderAssignCards() {
  const search = document.getElementById('assign-search').value.toLowerCase();
  const filterStatus = document.getElementById('assign-filter-status').value;
  const filterOwners = Array.from(document.getElementById('assign-filter-owner').selectedOptions).map(o => o.value).filter(Boolean);
  const owners = document.getElementById('owners-list').value.split(',').map(s => s.trim().replace(/^["']+|["']+$/g, '').trim()).filter(s => s !== '');
  const allResults = [...state.activeResults, ...state.inactiveResults];

  const leadCountMap = new Map();
  for (const row of (state.leadsData || [])) {
    const ref = getField(row, 'Referred By', 'referred by');
    if (ref) { const k = norm(String(ref)); leadCountMap.set(k, (leadCountMap.get(k) || 0) + 1); }
  }
  const oppCountMap = new Map();
  for (const row of (state.oppData || [])) {
    const ref = getField(row, 'Referred By', 'referred by');
    if (ref) { const k = norm(String(ref)); oppCountMap.set(k, (oppCountMap.get(k) || 0) + 1); }
  }

  const branchEl = document.getElementById('assign-filter-branch');
  const prevBranches = Array.from(branchEl.selectedOptions).map(o => o.value);
  const availBranches = [...new Set(allResults.map(r => r.assignedBranch).filter(b => b && b.trim() !== ''))].sort();
  branchEl.innerHTML = availBranches.map(b => '<option value="' + b + '"' + (prevBranches.includes(b) ? ' selected' : '') + '>' + b + '</option>').join('');
  const filterBranches = Array.from(branchEl.selectedOptions).map(o => o.value).filter(Boolean);

  const medEl = document.getElementById('assign-filter-med');
  const prevMeds = Array.from(medEl.selectedOptions).map(o => o.value);
  const activeMeds = [...new Set(state.activeResults.map(r => r.med))].sort();
  const medOpts = [...activeMeds, ...(state.inactiveResults.length ? ['Inactive'] : [])];
  medEl.innerHTML = medOpts.map(m => '<option value="' + m + '"' + (prevMeds.includes(m) ? ' selected' : '') + '>' + m + '</option>').join('');
  const filterMeds = Array.from(medEl.selectedOptions).map(o => o.value).filter(Boolean);

  let items = allResults.filter(r => {
    if (search && !r.name.toLowerCase().includes(search)) return false;
    const st = getAssignStatus(r.key);
    if (filterStatus === 'active' && r.med === 'Inactive') return false;
    if (filterStatus === 'inactive' && r.med !== 'Inactive') return false;
    if (['confirmed', 'pending', 'unassigned'].includes(filterStatus) && st !== filterStatus) return false;
    if (filterOwners.length && !filterOwners.includes(r.assignedOwner)) return false;
    if (filterBranches.length && !filterBranches.includes(r.assignedBranch)) return false;
    if (filterMeds.length && !filterMeds.includes(r.med)) return false;
    return true;
  });

  const total = allResults.length;
  const confirmed = allResults.filter(r => getAssignStatus(r.key) === 'confirmed').length;
  const pending = allResults.filter(r => getAssignStatus(r.key) === 'pending').length;
  const unassigned = allResults.filter(r => getAssignStatus(r.key) === 'unassigned').length;
  document.getElementById('pending-badge').textContent = pending + unassigned;
  document.getElementById('assign-stats').innerHTML = [
    ['ti-users', 'Total', total, ''],
    ['ti-circle-check', 'Confirmed', confirmed, 'chip-confirmed'],
    ['ti-clock', 'Pending', pending, 'chip-pending'],
    ['ti-alert-circle', 'No Owner', unassigned, 'chip-unassigned'],
  ].map(([ic, l, v]) => '<div class="astat"><i class="ti ' + ic + ' astat-icon"></i><div><div class="astat-val">' + v + '</div><div class="astat-lbl">' + l + '</div></div></div>').join('');

  const filtActive = state.activeResults.filter(r =>
    (!filterOwners.length || filterOwners.includes(r.assignedOwner)) &&
    (!filterBranches.length || filterBranches.includes(r.assignedBranch))
  );
  const filtInactive = state.inactiveResults.filter(r =>
    (!filterOwners.length || filterOwners.includes(r.assignedOwner)) &&
    (!filterBranches.length || filterBranches.includes(r.assignedBranch))
  );
  const _co = document.getElementById('cutoff-date').value;
  const _wd = parseInt(document.getElementById('window-days').value) || 60;
  const _cutoff = new Date(_co + 'T23:59:59Z');
  const _floor = new Date(_cutoff); _floor.setUTCDate(_floor.getUTCDate() - _wd); _floor.setUTCHours(0, 0, 0, 0);
  const _inact = new Date(document.getElementById('inactive-from').value + 'T00:00:00Z');
  renderSummary(_wd, filtActive, filtInactive, _cutoff, _floor, _inact);

  if (!items.length) {
    document.getElementById('assign-cards').innerHTML = '<div class="empty-state" style="grid-column:1/-1">No realtors to display</div>';
    return;
  }

  items.sort((a, b) => {
    const order = { unassigned: 0, pending: 1, confirmed: 2 };
    return order[getAssignStatus(a.key)] - order[getAssignStatus(b.key)];
  });

  document.getElementById('assign-cards').innerHTML = items.map(r => {
    const st = getAssignStatus(r.key);
    const m = state.masterMap.get(r.key) || { owner: '', branch: '' };
    const ownerOpts = owners.map(o => '<option value="' + o + '"' + (o === m.owner ? ' selected' : '') + '>' + o + '</option>').join('');
    const statusChip = st === 'confirmed'
      ? '<span class="status-chip chip-confirmed"><i class="ti ti-circle-check"></i> Confirmed</span>'
      : st === 'pending'
        ? '<span class="status-chip chip-pending"><i class="ti ti-clock"></i> Pending</span>'
        : '<span class="status-chip chip-unassigned"><i class="ti ti-alert-circle"></i> No Owner</span>';
    const confirmBtn = st === 'confirmed'
      ? '<button class="confirm-btn btn-confirmed" disabled><i class="ti ti-circle-check"></i> Confirmed</button><button class="confirm-btn btn-edit" onclick="unconfirm(\'' + r.key + '\')"><i class="ti ti-edit"></i> Edit</button>'
      : '<button class="confirm-btn btn-confirm" onclick="confirmAssign(\'' + r.key + '\')"><i class="ti ti-check"></i> Confirm</button>';
    const safeId = r.key.replace(/[^a-z0-9]/g, '_');
    return '<div class="acard ' + st + '" id="acard-' + safeId + '">' +
      '<div class="acard-top">' +
        '<div class="acard-avatar">' + initials(r.name) + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="acard-name"><span class="clickable-num" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted" onclick="showAllLeadsForRealtor(\'' + encodeURIComponent(r.key) + '\',\'' + (r.name || r.key).replace(/'/g, "\\'") + '\')" title="Ver todos los leads de este realtor">' + (r.name || r.key) + '</span></div>' +
          '<div class="acard-med"><span class="badge ' + (BADGE[r.med] || 'b-sin') + '" style="font-size:8px">' + r.med + '</span></div>' +
          '<div style="font-size:9px;color:#8899BB;margin-top:3px">&#128203; ' + (leadCountMap.get(r.key) || 0) + ' leads &middot; ' + (oppCountMap.get(r.key) || 0) + ' opps.</div>' +
        '</div>' +
        '<div class="acard-status">' + statusChip + '</div>' +
      '</div>' +
      '<div class="acard-fields">' +
        '<div class="afield"><label class="afield-label">Assigned Owner</label>' +
          '<select id="ao_' + safeId + '" onchange="updateAssign(\'' + r.key + '\',\'owner\',this.value)" ' + (st === 'confirmed' ? 'disabled' : '') + '>' + ownerOpts + '</select>' +
        '</div>' +
        '<div class="afield"><label class="afield-label">Branch</label>' +
          '<input type="text" id="ab_' + safeId + '" value="' + (m.branch || '') + '" placeholder="Branch" onchange="updateAssign(\'' + r.key + '\',\'branch\',this.value)" ' + (st === 'confirmed' ? 'disabled' : '') + '/>' +
        '</div>' +
      '</div>' +
      '<div class="acard-actions">' + confirmBtn + '</div>' +
    '</div>';
  }).join('');
}

export function updateAssign(key, field, value) {
  const m = state.masterMap.get(key) || { name: key, owner: '', branch: '', source: 'auto', updatedAt: fmtNow(), confirmed: false };
  if (field === 'owner') m.owner = value;
  if (field === 'branch') m.branch = value;
  m.source = 'manual'; m.updatedAt = fmtNow(); m.confirmed = false;
  state.masterMap.set(key, m);
  for (const r of [...state.activeResults, ...state.inactiveResults]) {
    if (r.key === key) { r.assignedOwner = m.owner; r.assignedBranch = m.branch; }
  }
}

export function confirmAssign(key) {
  const m = state.masterMap.get(key) || { name: key, owner: '', branch: '', source: 'manual', updatedAt: fmtNow(), confirmed: false };
  const safeKey = key.replace(/[^a-z0-9]/g, '_');
  const ownerEl = document.getElementById('ao_' + safeKey);
  const branchEl = document.getElementById('ab_' + safeKey);
  if (ownerEl) m.owner = ownerEl.value;
  if (branchEl) m.branch = branchEl.value;
  const old = state.masterMap.get(key) || {};
  if (old.owner !== m.owner || old.branch !== m.branch) {
    const entry = { date: fmtNow(), realtor: m.name || key, from: (old.owner || '–') + ' / ' + (old.branch || '–'), to: m.owner + ' / ' + m.branch };
    state.changeLog.unshift(entry);
    sbFetch('change_log', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ change_date: entry.date, realtor: entry.realtor, from_assignment: entry.from, to_assignment: entry.to }) }).catch(() => {});
  }
  m.confirmed = true; m.source = 'manual'; m.updatedAt = fmtNow();
  state.masterMap.set(key, m);
  sbFetch('master_assignments', {
    method: 'POST',
    prefer: 'return=minimal,resolution=merge-duplicates',
    headers: { 'Prefer': 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify([{ realtor_key: key, realtor_name: m.name || '', owner: m.owner || '', branch: m.branch || '', source: 'manual', updated_at: m.updatedAt, confirmed: true }])
  }).catch(() => {});
  for (const r of [...state.activeResults, ...state.inactiveResults]) {
    if (r.key === key) { r.assignedOwner = m.owner; r.assignedBranch = m.branch; r.confirmed = true; }
  }
  renderAssignCards();
  renderLog();
}

export function unconfirm(key) {
  const m = state.masterMap.get(key);
  if (m) { m.confirmed = false; state.masterMap.set(key, m); }
  for (const r of [...state.activeResults, ...state.inactiveResults]) { if (r.key === key) r.confirmed = false; }
  renderAssignCards();
}

export async function saveAllAssignments() {
  const st = document.getElementById('assign-save-status');
  st.textContent = 'Saving...';
  try {
    const rows = [...state.masterMap.entries()].map(([key, m]) => ({
      realtor_key: key, realtor_name: m.name || '', owner: m.owner || '', branch: m.branch || '',
      source: m.source || 'auto', updated_at: m.updatedAt || '', confirmed: m.confirmed || false
    }));
    await sbFetch('master_assignments', {
      method: 'POST',
      prefer: 'return=minimal,resolution=merge-duplicates',
      headers: { 'Prefer': 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify(rows)
    });
    st.textContent = '✅ Saved to Supabase ' + fmtNow();
  } catch (e) { st.textContent = '⚠ Save error: ' + e.message; }
}
