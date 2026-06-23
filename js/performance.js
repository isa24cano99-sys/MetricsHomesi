import { state } from './state.js';
import { norm, parseDate, fmtDate, getField } from './utils.js';
import { sbFetch } from './supabase.js';
import { openModal } from './modal.js';

export const kpiGoals = { loanAmount: 700000, pipelineOpps: 10 };

export async function loadKpiSettings() {
  try {
    const rows = await sbFetch('kpi_settings?select=key,value');
    for (const r of (rows || [])) {
      if (r.key === 'loan_amount_goal') kpiGoals.loanAmount = Number(r.value) || 700000;
      if (r.key === 'pipeline_opps_goal') kpiGoals.pipelineOpps = Number(r.value) || 10;
    }
  } catch (_) { /* table may not exist yet — use defaults */ }
  const lEl = document.getElementById('kpi-loan-goal');
  const oEl = document.getElementById('kpi-opps-goal');
  if (lEl) lEl.value = kpiGoals.loanAmount;
  if (oEl) oEl.value = kpiGoals.pipelineOpps;
}

export async function saveKpiSettings() {
  const lEl = document.getElementById('kpi-loan-goal');
  const oEl = document.getElementById('kpi-opps-goal');
  if (lEl) kpiGoals.loanAmount = Math.max(0, Number(lEl.value) || 700000);
  if (oEl) kpiGoals.pipelineOpps = Math.max(0, Number(oEl.value) || 10);
  try {
    await sbFetch('kpi_settings', {
      method: 'POST',
      prefer: 'return=minimal,resolution=merge-duplicates',
      headers: { 'Prefer': 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify([
        { key: 'loan_amount_goal', value: kpiGoals.loanAmount },
        { key: 'pipeline_opps_goal', value: kpiGoals.pipelineOpps }
      ])
    });
  } catch (_) { /* silent */ }
  renderPerformance();
}

function getAllowedOwners() {
  return document.getElementById('owners-list').value
    .split(',').map(s => s.trim().replace(/^["']+|["']+$/g, '').trim()).filter(s => s !== '');
}

const MS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MS_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtMoney(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v < 0 ? '-' : '') + '$' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v < 0 ? '-' : '') + '$' + Math.round(a / 1e3) + 'K';
  return (v < 0 ? '-' : '') + '$' + Math.round(a);
}

function fmtMoneyFull(v) {
  return (v < 0 ? '-' : '') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US');
}

function weekOfMonth(date) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1));
  const dow = first.getUTCDay();
  const daysBack = dow === 0 ? 6 : dow - 1;
  const week1Mon = new Date(Date.UTC(y, m, 1 - daysBack));
  return Math.floor((date - week1Mon) / 604800000) + 1;
}

function endOfWeekN(year, month0, n) {
  const first = new Date(Date.UTC(year, month0, 1));
  const dow = first.getUTCDay();
  const daysBack = dow === 0 ? 6 : dow - 1;
  const week1Mon = new Date(Date.UTC(year, month0, 1 - daysBack));
  const result = new Date(week1Mon);
  result.setUTCDate(result.getUTCDate() + n * 7 - 1);
  result.setUTCHours(23, 59, 59, 999);
  return result;
}

function getPeriodBounds(year, months0, today, isCompare) {
  const sorted = [...months0].sort((a, b) => a - b);
  const start = new Date(Date.UTC(year, sorted[0], 1));
  let end;
  if (isCompare) {
    const wn = weekOfMonth(today);
    const lastM = sorted[sorted.length - 1];
    const rawEnd = endOfWeekN(year, lastM, wn);
    const monthCap = new Date(Date.UTC(year, lastM + 1, 0, 23, 59, 59, 999));
    end = rawEnd < monthCap ? rawEnd : monthCap;
  } else {
    end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999));
  }
  return { start, end };
}

function calcLoanAmount(owner, start, end) {
  let total = 0;
  for (const row of (state.oppData || [])) {
    const stage = String(getField(row, 'Stage', 'stage') || '').trim().toLowerCase();
    if (stage !== 'closed won') continue;
    const oppOwner = String(getField(row, 'Opportunity Owner', 'opportunity owner') || '').trim();
    if (norm(oppOwner) !== norm(owner)) continue;
    const disbDate = parseDate(getField(row, 'Disbursement Date', 'disbursement date'));
    if (!disbDate || disbDate < start || disbDate > end) continue;
    const lender = String(getField(row, 'Lender', 'lender') || '').trim().toLowerCase();
    if (lender.includes('city lending inc')) continue;
    const raw = String(getField(row, 'Loan Amount', 'loan amount', 'Amount', 'amount') || '').replace(/[$,]/g, '');
    total += parseFloat(raw) || 0;
  }
  return total;
}

