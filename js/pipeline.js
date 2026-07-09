import { state } from './state.js';
import { norm, parseDate, fmtDate, getField, initials } from './utils.js';
import { openModal } from './modal.js';
import { dl } from './export.js';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _cwCsvCache = new Map();
const _cwDetailCache = new Map();

function getInactiveCutoff() {
  const val = document.getElementById('pl-inactive-cutoff').value;
  if (val) return new Date(val + 'T00:00:00Z');
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 60);
  d.setUTCHours(0, 0, 0, 0);
  return d;
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
    if (!stage) return false;
    if (stage === 'closed won' || stage === 'closed lost') return false;
    const currStatus = String(getField(row, 'Current Status', 'current status', 'current_status') || '').trim().toLowerCase();
    if (currStatus.includes('archive loan')) return false;
    const lender = String(getField(row, 'Lender', 'lender') || '').trim().toLowerCase();
    if (lender.includes('city lending inc')) return false;
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

  document.getElementById('pl-pipeline-content').innerHTML = '<div class="pipeline-owners-grid">' + owners.map(owner => {
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

    const stageRank = { 'need analysis': 0, 'needs analysis': 0, 'qualification': 1, 'proposal': 2, 'negotiation': 3 };
    const stageRows = [...stageMap.entries()]
      .sort(([a], [b]) => {
        const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
        const ai = stageRank[norm(a)] ?? 999;
        const bi = stageRank[norm(b)] ?? 999;
        return ai - bi;
      })
      .map(([stage, rows]) => {
      const stageAmt = rows.reduce((s, r) => {
        const a = parseFloat(getField(r, 'Loan Amount', 'loan amount') || 0);
        return s + (isNaN(a) ? 0 : a);
      }, 0);
      const fmtAmt = stageAmt ? '$' + stageAmt.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '';
      return '<div class="pipeline-stage-row" data-pl-owner="' + owner.replace(/"/g, '&quot;') + '" data-pl-stage="' + stage.replace(/"/g, '&quot;') + '">' +
        '<div>' +
          '<div class="pipeline-stage-row-name">' + stage + '</div>' +
          (fmtAmt ? '<div class="pipeline-stage-row-sub">' + fmtAmt + '</div>' : '') +
        '</div>' +
        '<span class="pipeline-stage-row-chip">' + rows.length + '</span>' +
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
      '<div class="pipeline-stages-list">' + stageRows + '</div>' +
    '</div>';
  }).join('') + '</div>';
}

export function showPipelineStageDetail(owner, stage) {
  const inactiveCutoff = getInactiveCutoff();
  const today = new Date();

  const rows = (state.oppData || []).filter(row => {
    const rowOwner = String(getField(row, 'Opportunity Owner', 'opportunity owner') || '').trim();
    const rowStage = String(getField(row, 'Stage', 'stage') || '—').trim();
    if (rowOwner !== owner || rowStage !== stage) return false;
    const rowLender = String(getField(row, 'Lender', 'lender') || '').trim().toLowerCase();
    if (rowLender.includes('city lending inc')) return false;
    return true;
  });
  if (!rows.length) return;

  const realtorKeys = [...new Set(rows.map(row => {
    const ref = getField(row, 'Referred By', 'referred by');
    return ref ? norm(String(ref)) : null;
  }).filter(Boolean))];
  const cache = buildRealtorCache(realtorKeys, inactiveCutoff);

  const enriched = rows.map(row => {
    const ref = getField(row, 'Referred By', 'referred by');
    const realtorKey = ref ? norm(String(ref)) : null;
    const realtorName = ref ? String(ref).trim() : '—';
    const cached = realtorKey ? (cache.get(realtorKey) || { status: 'unknown', daysSince: null }) : { status: 'unknown', daysSince: null };

    const oppName = String(getField(row, 'Opportunity Name', 'opportunity name') || '—').trim();
    const lnNum = String(getField(row, 'Loan #', 'loan #') || '—').trim();
    const branch = String(getField(row, 'Branch', 'branch') || '').trim() || '—';
    const loanOfficer = String(getField(row, 'Loan Officer', 'loan officer') || '').trim() || '—';
    const currentMilestone = String(getField(row, 'Current Milestone', 'current milestone') || '').trim() || '—';
    const loanStatus = String(getField(row, 'Loan Status', 'loan status') || '').trim() || '—';
    const oppCd = parseDate(getField(row, 'Created Date', 'created date', 'create date'));
    const preApprovalDate = parseDate(getField(row, 'Pre-Approved Date', 'pre-approved date', 'Pre-Approval Date', 'pre-approval date'));
    const ratifiedDate = parseDate(getField(row, 'Ratified Date', 'ratified date'));
    const estClosingDate = parseDate(getField(row, 'Est. Closing Date', 'est. closing date', 'Estimated Closing Date', 'estimated closing date', 'Close Date', 'close date'));
    const amt = getField(row, 'Loan Amount', 'loan amount');
    const amtFmt = amt ? '$' + Number(amt).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';

    const daysOpen = oppCd ? Math.floor((today - oppCd) / 86400000) : null;
    return { row, realtorName, status: cached.status, daysSince: cached.daysSince, lnNum, oppName, branch, loanOfficer, currentMilestone, loanStatus, oppCd, daysOpen, preApprovalDate, ratifiedDate, estClosingDate, amt, amtFmt };
  });

  const order = { inactive: 0, active: 1, unknown: 2 };
  enriched.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2));

  const head = '<tr>' +
    '<th>Realtor</th><th>Status</th><th>Days Since Last Lead</th>' +
    '<th>Loan #</th><th>Opportunity Name</th><th>Branch</th><th>Loan Officer</th>' +
    '<th>Current Milestone</th><th>Loan Status</th>' +
    '<th>Created Date</th><th>Days Open</th><th>Pre-Approval Date</th><th>Ratified Date</th><th>Est. Closing Date</th>' +
    '<th>Loan Amount</th>' +
  '</tr>';

  const body = enriched.map(e => {
    const daysTxt = e.daysSince != null ? e.daysSince + 'd' : '—';
    const daysColor = e.daysSince == null ? '#8899BB' : e.daysSince > 90 ? '#A32D2D' : e.daysSince > 45 ? '#856400' : '#085041';
    return '<tr>' +
      '<td>' + e.realtorName + '</td>' +
      '<td>' + statusChipHtml(e.status) + '</td>' +
      '<td style="text-align:center;font-weight:700;color:' + daysColor + '">' + daysTxt + '</td>' +
      '<td style="font-family:monospace;font-size:10px;color:#556080">' + e.lnNum + '</td>' +
      '<td style="font-weight:600;max-width:150px;overflow:hidden;text-overflow:ellipsis" title="' + e.oppName + '">' + e.oppName + '</td>' +
      '<td style="font-size:11px">' + e.branch + '</td>' +
      '<td style="font-size:11px">' + e.loanOfficer + '</td>' +
      '<td style="font-size:11px">' + e.currentMilestone + '</td>' +
      '<td style="font-size:11px">' + e.loanStatus + '</td>' +
      '<td class="dt">' + fmtDate(e.oppCd) + '</td>' +
      '<td style="text-align:center;font-weight:700;color:' + (e.daysOpen == null ? '#8899BB' : e.daysOpen > 180 ? '#A32D2D' : e.daysOpen > 90 ? '#856400' : '#085041') + '">' + (e.daysOpen != null ? e.daysOpen + 'd' : '—') + '</td>' +
      '<td class="dt">' + (e.preApprovalDate ? fmtDate(e.preApprovalDate) : '—') + '</td>' +
      '<td class="dt">' + (e.ratifiedDate ? fmtDate(e.ratifiedDate) : '—') + '</td>' +
      '<td class="dt">' + (e.estClosingDate ? fmtDate(e.estClosingDate) : '—') + '</td>' +
      '<td class="modal-amount">' + e.amtFmt + '</td>' +
    '</tr>';
  }).join('');

  const totalAmt = enriched.reduce((s, e) => {
    const a = parseFloat(getField(e.row, 'Loan Amount', 'loan amount') || 0);
    return s + (isNaN(a) ? 0 : a);
  }, 0);
  const totalFmt = totalAmt ? '$' + totalAmt.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';

  const csvData = [
    ['Realtor', 'Status', 'Days Since Last Lead', 'Loan #', 'Opportunity Name', 'Branch', 'Loan Officer', 'Current Milestone', 'Loan Status', 'Created Date', 'Days Open', 'Pre-Approval Date', 'Ratified Date', 'Est. Closing Date', 'Loan Amount'],
    ...enriched.map(e => [
      e.realtorName, e.status, e.daysSince ?? '', e.lnNum, e.oppName,
      e.branch === '—' ? '' : e.branch, e.loanOfficer === '—' ? '' : e.loanOfficer,
      e.currentMilestone === '—' ? '' : e.currentMilestone,
      e.loanStatus === '—' ? '' : e.loanStatus,
      fmtDate(e.oppCd),
      e.daysOpen ?? '',
      e.preApprovalDate ? fmtDate(e.preApprovalDate) : '',
      e.ratifiedDate ? fmtDate(e.ratifiedDate) : '',
      e.estClosingDate ? fmtDate(e.estClosingDate) : '',
      e.amt || ''
    ])
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
    const currStatus = String(getField(row, 'Current Status', 'current status', 'current_status') || '').trim().toLowerCase();
    if (currStatus.includes('archive loan')) return false;
    const owner = String(getField(row, 'Opportunity Owner', 'opportunity owner') || '').trim();
    return allowedNorm.has(norm(owner));
  });

  const dates = allCW.map(r => parseDate(getField(r, 'Disbursement Date', 'disbursement date'))).filter(Boolean);
  const years = [...new Set(dates.map(d => d.getUTCFullYear()))].sort((a, b) => b - a);
  const months = [...new Set(dates.map(d => d.getUTCMonth() + 1))].sort((a, b) => a - b);

  const yearEl = document.getElementById('pl-cw-year');
  const monthEl = document.getElementById('pl-cw-month');
  const currentYear = String(new Date().getFullYear());
  const currentMonth = new Date().getMonth() + 1;
  const prevYears = Array.from(yearEl.selectedOptions).map(o => o.value);
  const prevMonths = Array.from(monthEl.selectedOptions).map(o => o.value);

  const effectiveYears = prevYears.length ? prevYears : (years.includes(parseInt(currentYear)) ? [currentYear] : []);
  const effectiveMonths = prevMonths.length ? prevMonths : (months.includes(currentMonth) ? [String(currentMonth)] : []);

  yearEl.innerHTML = years.map(y => '<option value="' + y + '"' + (effectiveYears.includes(String(y)) ? ' selected' : '') + '>' + y + '</option>').join('');
  monthEl.innerHTML = months.map(m => '<option value="' + m + '"' + (effectiveMonths.includes(String(m)) ? ' selected' : '') + '>' + MONTHS[m - 1] + '</option>').join('');

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

  // Per-owner summary cards (CAMBIO 3 + 4)
  _cwDetailCache.clear();
  let grandTotal = 0, grandCount = 0;

  const cardsHtml = '<div class="pipeline-owners-grid">' + [...byOwner.keys()].sort().map(owner => {
    const opps = byOwner.get(owner);
    _cwDetailCache.set(owner, opps);

    const ownerTotal = opps.reduce((s, r) => {
      const a = parseFloat(getField(r, 'Loan Amount', 'loan amount') || 0);
      return s + (isNaN(a) ? 0 : a);
    }, 0);
    grandTotal += ownerTotal;
    grandCount += opps.length;

    const branchCountMap = new Map();
    for (const r of opps) {
      const b = String(getField(r, 'Branch', 'branch') || '').trim() || 'No Branch';
      branchCountMap.set(b, (branchCountMap.get(b) || 0) + 1);
    }

    const ownerRealtorKeys = [...new Set(opps.map(r => {
      const ref = getField(r, 'Referred By', 'referred by');
      return ref ? norm(String(ref)) : null;
    }).filter(Boolean))];
    let activeC = 0, inactiveC = 0, unknownC = 0;
    for (const key of ownerRealtorKeys) {
      const st = (realtorCacheCW.get(key) || {}).status || 'unknown';
      if (st === 'active') activeC++;
      else if (st === 'inactive') inactiveC++;
      else unknownC++;
    }

    const branchRowsHtml = [...branchCountMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([branchName, count]) =>
        '<div class="pipeline-stage-row" data-cw-detail-owner="' + owner.replace(/"/g, '&quot;') + '">' +
          '<div><div class="pipeline-stage-row-name">' + branchName + '</div></div>' +
          '<span class="pipeline-stage-row-chip">' + count + '</span>' +
        '</div>'
      ).join('');

    const fmtOwnerTotal = ownerTotal ? '$' + ownerTotal.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';

    return '<div class="pl-owner-card pl-cw-card" style="cursor:pointer" data-cw-detail-owner="' + owner.replace(/"/g, '&quot;') + '">' +
      '<div class="pl-owner-header">' +
        '<div class="pl-owner-avatar">' + initials(owner) + '</div>' +
        '<div class="pl-owner-info">' +
          '<div class="pl-owner-name">' + owner + '</div>' +
          '<div class="pl-owner-meta">' + opps.length + ' closing' + (opps.length !== 1 ? 's' : '') + ' · ' + ownerRealtorKeys.length + ' realtor' + (ownerRealtorKeys.length !== 1 ? 's' : '') + '</div>' +
        '</div>' +
        '<div class="pl-owner-total">' + fmtOwnerTotal + '</div>' +
      '</div>' +
      '<div class="pl-realtor-summary">' +
        '<span class="pl-rs-item pl-chip-active"><i class="ti ti-check"></i> ' + activeC + ' active</span>' +
        '<span class="pl-rs-item pl-chip-inactive"><i class="ti ti-clock"></i> ' + inactiveC + ' inactive</span>' +
        (unknownC ? '<span class="pl-rs-item pl-chip-unknown"><i class="ti ti-help"></i> ' + unknownC + ' no data</span>' : '') +
      '</div>' +
      '<div class="pipeline-stages-list">' + branchRowsHtml + '</div>' +
    '</div>';
  }).join('') + '</div>';

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

export function showClosedWonDetail(owner) {
  const inactiveCutoff = getInactiveCutoff();
  const opps = _cwDetailCache.get(owner);
  if (!opps || !opps.length) return;

  const realtorKeys = [...new Set(opps.map(r => {
    const ref = getField(r, 'Referred By', 'referred by');
    return ref ? norm(String(ref)) : null;
  }).filter(Boolean))];
  const cache = buildRealtorCache(realtorKeys, inactiveCutoff);

  const enriched = opps.map(row => {
    const ref = getField(row, 'Referred By', 'referred by');
    const realtorKey = ref ? norm(String(ref)) : null;
    const realtorName = ref ? String(ref).trim() : '—';
    const cached = realtorKey ? (cache.get(realtorKey) || { status: 'unknown', daysSince: null }) : { status: 'unknown', daysSince: null };
    const lnNum = String(getField(row, 'Loan #', 'loan #') || '—').trim();
    const oppName = String(getField(row, 'Opportunity Name', 'opportunity name') || '—').trim();
    const branch = String(getField(row, 'Branch', 'branch') || '').trim() || '—';
    const disbDate = parseDate(getField(row, 'Disbursement Date', 'disbursement date'));
    const ratifiedDate = parseDate(getField(row, 'Ratified Date', 'ratified date'));
    const createdDate = parseDate(getField(row, 'Created Date', 'created date', 'create date'));
    const amt = getField(row, 'Loan Amount', 'loan amount');
    const amtFmt = amt ? '$' + Number(amt).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
    const daysToClose = disbDate && ratifiedDate
      ? Math.floor((disbDate - ratifiedDate) / 86400000)
      : (disbDate && createdDate ? Math.floor((disbDate - createdDate) / 86400000) : null);
    return { row, realtorName, status: cached.status, lnNum, oppName, branch, disbDate, ratifiedDate, createdDate, daysToClose, amt, amtFmt };
  });

  const totalAmt = enriched.reduce((s, e) => {
    const a = parseFloat(getField(e.row, 'Loan Amount', 'loan amount') || 0);
    return s + (isNaN(a) ? 0 : a);
  }, 0);
  const totalFmt = totalAmt ? '$' + totalAmt.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';

  const head = '<tr>' +
    '<th>Loan #</th><th>Opportunity Name</th><th>Realtor</th><th>Realtor Status</th>' +
    '<th>Branch</th><th>Disbursement Date</th><th>Ratified Date</th><th>Opp. Created</th><th>Days to Close</th><th>Loan Amount</th>' +
  '</tr>';

  const body = enriched.map(e => {
    const dtcClass = e.daysToClose == null ? '' : e.daysToClose < 90 ? 'days-to-close-fast' : e.daysToClose <= 180 ? 'days-to-close-medium' : 'days-to-close-slow';
    const dtcTxt = e.daysToClose != null ? e.daysToClose + 'd' : '—';
    return '<tr>' +
      '<td style="font-family:monospace;font-size:10px;color:#556080">' + e.lnNum + '</td>' +
      '<td style="font-weight:600;max-width:150px;overflow:hidden;text-overflow:ellipsis" title="' + e.oppName + '">' + e.oppName + '</td>' +
      '<td>' + e.realtorName + '</td>' +
      '<td>' + statusChipHtml(e.status) + '</td>' +
      '<td style="font-size:11px">' + e.branch + '</td>' +
      '<td class="dt">' + fmtDate(e.disbDate) + '</td>' +
      '<td class="dt">' + (e.ratifiedDate ? fmtDate(e.ratifiedDate) : '—') + '</td>' +
      '<td class="dt">' + fmtDate(e.createdDate) + '</td>' +
      '<td style="text-align:center"><span class="' + dtcClass + '">' + dtcTxt + '</span></td>' +
      '<td class="modal-amount">' + e.amtFmt + '</td>' +
    '</tr>';
  }).join('');

  const csvData = [
    ['Loan #', 'Opportunity Name', 'Realtor', 'Realtor Status', 'Branch', 'Disbursement Date', 'Ratified Date', 'Opp. Created', 'Days to Close', 'Loan Amount'],
    ...enriched.map(e => [
      e.lnNum, e.oppName, e.realtorName, e.status, e.branch === '—' ? '' : e.branch,
      fmtDate(e.disbDate), e.ratifiedDate ? fmtDate(e.ratifiedDate) : '', fmtDate(e.createdDate), e.daysToClose ?? '', e.amt || ''
    ])
  ];

  openModal(
    owner + ' — Closed Won',
    enriched.length + ' closing' + (enriched.length !== 1 ? 's' : '') + ' · Total: ' + totalFmt,
    head, body, csvData
  );
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-cw-detail-owner]');
  if (!el) return;
  showClosedWonDetail(el.getAttribute('data-cw-detail-owner'));
});
