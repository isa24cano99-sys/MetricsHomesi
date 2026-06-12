import { state } from './state.js';
import { norm, parseDate, fmtDate, getField, initials } from './utils.js';
import { openModal } from './modal.js';
import { dl } from './export.js';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _cwCsvCache = new Map();

function getInactiveCutoff() {
  const val = document.getElementById('pl-inactive-cutoff').value;
  if (val) return new Date(val + 'T00:00:00Z');
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 60);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function getRealtorStatus(realtorKey, inactiveCutoff) {
  let latestDate = null;
  for (const row of (state.leadsData || [])) {
    const ref = getField(row, 'Referred By', 'referred by');
    if (!ref || norm(String(ref)) !== realtorKey) continue;
    const cd = parseDate(getField(row, 'Created Date', 'Create Date', 'created date', 'create date'));
    if (cd && (!latestDate || cd > latestDate)) latestDate = cd;
  }
  if (!latestDate) return 'unknown';
  return latestDate >= inactiveCutoff ? 'active' : 'inactive';
}

function getAllowedOwners() {
  return document.getElementById('owners-list').value
    .split(',')
    .map(s => s.trim().replace(/^["']+|["']+$/g, '').trim())
    .filter(s => s !== '');
}

function statusChipHtml(status) {
  if (status === 'active') return '<span class="pl-status-chip pl-chip-active">Active</span>';
  if (status === 'inactive') return '<span class="pl-status-chip pl-chip-inactive">Inactive</span>';
  return '<span class="pl-status-chip pl-chip-unknown">No Data</span>';
}

function buildRealtorCache(realtorKeys, inactiveCutoff) {
  const keySet = new Set(realtorKeys);
  const latestDates = new Map();
  for (const row of (state.leadsData || [])) {
    const ref = getField(row, 'Referred By', 'referred by');
    if (!ref) continue;
    const key = norm(String(ref));
    if (!keySet.has(key)) continue;
    const cd = parseDate(getField(row, 'Created Date', 'Create Date', 'created date', 'create date'));
    if (cd) {
      const cur = latestDates.get(key);
      if (!cur || cd > cur) latestDates.set(key, cd);
    }
  }
  const cache = new Map();
  const now = new Date();
  for (const key of keySet) {
    const d = latestDates.get(key);
    if (!d) { cache.set(key, { status: 'unknown', daysSince: null }); continue; }
    const daysSince = Math.floor((now - d) / 86400000);
    cache.set(key, { status: d >= inactiveCutoff ? 'active' : 'inactive', daysSince });
  }
  return cache;
}

export function initPipeline() {
  const defaultCutoff = new Date();
  defaultCutoff.setUTCDate(defaultCutoff.getUTCDate() - 60);
  const cutoffEl = document.getElementById('pl-inactive-cutoff');
  if (!cutoffEl.value) cutoffEl.value = defaultCutoff.toISOString().split('T')[0];

  const owners = getAllowedOwners();
  const allowedNorm = new Set(owners.map(o => norm(o)));

  const ownerEl = document.getElementById('pl-filter-owner');
  const prev = Array.from(ownerEl.selectedOptions).map(o => o.value);
  ownerEl.innerHTML = owners.map(o => '<option value="' + o + '"' + (prev.includes(o) ? ' selected' : '') + '>' + o + '</option>').join('');

  const cwOpps = (state.oppData || []).filter(row =>
    String(getField(row, 'Stage', 'stage') || '').trim().toLowerCase() === 'closed won' &&
    allowedNorm.has(norm(String(getField(row, 'Opportunity Owner', 'opportunity owner') || '').trim()))
  );
  const branches = [...new Set(cwOpps.map(r => {
    const b = String(getField(r, 'Branch', 'branch') || '').trim();
    return b || null;
  }).filter(Boolean))].sort();
  const branchEl = document.getElementById('pl-filter-cw-branch');
  const prevBranches = Array.from(branchEl.selectedOptions).map(o => o.value);
  branchEl.innerHTML = branches.map(b => '<option value="' + b + '"' + (prevBranches.includes(b) ? ' selected' : '') + '>' + b + '</option>').join('');

  renderPipeline();
  renderClosedWon();
}

export function renderPipeline() {
  const inactiveCutoff = getInactiveCutoff();
  const filterOwners = Array.from(document.getElementById('pl-filter-owner').selectedOptions).map(o => o.value).filter(Boolean);
  const allowedNorm = new Set(getAllowedOwners().map(o => norm(o)));

  const openOpps = (state.oppData || []).filter(row => {
    const stage = String(getField(row, 'Stage', 'stage') || '').trim().toLowerCase();
    if (stage === 'closed won' || stage === 'closed lost') return false;
    const owner = String(getField(row, 'Opportunity Owner', 'opportunity owner') || '').trim();
    return allowedNorm.has(norm(owner));
  });

  const byOwner = new Map();
  for (const row of openOpps) {
    const owner = String(getField(row, 'Opportunity Owner', 'opportunity owner') || '').trim();
    if (!owner) continue;
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(row);
  }

  const owners = (filterOwners.length
    ? [...byOwner.keys()].filter(o => filterOwners.includes(o))
    : [...byOwner.keys()]
  ).sort();

  if (!owners.length) {
    document.getElementById('pl-pipeline-content').innerHTML = '<div class="empty-state">No open opportunities found</div>';
    return;
  }

  const allRealtorKeys = [...new Set(openOpps.map(r => {
    const ref = getField(r, 'Referred By', 'referred by');
    return ref ? norm(String(ref)) : null;
  }).filter(Boolean))];
  const realtorCache = buildRealtorCache(allRealtorKeys, inactiveCutoff);

  document.getElementById('pl-pipeline-content').innerHTML = owners.map(owner => {
    const opps = byOwner.get(owner) || [];

    const stageMap = new Map();
    for (const row of opps) {
      const stage = String(getField(row, 'Stage', 'stage') || '—').trim();
      if (!stageMap.has(stage)) stageMap.set(stage, []);
      stageMap.get(stage).push(row);
    }

    const totalAmt = opps.reduce((s, r) => {
      const a = parseFloat(getField(r, 'Loan Amount', 'loan amount') || 0);
      return s + (isNaN(a) ? 0 : a);
    }, 0);

    const realtorKeys = [...new Set(opps.map(r => {
      const ref = getField(r, 'Referred By', 'referred by');
      return ref ? norm(String(ref)) : null;
    }).filter(Boolean))];

    let activeCount = 0, inactiveCount = 0, unknownCount = 0;
    for (const key of realtorKeys) {
      const st = (realtorCache.get(key) || {}).status || 'unknown';
      if (st === 'active') activeCount++;
      else if (st === 'inactive') inactiveCount++;
      else unknownCount++;
    }

    const stageChips = [...stageMap.entries()].map(([stage, rows]) => {
      const stageAmt = rows.reduce((s, r) => {
        const a = parseFloat(getField(r, 'Loan Amount', 'loan amount') || 0);
        return s + (isNaN(a) ? 0 : a);
      }, 0);
      const fmtAmt = stageAmt ? '$' + stageAmt.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '';
      return '<div class="pl-stage-chip" data-pl-owner="' + owner.replace(/"/g, '&quot;') + '" data-pl-stage="' + stage.replace(/"/g, '&quot;') + '">' +
        '<span class="pl-stage-name">' + stage + '</span>' +
        '<span class="pl-stage-count">' + rows.length + '</span>' +
        (fmtAmt ? '<span class="pl-stage-amt">' + fmtAmt + '</span>' : '') +
      '</div>';
    }).join('');

    const fmtTotal = totalAmt ? '$' + totalAmt.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';

    return '<div class="pl-owner-card">' +
      '<div class="pl-owner-header">' +
        '<div class="pl-owner-avatar">' + initials(owner) + '</div>' +
        '<div class="pl-owner-info">' +
          '<div class="pl-owner-name">' + owner + '</div>' +
          '<div class="pl-owner-meta">' + opps.length + ' open opp' + (opps.length !== 1 ? 's' : '') + ' · ' + realtorKeys.length + ' realtor' + (realtorKeys.length !== 1 ? 's' : '') + '</div>' +
        '</div>' +
        '<div class="pl-owner-total">' + fmtTotal + '</div>' +
      '</div>' +
      '<div class="pl-realtor-summary">' +
        '<span class="pl-rs-item pl-chip-active"><i class="ti ti-check"></i> ' + activeCount + ' active</span>' +
        '<span class="pl-rs-item pl-chip-inactive"><i class="ti ti-clock"></i> ' + inactiveCount + ' inactive</span>' +
        (unknownCount ? '<span class="pl-rs-item pl-chip-unknown"><i class="ti ti-help"></i> ' + unknownCount + ' no data</span>' : '') +
      '</div>' +
      '<div class="pl-stages-wrap">' + stageChips + '</div>' +
    '</div>';
  }).join('');
}

export function showPipelineStageDetail(owner, stage) {
  const inactiveCutoff = getInactiveCutoff();

  const rows = (state.oppData || []).filter(row => {
    const rowOwner = String(getField(row, 'Opportunity Owner', 'opportunity owner') || '').trim();
    const rowStage = String(getField(row, 'Stage', 'stage') || '—').trim();
    return rowOwner === owner && rowStage === stage;
  });
  if (!rows.length) return;

  const enriched = rows.map(row => {
    const ref = getField(row, 'Referred By', 'referred by');
    const realtorKey = ref ? norm(String(ref)) : null;
    const realtorName = ref ? String(ref).trim() : '—';
    const status = realtorKey ? getRealtorStatus(realtorKey, inactiveCutoff) : 'unknown';

    let daysSince = null;
    if (realtorKey) {
      let latestDate = null;
      for (const lr of (state.leadsData || [])) {
        const lref = getField(lr, 'Referred By', 'referred by');
        if (!lref || norm(String(lref)) !== realtorKey) continue;
        const cd = parseDate(getField(lr, 'Created Date', 'Create Date', 'created date', 'create date'));
        if (cd && (!latestDate || cd > latestDate)) latestDate = cd;
      }
      if (latestDate) daysSince = Math.floor((new Date() - latestDate) / 86400000);
    }

    const oppName = String(getField(row, 'Opportunity Name', 'opportunity name') || '—').trim();
    const lnNum = String(getField(row, 'Loan #', 'loan #') || '—').trim();
    const oppCd = parseDate(getField(row, 'Created Date', 'created date', 'create date'));
    const amt = getField(row, 'Loan Amount', 'loan amount');
    const amtFmt = amt ? '$' + Number(amt).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';

    return { row, oppName, lnNum, realtorName, status, daysSince, oppCd, amt, amtFmt };
  });

  const order = { inactive: 0, active: 1, unknown: 2 };
  enriched.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2));

  const head = '<tr><th>#</th><th>Loan #</th><th>Opportunity Name</th><th>Realtor</th><th>Status</th><th>Days Since Last Lead</th><th>Opp. Created</th><th>Loan Amount</th></tr>';

  const body = enriched.map((e, i) => {
    const daysTxt = e.daysSince != null ? e.daysSince + 'd' : '—';
    const daysColor = e.daysSince == null ? '#8899BB' : e.daysSince > 90 ? '#A32D2D' : e.daysSince > 45 ? '#856400' : '#085041';
    return '<tr>' +
      '<td style="color:#8899BB;font-size:10px">' + (i + 1) + '</td>' +
      '<td style="font-family:monospace;font-size:10px;color:#556080">' + e.lnNum + '</td>' +
      '<td style="font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis" title="' + e.oppName + '">' + e.oppName + '</td>' +
      '<td>' + e.realtorName + '</td>' +
      '<td>' + statusChipHtml(e.status) + '</td>' +
      '<td style="text-align:center;font-weight:700;color:' + daysColor + '">' + daysTxt + '</td>' +
      '<td class="dt">' + fmtDate(e.oppCd) + '</td>' +
      '<td class="modal-amount">' + e.amtFmt + '</td>' +
    '</tr>';
  }).join('');

  const totalAmt = enriched.reduce((s, e) => {
    const a = parseFloat(getField(e.row, 'Loan Amount', 'loan amount') || 0);
    return s + (isNaN(a) ? 0 : a);
  }, 0);
  const totalFmt = totalAmt ? '$' + totalAmt.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';

  const csvData = [
    ['#', 'Loan #', 'Opportunity Name', 'Realtor', 'Status', 'Days Since Last Lead', 'Opp. Created', 'Loan Amount'],
    ...enriched.map((e, i) => [i + 1, e.lnNum, e.oppName, e.realtorName, e.status, e.daysSince ?? '', fmtDate(e.oppCd), e.amt || ''])
  ];

  openModal(
    owner + ' — ' + stage,
    enriched.length + ' opportunit' + (enriched.length !== 1 ? 'ies' : 'y') + ' · Total: ' + totalFmt,
    head, body, csvData
  );
}

export function renderClosedWon() {
  const allowedNorm = new Set(getAllowedOwners().map(o => norm(o)));
  const inactiveCutoff = getInactiveCutoff();

  const allCW = (state.oppData || []).filter(row => {
    if (String(getField(row, 'Stage', 'stage') || '').trim().toLowerCase() !== 'closed won') return false;
    const owner = String(getField(row, 'Opportunity Owner', 'opportunity owner') || '').trim();
    return allowedNorm.has(norm(owner));
  });

  const dates = allCW.map(r => parseDate(getField(r, 'Disbursement Date', 'disbursement date'))).filter(Boolean);
  const years = [...new Set(dates.map(d => d.getUTCFullYear()))].sort((a, b) => b - a);
  const months = [...new Set(dates.map(d => d.getUTCMonth() + 1))].sort((a, b) => a - b);

  const yearEl = document.getElementById('pl-cw-year');
  const monthEl = document.getElementById('pl-cw-month');
  const prevYears = Array.from(yearEl.selectedOptions).map(o => o.value);
  const prevMonths = Array.from(monthEl.selectedOptions).map(o => o.value);

  yearEl.innerHTML = years.map(y => '<option value="' + y + '"' + (prevYears.includes(String(y)) ? ' selected' : '') + '>' + y + '</option>').join('');
  monthEl.innerHTML = months.map(m => '<option value="' + m + '"' + (prevMonths.includes(String(m)) ? ' selected' : '') + '>' + MONTHS[m - 1] + '</option>').join('');

  const selYears = Array.from(yearEl.selectedOptions).map(o => parseInt(o.value));
  const selMonths = Array.from(monthEl.selectedOptions).map(o => parseInt(o.value));
  const selBranches = Array.from(document.getElementById('pl-filter-cw-branch').selectedOptions).map(o => o.value);

  const filtered = allCW.filter(row => {
    const d = parseDate(getField(row, 'Disbursement Date', 'disbursement date'));
    if (!d) return false;
    if (selYears.length && !selYears.includes(d.getUTCFullYear())) return false;
    if (selMonths.length && !selMonths.includes(d.getUTCMonth() + 1)) return false;
    if (selBranches.length) {
      const b = String(getField(row, 'Branch', 'branch') || '').trim();
      if (!selBranches.includes(b)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    document.getElementById('pl-cw-content').innerHTML = '<div class="empty-state">No Closed Won records match the selected filters</div>';
    return;
  }

  const allRealtorKeysCW = [...new Set(filtered.map(r => {
    const ref = getField(r, 'Referred By', 'referred by');
    return ref ? norm(String(ref)) : null;
  }).filter(Boolean))];
  const realtorCacheCW = buildRealtorCache(allRealtorKeysCW, inactiveCutoff);

  const byOwner = new Map();
  for (const row of filtered) {
    const owner = String(getField(row, 'Opportunity Owner', 'opportunity owner') || '').trim();
    if (!owner) continue;
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(row);
  }

  // CAMBIO 1 — global summary
  const totalCount = filtered.length;
  const totalAmt = filtered.reduce((s, r) => {
    const a = parseFloat(getField(r, 'Loan Amount', 'loan amount') || 0);
    return s + (isNaN(a) ? 0 : a);
  }, 0);
  const closeTimes = filtered.map(r => {
    const disb = parseDate(getField(r, 'Disbursement Date', 'disbursement date'));
    const created = parseDate(getField(r, 'Created Date', 'created date', 'create date'));
    return disb && created ? Math.floor((disb - created) / 86400000) : null;
  }).filter(v => v != null);
  const avgDays = closeTimes.length ? Math.round(closeTimes.reduce((s, v) => s + v, 0) / closeTimes.length) : null;

  const branchMap = new Map();
  for (const r of filtered) {
    const b = String(getField(r, 'Branch', 'branch') || '').trim() || 'No Branch';
    const a = parseFloat(getField(r, 'Loan Amount', 'loan amount') || 0);
    const entry = branchMap.get(b) || { count: 0, amt: 0 };
    entry.count++;
    entry.amt += isNaN(a) ? 0 : a;
    branchMap.set(b, entry);
  }
  const branchRows = [...branchMap.entries()]
    .sort((a, b) => b[1].amt - a[1].amt)
    .map(([name, { count, amt }]) =>
      '<tr><td>' + name + '</td>' +
      '<td style="text-align:center">' + count + '</td>' +
      '<td class="modal-amount">$' + amt.toLocaleString('en-US', { maximumFractionDigits: 0 }) + '</td></tr>'
    ).join('');

  const summaryHtml =
    '<div class="pl-cw-summary">' +
      '<div class="pl-cw-summary-stats">' +
        '<span class="pl-cw-summary-total">Total Closed Won: <strong>' + totalCount + ' closing' + (totalCount !== 1 ? 's' : '') + ' · $' + totalAmt.toLocaleString('en-US', { maximumFractionDigits: 0 }) + '</strong></span>' +
        (avgDays != null ? '<span class="pl-cw-summary-avg">Avg. days to close: <strong>' + avgDays + 'd</strong></span>' : '') +
      '</div>' +
      (branchRows ? '<table class="pl-branch-table"><thead><tr><th>Branch</th><th>Closings</th><th>Loan Amount</th></tr></thead><tbody>' + branchRows + '</tbody></table>' : '') +
    '</div>';

  // Per-owner cards
  _cwCsvCache.clear();
  let grandTotal = 0, grandCount = 0;

  const cardsHtml = [...byOwner.keys()].sort().map(owner => {
    const opps = byOwner.get(owner);
    const ownerTotal = opps.reduce((s, r) => {
      const a = parseFloat(getField(r, 'Loan Amount', 'loan amount') || 0);
      return s + (isNaN(a) ? 0 : a);
    }, 0);
    grandTotal += ownerTotal; grandCount += opps.length;

    const csvRows = [['#', 'Loan #', 'Opportunity Name', 'Realtor', 'Status', 'Branch', 'Days Since Last Lead', 'Disbursement Date', 'Opp. Created', 'Days to Close', 'Loan Amount']];

    const rows = opps.map((row, i) => {
      const lnNum = String(getField(row, 'Loan #', 'loan #') || '—').trim();
      const oppName = String(getField(row, 'Opportunity Name', 'opportunity name') || '—').trim();
      const ref = getField(row, 'Referred By', 'referred by');
      const realtorName = ref ? String(ref).trim() : '—';
      const realtorKey = ref ? norm(String(ref)) : null;
      const cached = realtorKey ? (realtorCacheCW.get(realtorKey) || { status: 'unknown', daysSince: null }) : { status: 'unknown', daysSince: null };
      const status = cached.status;
      const daysSince = cached.daysSince;
      const branch = String(getField(row, 'Branch', 'branch') || '').trim() || '—';
      const disbDate = parseDate(getField(row, 'Disbursement Date', 'disbursement date'));
      const createdDate = parseDate(getField(row, 'Created Date', 'created date', 'create date'));
      const amt = getField(row, 'Loan Amount', 'loan amount');
      const amtFmt = amt ? '$' + Number(amt).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';

      const daysToClose = disbDate && createdDate ? Math.floor((disbDate - createdDate) / 86400000) : null;
      const dtcClass = daysToClose == null ? '' : daysToClose < 90 ? 'days-to-close-fast' : daysToClose <= 180 ? 'days-to-close-medium' : 'days-to-close-slow';
      const dtcTxt = daysToClose != null ? daysToClose + 'd' : '—';

      const daysSinceTxt = daysSince != null ? daysSince + 'd' : '—';
      const daysSinceColor = status === 'active' ? '#085041' : status === 'inactive' ? '#A05000' : '#8899BB';

      csvRows.push([i + 1, lnNum, oppName, realtorName, status, branch === '—' ? '' : branch, daysSince ?? '', fmtDate(disbDate), fmtDate(createdDate), daysToClose ?? '', amt || '']);

      return '<tr>' +
        '<td style="color:#8899BB;font-size:10px">' + (i + 1) + '</td>' +
        '<td style="font-family:monospace;font-size:10px;color:#556080">' + lnNum + '</td>' +
        '<td style="font-weight:600;max-width:150px;overflow:hidden;text-overflow:ellipsis" title="' + oppName + '">' + oppName + '</td>' +
        '<td>' + realtorName + '</td>' +
        '<td>' + statusChipHtml(status) + '</td>' +
        '<td style="font-size:11px">' + branch + '</td>' +
        '<td style="text-align:center;font-weight:700;color:' + daysSinceColor + '">' + daysSinceTxt + '</td>' +
        '<td class="dt">' + fmtDate(disbDate) + '</td>' +
        '<td class="dt">' + fmtDate(createdDate) + '</td>' +
        '<td style="text-align:center"><span class="' + dtcClass + '">' + dtcTxt + '</span></td>' +
        '<td class="modal-amount">' + amtFmt + '</td>' +
      '</tr>';
    }).join('');

    _cwCsvCache.set(owner, csvRows);
    const fmtOwnerTotal = ownerTotal ? '$' + ownerTotal.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';

    return '<div class="pl-owner-card pl-cw-card">' +
      '<div class="pl-owner-header">' +
        '<div class="pl-owner-avatar">' + initials(owner) + '</div>' +
        '<div class="pl-owner-info">' +
          '<div class="pl-owner-name">' + owner + '</div>' +
          '<div class="pl-owner-meta">' + opps.length + ' closed deal' + (opps.length !== 1 ? 's' : '') + '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<div class="pl-owner-total">' + fmtOwnerTotal + '</div>' +
          '<button class="btn-sm" data-cw-owner="' + owner.replace(/"/g, '&quot;') + '"><i class="ti ti-download"></i> CSV</button>' +
        '</div>' +
      '</div>' +
      '<div class="pl-cw-table-wrap">' +
        '<table class="modal-table"><thead><tr>' +
          '<th>#</th><th>Loan #</th><th>Opportunity Name</th><th>Realtor</th><th>Status</th>' +
          '<th>Branch</th><th>Days Since Last Lead</th>' +
          '<th>Disbursement Date</th><th>Opp. Created</th><th>Days to Close</th><th>Loan Amount</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div>' +
    '</div>';
  }).join('');

  const grandFmt = grandTotal ? '$' + grandTotal.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';

  document.getElementById('pl-cw-content').innerHTML = summaryHtml + cardsHtml +
    '<div class="pl-grand-total">' +
      '<span>' + grandCount + ' total deal' + (grandCount !== 1 ? 's' : '') + '</span>' +
      '<span class="pl-grand-amt">' + grandFmt + '</span>' +
    '</div>';
}

export function clearPipelineFilters() {
  Array.from(document.getElementById('pl-filter-owner').options).forEach(o => o.selected = false);
  Array.from(document.getElementById('pl-cw-month').options).forEach(o => o.selected = false);
  Array.from(document.getElementById('pl-cw-year').options).forEach(o => o.selected = false);
  Array.from(document.getElementById('pl-filter-cw-branch').options).forEach(o => o.selected = false);
  renderPipeline();
  renderClosedWon();
}

export function downloadCwOwnerCsv(owner) {
  const rows = _cwCsvCache.get(owner);
  if (!rows) return;
  const csv = rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  dl(new Blob([csv], { type: 'text/csv' }), (owner || 'cw') + '_closed_won.csv');
}