function calcPipelineActivity(owner, start, end) {
  let created = 0, stillActive = 0;
  for (const row of (state.oppData || [])) {
    const oppOwner = String(getField(row, 'Opportunity Owner', 'opportunity owner') || '').trim();
    if (norm(oppOwner) !== norm(owner)) continue;
    const cd = parseDate(getField(row, 'Created Date', 'created date', 'Create Date', 'create date'));
    if (!cd || cd < start || cd > end) continue;
    created++;
    const stage = String(getField(row, 'Stage', 'stage') || '').trim().toLowerCase();
    if (stage !== 'closed lost') stillActive++;
  }
  return { created, stillActive };
}

// Main period H/F: reads state.activeResults directly (guaranteed correct match with Metrics)
function getMainHFDetail(owner) {
  const huntingRealtors = [], farmingRealtors = [];
  for (const r of (state.activeResults || [])) {
    if (r.assignedOwner !== owner) continue;
    const detail = { name: r.name, branch: r.assignedBranch || '—', firstDate: r.firstDate, cnt: r.cnt, med: r.med };
    if (r.med && r.med.startsWith('Hunting')) huntingRealtors.push(detail);
    else farmingRealtors.push(detail);
  }
  return {
    hunting: huntingRealtors.length, farming: farmingRealtors.length,
    total: huntingRealtors.length + farmingRealtors.length,
    huntingRealtors, farmingRealtors
  };
}

// Historical H/F window: replicates calc.js assignment logic for a specific owner and window
function calcHuntingFarmingForWindow(owner, floorDate, cutoffDate) {
  const reactDays = parseInt((document.getElementById('react-days') || {}).value) || 150;

  const oppOwnerMap = new Map();
  for (const row of (state.oppData || [])) {
    const ref = getField(row, 'Referred By', 'referred by');
    if (!ref || !String(ref).trim()) continue;
    const oppOwner = getField(row, 'Opportunity Owner', 'opportunity owner');
    if (oppOwner) oppOwnerMap.set(norm(String(ref).trim()), String(oppOwner).trim());
  }

  const allowedOwners = getAllowedOwners();
  const allowedNorm = new Map(allowedOwners.map(o => [norm(o), o]));

  const byRef = new Map();
  for (const row of (state.leadsData || [])) {
    const ref = getField(row, 'Referred By', 'referred by');
    if (!ref || !String(ref).trim()) continue;
    const key = norm(String(ref).trim());
    const name = String(ref).trim();
    const cd = parseDate(getField(row, 'Created Date', 'created date', 'Create Date', 'create date'));
    const ownerStr = String(getField(row, 'Lead Owner', 'lead owner', 'Owner', 'owner') || '').trim();
    const branchStr = String(getField(row, 'Branch', 'branch') || '').trim();

    if (!byRef.has(key)) byRef.set(key, { name, allDates: [], windowDates: [], owners: new Map(), branches: new Map() });
    const rec = byRef.get(key);
    if (cd) {
      rec.allDates.push(cd);
      if (cd >= floorDate && cd <= cutoffDate) {
        rec.windowDates.push(cd);
        if (ownerStr) rec.owners.set(ownerStr, (rec.owners.get(ownerStr) || 0) + 1);
        if (branchStr) rec.branches.set(branchStr, (rec.branches.get(branchStr) || 0) + 1);
      }
    }
  }

  const reactThreshold = new Date(cutoffDate);
  reactThreshold.setUTCDate(reactThreshold.getUTCDate() - reactDays);

  const huntingRealtors = [], farmingRealtors = [];

  for (const [key, rec] of byRef.entries()) {
    if (!rec.windowDates.length) continue;

    const allSorted = [...rec.allDates].sort((a, b) => a - b);
    const uniqueDays = [];
    const seen = new Set();
    for (const d of allSorted) {
      const dk = d.toISOString().slice(0, 10);
      if (!seen.has(dk)) { seen.add(dk); uniqueDays.push(d); }
    }
    const firstDate = uniqueDays[0] || null;
    const penult = uniqueDays.length >= 2 ? uniqueDays[uniqueDays.length - 2] : null;
    const c2 = firstDate ? firstDate >= floorDate : false;
    const c4 = penult ? penult <= reactThreshold : false;

    let assignedOwner = '';
    const me = state.masterMap.get(key);
    if (me && me.owner && me.source === 'manual') {
      assignedOwner = me.owner;
    } else {
      let best = '', bestN = -1;
      for (const [o, n] of rec.owners.entries()) {
        const canonical = allowedNorm.get(norm(o));
        if (canonical && n > bestN) { bestN = n; best = canonical; }
      }
      if (bestN > -1) assignedOwner = best;
      if (!assignedOwner && oppOwnerMap.has(key)) {
        const canonical = allowedNorm.get(norm(oppOwnerMap.get(key)));
        if (canonical) assignedOwner = canonical;
      }
    }
    if (!assignedOwner || assignedOwner !== owner) continue;

    let branch = '—';
    if (rec.branches.size > 0) {
      let bestB = '', bestN = -1;
      for (const [b, n] of rec.branches.entries()) if (n > bestN) { bestN = n; bestB = b; }
      if (bestB) branch = bestB;
    }

    const med = c2 ? 'Hunting New' : c4 ? 'Hunting Rescued' : 'Farming Lead';
    const detail = { name: rec.name, branch, firstDate, cnt: rec.windowDates.length, med };
    if (c2 || c4) huntingRealtors.push(detail);
    else farmingRealtors.push(detail);
  }

  return {
    hunting: huntingRealtors.length, farming: farmingRealtors.length,
    total: huntingRealtors.length + farmingRealtors.length,
    huntingRealtors, farmingRealtors
  };
}

// Shift the H/F window cutoff to the same day-of-month in the comparison period
function getCmpHFWindow(globalCutoff, windowDays, cmpYear, cmpMonths0) {
  const sorted = [...cmpMonths0].sort((a, b) => a - b);
  const lastM = sorted[sorted.length - 1];
  const dayOfMonth = globalCutoff.getUTCDate();
  const lastDayOfCmpMonth = new Date(Date.UTC(cmpYear, lastM + 1, 0)).getUTCDate();
  const clampedDay = Math.min(dayOfMonth, lastDayOfCmpMonth);
  const cmpCutoff = new Date(Date.UTC(cmpYear, lastM, clampedDay, 23, 59, 59, 999));
  const cmpFloor = new Date(cmpCutoff);
  cmpFloor.setUTCDate(cmpFloor.getUTCDate() - windowDays);
  return { cmpCutoff, cmpFloor };
}

function calcTeamAvgHF() {
  const owners = getAllowedOwners();
  const map = new Map(owners.map(o => [o, { h: 0, f: 0 }]));
  for (const r of (state.activeResults || [])) {
    const d = map.get(r.assignedOwner);
    if (!d) continue;
    if (r.med && r.med.startsWith('Hunting')) d.h++;
    else d.f++;
  }
  const vals = [...map.values()];
  const aH = vals.filter(v => v.h >= 1), aF = vals.filter(v => v.f >= 1);
  return {
    avgH: aH.length ? aH.reduce((s, v) => s + v.h, 0) / aH.length : 0,
    avgF: aF.length ? aF.reduce((s, v) => s + v.f, 0) / aF.length : 0
  };
}

function goalBar(pct) {
  const w = Math.min(pct, 100);
  const col = pct >= 100 ? '#085041' : pct >= 70 ? '#D4A000' : 'var(--hs-red)';
  return '<div class="perf-goal-track"><div class="perf-goal-fill" style="width:' + w + '%;background:' + col + '"></div></div>';
}

function dChipMoney(main, cmp) {
  if (cmp === null || cmp === undefined) return '';
  const diff = main - cmp;
  if (Math.abs(diff) < 1) return '<span class="perf-delta perf-delta-neutral">&#8596; no change</span>';
  const up = diff > 0;
  const pct = cmp !== 0 ? Math.round((diff / cmp) * 100) : null;
  const pctStr = pct !== null ? ' (' + (up ? '+' : '') + pct + '%)' : '';
  return '<span class="perf-delta ' + (up ? 'perf-delta-up' : 'perf-delta-dn') + '">' + (up ? '&#9650; +' : '&#9660; ') + fmtMoney(Math.abs(diff)) + pctStr + '</span>';
}

function dChipInt(main, cmp) {
  if (cmp === null || cmp === undefined) return '';
  const diff = main - cmp;
  if (diff === 0) return '<span class="perf-delta perf-delta-neutral">&#8596; no change</span>';
  const up = diff > 0;
  const pct = cmp !== 0 ? Math.round((diff / cmp) * 100) : null;
  const pctStr = pct !== null ? ' (' + (up ? '+' : '') + pct + '%)' : '';
  return '<span class="perf-delta ' + (up ? 'perf-delta-up' : 'perf-delta-dn') + '">' + (up ? '&#9650; +' : '&#9660; ') + Math.abs(diff) + pctStr + '</span>';
}

function hfChip(val, avg) {
  if (!avg) return '';
  if (val > avg + 1) return '<span class="perf-hf-chip perf-hf-above">&#9650; above avg</span>';
  if (val < avg - 1) return '<span class="perf-hf-chip perf-hf-below">&#9660; below avg</span>';
  return '<span class="perf-hf-chip perf-hf-avg">&#8776; avg</span>';
}

function pLabel(year, months0, today, isCompare) {
  const s = [...months0].sort((a, b) => a - b);
  const mStr = s.length === 1 ? MS_SHORT[s[0]] : MS_SHORT[s[0]] + '–' + MS_SHORT[s[s.length - 1]];
  return mStr + ' ' + year + (isCompare ? ' (wk ' + weekOfMonth(today) + ' cut)' : ' (thru today)');
}

// ── Modal builders ──────────────────────────────────────────────────────────

const _perfModalCache = new Map();

function buildLoanModal(owner, start, end, label) {
  const rows = (state.oppData || []).filter(row => {
    if (String(getField(row, 'Stage', 'stage') || '').trim().toLowerCase() !== 'closed won') return false;
    if (norm(String(getField(row, 'Opportunity Owner', 'opportunity owner') || '').trim()) !== norm(owner)) return false;
    const d = parseDate(getField(row, 'Disbursement Date', 'disbursement date'));
    if (!d || d < start || d > end) return false;
    if (String(getField(row, 'Lender', 'lender') || '').trim().toLowerCase().includes('city lending inc')) return false;
    return true;
  });
  const enriched = rows.map(row => ({
    lnNum: String(getField(row, 'Loan #', 'loan #') || '—').trim(),
    oppName: String(getField(row, 'Opportunity Name', 'opportunity name') || '—').trim(),
    realtor: String(getField(row, 'Referred By', 'referred by') || '—').trim(),
    branch: String(getField(row, 'Branch', 'branch') || '').trim() || '—',
    disbDate: parseDate(getField(row, 'Disbursement Date', 'disbursement date')),
    amt: parseFloat(String(getField(row, 'Loan Amount', 'loan amount', 'Amount', 'amount') || '').replace(/[$,]/g, '')) || 0
  }));
  enriched.sort((a, b) => (a.disbDate || 0) - (b.disbDate || 0));
  const total = enriched.reduce((s, e) => s + e.amt, 0);
  const head = '<tr><th>Loan #</th><th>Opportunity Name</th><th>Realtor</th><th>Branch</th><th>Disbursement Date</th><th>Loan Amount</th></tr>';
  const body = enriched.map(e =>
    '<tr>' +
    '<td style="font-family:monospace;font-size:10px;color:#556080">' + e.lnNum + '</td>' +
    '<td style="font-weight:600">' + e.oppName + '</td>' +
    '<td>' + e.realtor + '</td>' +
    '<td style="font-size:11px">' + e.branch + '</td>' +
    '<td class="dt">' + fmtDate(e.disbDate) + '</td>' +
    '<td class="modal-amount">$' + Math.round(e.amt).toLocaleString('en-US') + '</td>' +
    '</tr>'
  ).join('') +
  '<tr style="background:#EEF1F8;font-weight:700"><td colspan="5" style="text-align:right;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total</td><td class="modal-amount">$' + Math.round(total).toLocaleString('en-US') + '</td></tr>';
  return {
    title: owner + ' — Closed Won',
    sub: label + ' · ' + enriched.length + ' loan' + (enriched.length !== 1 ? 's' : '') + ' · $' + Math.round(total).toLocaleString('en-US'),
    head, body,
    csvData: [
      ['Loan #', 'Opportunity Name', 'Realtor', 'Branch', 'Disbursement Date', 'Loan Amount'],
      ...enriched.map(e => [e.lnNum, e.oppName, e.realtor, e.branch === '—' ? '' : e.branch, fmtDate(e.disbDate), e.amt])
    ]
  };
}

function buildPipelineModal(owner, start, end, label) {
  const rows = (state.oppData || []).filter(row => {
    if (norm(String(getField(row, 'Opportunity Owner', 'opportunity owner') || '').trim()) !== norm(owner)) return false;
    const cd = parseDate(getField(row, 'Created Date', 'created date', 'Create Date', 'create date'));
    return cd && cd >= start && cd <= end;
  });
  const enriched = rows.map(row => {
    const stage = String(getField(row, 'Stage', 'stage') || '—').trim();
    return {
      lnNum: String(getField(row, 'Loan #', 'loan #') || '—').trim(),
      oppName: String(getField(row, 'Opportunity Name', 'opportunity name') || '—').trim(),
      realtor: String(getField(row, 'Referred By', 'referred by') || '—').trim(),
      stage,
      createdDate: parseDate(getField(row, 'Created Date', 'created date', 'Create Date', 'create date')),
      stillActive: stage.toLowerCase() !== 'closed lost'
    };
  });
  enriched.sort((a, b) => (a.createdDate || 0) - (b.createdDate || 0));
  const activeCount = enriched.filter(e => e.stillActive).length;
  const head = '<tr><th>Loan #</th><th>Opportunity Name</th><th>Realtor</th><th>Stage</th><th>Created Date</th><th>Still Active</th></tr>';
  const body = enriched.map(e =>
    '<tr>' +
    '<td style="font-family:monospace;font-size:10px;color:#556080">' + e.lnNum + '</td>' +
    '<td style="font-weight:600">' + e.oppName + '</td>' +
    '<td>' + e.realtor + '</td>' +
    '<td style="font-size:11px">' + e.stage + '</td>' +
    '<td class="dt">' + fmtDate(e.createdDate) + '</td>' +
    '<td style="text-align:center">' + (e.stillActive ? '<span style="color:#085041;font-weight:700">Yes</span>' : '<span style="color:#A32D2D">No</span>') + '</td>' +
    '</tr>'
  ).join('');
  return {
    title: owner + ' — Opportunities Created',
    sub: label + ' · ' + enriched.length + ' opp' + (enriched.length !== 1 ? 's' : '') + ' · ' + activeCount + ' still active',
    head, body,
    csvData: [
      ['Loan #', 'Opportunity Name', 'Realtor', 'Stage', 'Created Date', 'Still Active'],
      ...enriched.map(e => [e.lnNum, e.oppName, e.realtor, e.stage, fmtDate(e.createdDate), e.stillActive ? 'Yes' : 'No'])
    ]
  };
}

function buildHFModal(isHunting, realtors, owner, label) {
  const type = isHunting ? 'Hunting' : 'Farming';
  const sorted = [...realtors].sort((a, b) => (b.cnt || 0) - (a.cnt || 0));
  const head = '<tr><th>Realtor</th><th>Branch</th><th>1st Lead Date</th><th>Period Leads</th><th>Rating</th></tr>';
  const body = sorted.map(r => {
    const isH = r.med && r.med.startsWith('Hunting');
    const badgeStyle = isH
      ? 'background:#FDE8E8;color:#A32D2D;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:700;white-space:nowrap'
      : 'background:#E8F5F0;color:#085041;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:700;white-space:nowrap';
    return '<tr>' +
      '<td style="font-weight:600">' + (r.name || '—') + '</td>' +
      '<td style="font-size:11px">' + (r.branch || '—') + '</td>' +
      '<td class="dt">' + fmtDate(r.firstDate) + '</td>' +
      '<td style="text-align:center;font-weight:700;color:var(--hs-navy)">' + (r.cnt || 0) + '</td>' +
      '<td><span style="' + badgeStyle + '">' + (r.med || type) + '</span></td>' +
      '</tr>';
  }).join('');
  return {
    title: owner + ' — ' + type + ' Realtors',
    sub: label + ' · ' + realtors.length + ' realtor' + (realtors.length !== 1 ? 's' : ''),
    head, body,
    csvData: [
      ['Realtor', 'Branch', '1st Lead Date', 'Period Leads', 'Rating'],
      ...sorted.map(r => [r.name || '', r.branch || '', fmtDate(r.firstDate), r.cnt || 0, r.med || type])
    ]
  };
}

// ── Main render ─────────────────────────────────────────────────────────────

export function renderPerformance() {
  const content = document.getElementById('perf-content');
  if (!content) return;

  if (!state.oppData || !state.oppData.length) {
    content.innerHTML = '<div class="empty-state">Run calculation first to view performance metrics</div>';
    return;
  }

  const owner = (document.getElementById('perf-owner') || {}).value || '';
  if (!owner) {
    content.innerHTML = '<div class="perf-empty-bd"><i class="ti ti-user-circle" style="font-size:32px;color:#CCD5E0"></i><div>Select a Business Developer above</div></div>';
    return;
  }

  const yearEl = document.getElementById('perf-year');
  const monthsEl = document.getElementById('perf-months');
  const cmpYearEl = document.getElementById('perf-cmp-year');
  const cmpMonthsEl = document.getElementById('perf-cmp-months');

  const year = parseInt((yearEl || {}).value) || new Date().getUTCFullYear();
  const months0 = monthsEl ? Array.from(monthsEl.selectedOptions).map(o => parseInt(o.value)) : [];
  const cmpYear = parseInt((cmpYearEl || {}).value) || year;
  const cmpMonths0 = cmpMonthsEl ? Array.from(cmpMonthsEl.selectedOptions).map(o => parseInt(o.value)) : [];

  if (!months0.length) {
    content.innerHTML = '<div class="empty-state">Select at least one month for the main period</div>';
    return;
  }

  const today = new Date();
  const { start, end } = getPeriodBounds(year, months0, today, false);
  const hasCmp = cmpMonths0.length > 0;
  const cmpBounds = hasCmp ? getPeriodBounds(cmpYear, cmpMonths0, today, true) : null;

  // Global Metrics window settings (for shifting the H/F comparison window)
  const globalCutoffStr = (document.getElementById('cutoff-date') || {}).value || '';
  const globalCutoff = globalCutoffStr ? new Date(globalCutoffStr + 'T23:59:59Z') : today;
  const windowDays = parseInt((document.getElementById('window-days') || {}).value) || 60;

  const mainLoan = calcLoanAmount(owner, start, end);
  const mainPipe = calcPipelineActivity(owner, start, end);
  const mainHF   = getMainHFDetail(owner);
  const teamAvg  = calcTeamAvgHF();

  const cmpLoan = hasCmp ? calcLoanAmount(owner, cmpBounds.start, cmpBounds.end) : null;
  const cmpPipe = hasCmp ? calcPipelineActivity(owner, cmpBounds.start, cmpBounds.end) : null;

  // Comparison H/F uses a shifted window: same windowDays, cutoff shifted to same day-of-month in comparison period
  let cmpHF = null;
  if (hasCmp && state.leadsData && state.leadsData.length) {
    const { cmpFloor, cmpCutoff } = getCmpHFWindow(globalCutoff, windowDays, cmpYear, cmpMonths0);
    cmpHF = calcHuntingFarmingForWindow(owner, cmpFloor, cmpCutoff);
  }

  const loanGoal = kpiGoals.loanAmount, oppsGoal = kpiGoals.pipelineOpps;
  const loanPct  = loanGoal > 0 ? Math.round((mainLoan / loanGoal) * 100) : 0;
  const oppsPct  = oppsGoal > 0 ? Math.round((mainPipe.created / oppsGoal) * 100) : 0;
  const loanCol  = loanPct >= 100 ? '#085041' : loanPct >= 70 ? '#D4A000' : '#CC3030';
  const oppsCol  = oppsPct >= 100 ? '#085041' : oppsPct >= 70 ? '#D4A000' : '#CC3030';

  const cmpLoanPct = (hasCmp && loanGoal > 0) ? Math.round((cmpLoan / loanGoal) * 100) : null;
  const cmpOppsPct = (hasCmp && oppsGoal > 0) ? Math.round((cmpPipe.created / oppsGoal) * 100) : null;

  const total = mainHF.total || 1;
  const hPct = Math.round((mainHF.hunting / total) * 100);
  const fPct = Math.round((mainHF.farming / total) * 100);

  const mainLbl = pLabel(year, months0, today, false);
  const cmpLbl  = hasCmp ? pLabel(cmpYear, cmpMonths0, today, true) : '';

  // Populate modal cache
  _perfModalCache.clear();
  _perfModalCache.set('mainLoan',    buildLoanModal(owner, start, end, mainLbl));
  _perfModalCache.set('mainPipe',    buildPipelineModal(owner, start, end, mainLbl));
  _perfModalCache.set('mainHunting', buildHFModal(true,  mainHF.huntingRealtors, owner, mainLbl));
  _perfModalCache.set('mainFarming', buildHFModal(false, mainHF.farmingRealtors, owner, mainLbl));
  if (hasCmp) {
    _perfModalCache.set('cmpLoan',    buildLoanModal(owner, cmpBounds.start, cmpBounds.end, cmpLbl));
    _perfModalCache.set('cmpPipe',    buildPipelineModal(owner, cmpBounds.start, cmpBounds.end, cmpLbl));
    if (cmpHF) {
      _perfModalCache.set('cmpHunting', buildHFModal(true,  cmpHF.huntingRealtors, owner, cmpLbl));
      _perfModalCache.set('cmpFarming', buildHFModal(false, cmpHF.farmingRealtors, owner, cmpLbl));
    }
  }

  content.innerHTML =
    // Owner heading — main title of the report
    '<div class="perf-owner-heading">' + owner + '</div>' +

    // Period banner (no owner chip)
    '<div class="perf-banner">' +
      '<span class="perf-banner-main">' + mainLbl + '</span>' +
      (hasCmp ? '<span class="perf-banner-vs">vs</span><span class="perf-banner-cmp">' + cmpLbl + '</span>' : '') +
    '</div>' +

    '<div class="perf-kpi-grid">' +

    // ── Card 1: B2C Goal ──
    '<div class="perf-kpi-card">' +
      '<div class="perf-card-tag">B2C GOAL PERFORMANCE</div>' +
      '<div class="perf-card-label">Cumulative Loan Amount</div>' +
      '<button class="perf-clickable-val" data-perf-modal="mainLoan">' + fmtMoney(mainLoan) + '</button>' +
      '<div class="perf-card-exact">' + fmtMoneyFull(mainLoan) + '</div>' +
      goalBar(loanPct) +
      '<div class="perf-card-pct" style="color:' + loanCol + '">' + loanPct + '% <span class="perf-pct-of">of goal</span></div>' +
      '<div class="perf-card-goal-lbl">Goal &middot; ' + fmtMoneyFull(loanGoal) + '</div>' +
      (hasCmp
        ? '<div class="perf-cmp-block">' +
            '<div class="perf-cmp-header">vs ' + cmpLbl + '</div>' +
            '<div class="perf-cmp-metric">' +
              '<div class="perf-cmp-metric-label">Cumulative Loan Amount</div>' +
              '<button class="perf-cmp-metric-val perf-cmp-clickable" data-perf-modal="cmpLoan">' + fmtMoney(cmpLoan) + '</button>' +
              dChipMoney(mainLoan, cmpLoan) +
              (cmpLoanPct !== null ? '<div class="perf-cmp-metric-sub">' + cmpLoanPct + '% of goal</div>' : '') +
            '</div>' +
          '</div>'
        : '') +
    '</div>' +

    // ── Card 2: Pipeline Activity ──
    '<div class="perf-kpi-card">' +
      '<div class="perf-card-tag">PIPELINE ACTIVITY</div>' +
      '<div class="perf-card-label">Opportunities Created</div>' +
      '<button class="perf-clickable-val" data-perf-modal="mainPipe">' + mainPipe.created + '</button>' +
      '<div class="perf-card-exact">Still Active: <strong>' + mainPipe.stillActive + '</strong> / ' + mainPipe.created + '</div>' +
      goalBar(oppsPct) +
      '<div class="perf-card-pct" style="color:' + oppsCol + '">' + oppsPct + '% <span class="perf-pct-of">of goal</span></div>' +
      '<div class="perf-card-goal-lbl">Goal &middot; ' + oppsGoal + ' opportunities</div>' +
      (hasCmp
        ? '<div class="perf-cmp-block">' +
            '<div class="perf-cmp-header">vs ' + cmpLbl + '</div>' +
            '<div class="perf-cmp-metric">' +
              '<div class="perf-cmp-metric-label">Opportunities Created</div>' +
              '<button class="perf-cmp-metric-val perf-cmp-clickable" data-perf-modal="cmpPipe">' + cmpPipe.created + '</button>' +
              dChipInt(mainPipe.created, cmpPipe.created) +
              '<div class="perf-cmp-metric-sub">Active: ' + cmpPipe.stillActive + (cmpOppsPct !== null ? ' &nbsp;&middot; ' + cmpOppsPct + '% of goal' : '') + '</div>' +
            '</div>' +
          '</div>'
        : '') +
    '</div>' +

    // ── Card 3: B2B Behavior ──
    '<div class="perf-kpi-card">' +
      '<div class="perf-card-tag">B2B BEHAVIOR &mdash; HUNTING / FARMING</div>' +
      '<div class="perf-hf-row">' +
        '<div class="perf-hf-block">' +
          '<div class="perf-card-label">Hunting</div>' +
          '<button class="perf-clickable-val" style="color:#A32D2D" data-perf-modal="mainHunting">' + mainHF.hunting + '</button>' +
          '<div class="perf-card-exact">' + hPct + '% of active</div>' +
          hfChip(mainHF.hunting, teamAvg.avgH) +
        '</div>' +
        '<div class="perf-hf-divider"></div>' +
        '<div class="perf-hf-block">' +
          '<div class="perf-card-label">Farming</div>' +
          '<button class="perf-clickable-val" style="color:#085041" data-perf-modal="mainFarming">' + mainHF.farming + '</button>' +
          '<div class="perf-card-exact">' + fPct + '% of active</div>' +
          hfChip(mainHF.farming, teamAvg.avgF) +
        '</div>' +
      '</div>' +
      '<div class="perf-hf-avg-row">' +
        '<span class="perf-hf-avg-label">Team avg</span>' +
        '<span class="perf-hf-avg-val" style="color:#A32D2D">' + teamAvg.avgH.toFixed(1) + '</span>' +
        '<span class="perf-hf-avg-sep">H</span>' +
        '<span class="perf-hf-avg-sep" style="color:#CCD5E0;margin:0 2px">/</span>' +
        '<span class="perf-hf-avg-val" style="color:#085041">' + teamAvg.avgF.toFixed(1) + '</span>' +
        '<span class="perf-hf-avg-sep">F</span>' +
        '<span class="perf-hf-avg-note">global Metrics window</span>' +
      '</div>' +
      (hasCmp && cmpHF
        ? '<div class="perf-cmp-block">' +
            '<div class="perf-cmp-header">vs ' + cmpLbl + ' &middot; ' + windowDays + '-day window</div>' +
            '<div class="perf-cmp-hf-row">' +
              '<div class="perf-cmp-hf-block">' +
                '<div class="perf-cmp-metric-label" style="color:#A32D2D">Hunting</div>' +
                '<button class="perf-cmp-metric-val perf-cmp-clickable" style="color:#A32D2D" data-perf-modal="cmpHunting">' + cmpHF.hunting + '</button>' +
                dChipInt(mainHF.hunting, cmpHF.hunting) +
              '</div>' +
              '<div class="perf-cmp-hf-block">' +
                '<div class="perf-cmp-metric-label" style="color:#085041">Farming</div>' +
                '<button class="perf-cmp-metric-val perf-cmp-clickable" style="color:#085041" data-perf-modal="cmpFarming">' + cmpHF.farming + '</button>' +
                dChipInt(mainHF.farming, cmpHF.farming) +
              '</div>' +
            '</div>' +
          '</div>'
        : '') +
    '</div>' +

    '</div>';
}

function populateSelects() {
  const ownerEl = document.getElementById('perf-owner');
  if (!ownerEl) return;

  const owners = getAllowedOwners();
  const prevOwner = ownerEl.value;
  ownerEl.innerHTML = '<option value="">&#8212; Select BD &#8212;</option>' +
    owners.map(o => '<option value="' + o + '"' + (o === prevOwner ? ' selected' : '') + '>' + o + '</option>').join('');

  const yearsSet = new Set();
  const today = new Date();
  yearsSet.add(today.getUTCFullYear());
  yearsSet.add(today.getUTCFullYear() - 1);
  for (const row of (state.oppData || [])) {
    const d1 = parseDate(getField(row, 'Disbursement Date', 'disbursement date'));
    const d2 = parseDate(getField(row, 'Created Date', 'created date', 'Create Date', 'create date'));
    if (d1) yearsSet.add(d1.getUTCFullYear());
    if (d2) yearsSet.add(d2.getUTCFullYear());
  }
  const sortedYears = [...yearsSet].sort((a, b) => b - a);
  const yOpts = sortedYears.map(y => '<option value="' + y + '">' + y + '</option>').join('');
  const curY = today.getUTCFullYear(), prevY = curY - 1;

  const yearEl = document.getElementById('perf-year');
  if (yearEl) {
    const pv = yearEl.value;
    yearEl.innerHTML = yOpts;
    yearEl.value = pv || String(curY);
    if (!yearEl.value && sortedYears.length) yearEl.value = String(sortedYears[0]);
  }
  const cmpYearEl = document.getElementById('perf-cmp-year');
  if (cmpYearEl) {
    const pv = cmpYearEl.value;
    cmpYearEl.innerHTML = yOpts;
    cmpYearEl.value = pv || String(curY);
    if (!cmpYearEl.value && sortedYears.length) cmpYearEl.value = String(sortedYears[0]);
  }

  const monthsEl = document.getElementById('perf-months');
  const cmpMonthsEl = document.getElementById('perf-cmp-months');
  const curM = today.getUTCMonth(), prevM = curM === 0 ? 11 : curM - 1;
  const mOpts = MS_FULL.map((n, i) => '<option value="' + i + '">' + n + '</option>').join('');

  if (monthsEl && !monthsEl.options.length) {
    monthsEl.innerHTML = mOpts;
    monthsEl.options[curM].selected = true;
  }
  if (cmpMonthsEl && !cmpMonthsEl.options.length) {
    cmpMonthsEl.innerHTML = mOpts;
    cmpMonthsEl.options[prevM].selected = true;
  }
}

export function initPerformance() {
  populateSelects();
  renderPerformance();
}

// Event delegation for Performance modal clicks
document.addEventListener('click', e => {
  const el = e.target.closest('[data-perf-modal]');
  if (!el) return;
  const key = el.getAttribute('data-perf-modal');
  const m = _perfModalCache.get(key);
  if (m) openModal(m.title, m.sub, m.head, m.body, m.csvData);
});
