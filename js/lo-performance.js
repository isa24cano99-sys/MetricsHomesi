import { state } from './state.js';
import { norm, parseDate, fmtDate, getField, normalizeLO } from './utils.js';
import { openModal } from './modal.js';

function getAllowedLOs() {
  return document.getElementById('lo-list').value
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

function fmtShortDate(d) {
  if (!d) return '?';
  return MS_SHORT[d.getUTCMonth()] + ' ' + d.getUTCDate();
}

function getPeriodBounds(year, months0, today, isCompare) {
  const sorted = [...months0].sort((a, b) => a - b);
  const start = new Date(Date.UTC(year, sorted[0], 1));
  const lastM = sorted[sorted.length - 1];
  const isCurrent = !isCompare && year === today.getUTCFullYear() && sorted.includes(today.getUTCMonth());
  const end = isCurrent
    ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999))
    : new Date(Date.UTC(year, lastM + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

function matchLo(row, lo) {
  const loRaw = String(getField(row, 'Loan Officers', 'loan officers', 'Loan Officer', 'loan officer') || '').trim();
  return normalizeLO(loRaw) === normalizeLO(lo);
}

// B2C Goal: Closed Won opps where Loan Officers = this LO, disbursement_date in period
function calcLoLoanAmount(lo, start, end) {
  let total = 0;
  for (const row of (state.oppData || [])) {
    if (String(getField(row, 'Stage', 'stage') || '').trim().toLowerCase() !== 'closed won') continue;
    if (!matchLo(row, lo)) continue;
    const disbDate = parseDate(getField(row, 'Disbursement Date', 'disbursement date'));
    if (!disbDate || disbDate < start || disbDate > end) continue;
    if (String(getField(row, 'Lender', 'lender') || '').trim().toLowerCase().includes('city lending inc')) continue;
    const raw = String(getField(row, 'Loan Amount', 'loan amount', 'Amount', 'amount') || '').replace(/[$,]/g, '');
    total += parseFloat(raw) || 0;
  }
  return total;
}

// Pipeline Activity: opps where Loan Officers = this LO AND created_date in period
function calcLoPipelineActivity(lo, start, end) {
  let created = 0, stillActive = 0;
  for (const row of (state.oppData || [])) {
    if (!matchLo(row, lo)) continue;
    const cd = parseDate(getField(row, 'Created Date', 'created date', 'Create Date', 'create date'));
    if (!cd || cd < start || cd > end) continue;
    created++;
    const stage = String(getField(row, 'Stage', 'stage') || '').trim().toLowerCase();
    if (stage !== 'closed lost') stillActive++;
  }
  return { created, stillActive };
}

// B2B Behavior: realtors whose leads have Loan Officer = this LO in window, H/F classification
function calcLoHuntingFarmingForWindow(lo, floorDate, cutoffDate) {
  const reactDays = parseInt((document.getElementById('lo-react-days') || {}).value) || 150;
  const allowedLOs = getAllowedLOs();
  const allowedNorm = new Map(allowedLOs.map(l => [norm(l), l]));

  const oppLoMap = new Map();
  for (const row of (state.oppData || [])) {
    const ref = getField(row, 'Referred By', 'referred by');
    if (!ref || !String(ref).trim()) continue;
    const loRaw = getField(row, 'Loan Officers', 'loan officers', 'Loan Officer', 'loan officer');
    if (loRaw) oppLoMap.set(norm(String(ref).trim()), normalizeLO(String(loRaw).trim()));
  }

  const byRef = new Map();
  for (const row of (state.leadsData || [])) {
    const ref = getField(row, 'Referred By', 'referred by');
    if (!ref || !String(ref).trim()) continue;
    const key = norm(String(ref).trim());
    const name = String(ref).trim();
    const cd = parseDate(getField(row, 'Created Date', 'created date', 'Create Date', 'create date'));
    const loRaw = String(getField(row, 'Loan Officer', 'loan officer') || '').trim();
    const loStr = loRaw ? normalizeLO(loRaw) : '';
    const branchStr = String(getField(row, 'Branch', 'branch') || '').trim();

    if (!byRef.has(key)) byRef.set(key, { name, allDates: [], windowDates: [], los: new Map(), branches: new Map() });
    const rec = byRef.get(key);
    if (cd) {
      rec.allDates.push(cd);
      if (cd >= floorDate && cd <= cutoffDate) {
        rec.windowDates.push(cd);
        if (loStr) rec.los.set(loStr, (rec.los.get(loStr) || 0) + 1);
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
    const uniqueDays = [], seen = new Set();
    for (const d of allSorted) {
      const dk = d.toISOString().slice(0, 10);
      if (!seen.has(dk)) { seen.add(dk); uniqueDays.push(d); }
    }
    const firstDate = uniqueDays[0] || null;
    const penult = uniqueDays.length >= 2 ? uniqueDays[uniqueDays.length - 2] : null;
    const c2 = firstDate ? firstDate >= floorDate : false;
    const c4 = penult ? penult <= reactThreshold : false;

    let assignedLO = '';
    const me = state.loMasterMap.get(key);
    if (me && me.loan_officer && me.source === 'manual') {
      assignedLO = me.loan_officer;
    } else {
      if (rec.los.size > 0) {
        let best = '', bestN = -1;
        for (const [l, n] of rec.los.entries()) {
          const canonical = allowedNorm.get(norm(l));
          if (canonical && n > bestN) { bestN = n; best = canonical; }
        }
        if (bestN > -1) assignedLO = best;
      }
      if (!assignedLO && oppLoMap.has(key)) {
        const canonical = allowedNorm.get(norm(oppLoMap.get(key)));
        if (canonical) assignedLO = canonical;
      }
    }
    if (!assignedLO || normalizeLO(assignedLO) !== normalizeLO(lo)) continue;

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

function calcLoTeamAvgHF(cutoff, baseDate) {
  const los = getAllowedLOs();
  const hVals = [], fVals = [];
  for (const lo of los) {
    const hf = calcLoHuntingFarmingForWindow(lo, baseDate, cutoff);
    if (hf.hunting >= 1) hVals.push(hf.hunting);
    if (hf.farming >= 1) fVals.push(hf.farming);
  }
  return {
    avgH: hVals.length ? hVals.reduce((s, v) => s + v, 0) / hVals.length : 0,
    avgF: fVals.length ? fVals.reduce((s, v) => s + v, 0) / fVals.length : 0
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

function goalChip(pct) {
  if (pct >= 100) return '<span class="perf-goal-chip perf-goal-chip-above">&#9650; above goal</span>';
  if (pct >= 70)  return '<span class="perf-goal-chip perf-goal-chip-near">&#8776; near goal</span>';
  return '<span class="perf-goal-chip perf-goal-chip-below">&#9660; below goal</span>';
}

function pLabel(year, months0, today, isCompare) {
  const s = [...months0].sort((a, b) => a - b);
  const mStr = s.length === 1 ? MS_SHORT[s[0]] : MS_SHORT[s[0]] + '–' + MS_SHORT[s[s.length - 1]];
  if (isCompare) return mStr + ' ' + year + ' (full month)';
  const isCurrent = year === today.getUTCFullYear() && s.includes(today.getUTCMonth());
  return mStr + ' ' + year + (isCurrent ? ' (thru today)' : ' (full month)');
}

// Modal builders
const _loPerfModalCache = new Map();

function buildLoLoanModal(lo, start, end, label) {
  const rows = (state.oppData || []).filter(row => {
    if (String(getField(row, 'Stage', 'stage') || '').trim().toLowerCase() !== 'closed won') return false;
    if (!matchLo(row, lo)) return false;
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
    title: lo + ' — Closed Won',
    sub: label + ' · ' + enriched.length + ' loan' + (enriched.length !== 1 ? 's' : '') + ' · $' + Math.round(total).toLocaleString('en-US'),
    head, body,
    csvData: [
      ['Loan #', 'Opportunity Name', 'Realtor', 'Branch', 'Disbursement Date', 'Loan Amount'],
      ...enriched.map(e => [e.lnNum, e.oppName, e.realtor, e.branch === '—' ? '' : e.branch, fmtDate(e.disbDate), e.amt])
    ]
  };
}

function buildLoPipelineModal(lo, start, end, label) {
  const rows = (state.oppData || []).filter(row => {
    if (!matchLo(row, lo)) return false;
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
    title: lo + ' — Opportunities Created',
    sub: label + ' · ' + enriched.length + ' opp' + (enriched.length !== 1 ? 's' : '') + ' · ' + activeCount + ' still active',
    head, body,
    csvData: [
      ['Loan #', 'Opportunity Name', 'Realtor', 'Stage', 'Created Date', 'Still Active'],
      ...enriched.map(e => [e.lnNum, e.oppName, e.realtor, e.stage, fmtDate(e.createdDate), e.stillActive ? 'Yes' : 'No'])
    ]
  };
}

function buildLoHFModal(isHunting, realtors, lo, label) {
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
    title: lo + ' — ' + type + ' Realtors',
    sub: label + ' · ' + realtors.length + ' realtor' + (realtors.length !== 1 ? 's' : ''),
    head, body,
    csvData: [
      ['Realtor', 'Branch', '1st Lead Date', 'Period Leads', 'Rating'],
      ...sorted.map(r => [r.name || '', r.branch || '', fmtDate(r.firstDate), r.cnt || 0, r.med || type])
    ]
  };
}

// Main render
export function renderLoPerformance() {
  const content = document.getElementById('lo-perf-content');
  if (!content) return;

  if (!state.oppData || !state.oppData.length) {
    content.innerHTML = '<div class="empty-state">Run calculation first to view performance metrics</div>';
    return;
  }

  const lo = (document.getElementById('lo-perf-owner') || {}).value || '';
  if (!lo) {
    content.innerHTML = '<div class="perf-empty-bd"><i class="ti ti-user-circle" style="font-size:32px;color:#CCD5E0"></i><div>Select a Loan Officer above</div></div>';
    return;
  }

  const yearEl = document.getElementById('lo-perf-year');
  const monthsEl = document.getElementById('lo-perf-months');
  const cmpYearEl = document.getElementById('lo-perf-cmp-year');
  const cmpMonthsEl = document.getElementById('lo-perf-cmp-months');

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

  const windowDays = parseInt((document.getElementById('lo-window-days') || {}).value) || 60;

  const mainSorted = [...months0].sort((a, b) => a - b);
  const mainLastM  = mainSorted[mainSorted.length - 1];
  const isMainCurrent = year === today.getUTCFullYear() && months0.includes(today.getUTCMonth());
  const mainHFCutoff = isMainCurrent
    ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999))
    : new Date(Date.UTC(year, mainLastM + 1, 0, 23, 59, 59, 999));
  const mainHFBase = new Date(mainHFCutoff);
  mainHFBase.setUTCDate(mainHFBase.getUTCDate() - windowDays);

  const mainLoan = calcLoLoanAmount(lo, start, end);
  const mainPipe = calcLoPipelineActivity(lo, start, end);
  const mainHF   = calcLoHuntingFarmingForWindow(lo, mainHFBase, mainHFCutoff);
  const teamAvg  = calcLoTeamAvgHF(mainHFCutoff, mainHFBase);

  const cmpLoan = hasCmp ? calcLoLoanAmount(lo, cmpBounds.start, cmpBounds.end) : null;
  const cmpPipe = hasCmp ? calcLoPipelineActivity(lo, cmpBounds.start, cmpBounds.end) : null;

  let cmpHF = null, cmpHFCutoff = null, cmpHFBase = null, cmpHFLbl = '';
  if (hasCmp && state.leadsData && state.leadsData.length) {
    const cmpSorted = [...cmpMonths0].sort((a, b) => a - b);
    const lastCmpM = cmpSorted[cmpSorted.length - 1];
    const isCmpCurrent = cmpYear === today.getUTCFullYear() && cmpMonths0.includes(today.getUTCMonth());
    if (isCmpCurrent) {
      const dayOfMonth = mainHFCutoff.getUTCDate();
      const lastDayOfCmpMonth = new Date(Date.UTC(cmpYear, lastCmpM + 1, 0)).getUTCDate();
      cmpHFCutoff = new Date(Date.UTC(cmpYear, lastCmpM, Math.min(dayOfMonth, lastDayOfCmpMonth), 23, 59, 59, 999));
    } else {
      cmpHFCutoff = new Date(Date.UTC(cmpYear, lastCmpM + 1, 0, 23, 59, 59, 999));
    }
    cmpHFBase = new Date(cmpHFCutoff);
    cmpHFBase.setUTCDate(cmpHFBase.getUTCDate() - windowDays);
    cmpHF = calcLoHuntingFarmingForWindow(lo, cmpHFBase, cmpHFCutoff);
    cmpHFLbl = ('VS ' + MS_SHORT[lastCmpM] + ' ' + cmpYear + ' · ' + fmtShortDate(cmpHFBase) + ' → ' + fmtShortDate(cmpHFCutoff)).toUpperCase();
  }

  const loanGoal = 700000;
  const oppsGoal = 10;
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

  _loPerfModalCache.clear();
  _loPerfModalCache.set('loMainLoan',    buildLoLoanModal(lo, start, end, mainLbl));
  _loPerfModalCache.set('loMainPipe',    buildLoPipelineModal(lo, start, end, mainLbl));
  _loPerfModalCache.set('loMainHunting', buildLoHFModal(true,  mainHF.huntingRealtors, lo, mainLbl));
  _loPerfModalCache.set('loMainFarming', buildLoHFModal(false, mainHF.farmingRealtors, lo, mainLbl));
  if (hasCmp) {
    _loPerfModalCache.set('loCmpLoan',    buildLoLoanModal(lo, cmpBounds.start, cmpBounds.end, cmpLbl));
    _loPerfModalCache.set('loCmpPipe',    buildLoPipelineModal(lo, cmpBounds.start, cmpBounds.end, cmpLbl));
    if (cmpHF) {
      _loPerfModalCache.set('loCmpHunting', buildLoHFModal(true,  cmpHF.huntingRealtors, lo, cmpLbl));
      _loPerfModalCache.set('loCmpFarming', buildLoHFModal(false, cmpHF.farmingRealtors, lo, cmpLbl));
    }
  }

  content.innerHTML =
    '<div class="perf-owner-heading">' + lo + '</div>' +

    '<div class="perf-banner">' +
      '<span class="perf-banner-main">' + mainLbl + '</span>' +
      (hasCmp ? '<span class="perf-banner-vs">vs</span><span class="perf-banner-cmp">' + cmpLbl + '</span>' : '') +
    '</div>' +

    '<div class="perf-kpi-grid">' +

    // Card 1: B2C Goal
    '<div class="perf-kpi-card">' +
      '<div class="perf-card-tag">B2C GOAL PERFORMANCE</div>' +
      '<div class="perf-main-section">' +
        '<div class="perf-two-col">' +
          '<div class="perf-col">' +
            '<div class="perf-col-label">CUMULATIVE</div>' +
            '<button class="perf-clickable-val" data-lo-perf-modal="loMainLoan">' + fmtMoney(mainLoan) + '</button>' +
            '<div class="perf-card-exact">' + fmtMoneyFull(mainLoan) + '</div>' +
          '</div>' +
          '<div class="perf-col perf-col-secondary">' +
            '<div class="perf-col-label">GOAL</div>' +
            '<div class="perf-col-goal-val">' + fmtMoney(loanGoal) + '</div>' +
          '</div>' +
        '</div>' +
        goalBar(loanPct) +
        '<div class="perf-pct-row">' +
          '<span class="perf-big-pct" style="color:' + loanCol + '">' + loanPct + '%<span class="perf-pct-of"> of goal</span></span>' +
          goalChip(loanPct) +
        '</div>' +
      '</div>' +
      (hasCmp
        ? '<div class="perf-cmp-section">' +
            '<div class="perf-cmp-vs-hdr">VS ' + cmpLbl.toUpperCase() + '</div>' +
            '<div class="perf-two-col">' +
              '<div class="perf-col">' +
                '<div class="perf-col-label">CUMULATIVE</div>' +
                '<button class="perf-cmp-big-val perf-cmp-clickable" data-lo-perf-modal="loCmpLoan">' + fmtMoney(cmpLoan) + '</button>' +
              '</div>' +
              '<div class="perf-col perf-col-secondary">' +
                '<div class="perf-col-label">GOAL %</div>' +
                '<div class="perf-cmp-pct-val">' + (cmpLoanPct !== null ? cmpLoanPct + '% of goal' : '—') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="perf-change-row">' +
              '<span class="perf-change-lbl">CHANGE</span>' +
              dChipMoney(mainLoan, cmpLoan) +
            '</div>' +
          '</div>'
        : '') +
    '</div>' +

    // Card 2: Pipeline Activity
    '<div class="perf-kpi-card">' +
      '<div class="perf-card-tag">PIPELINE ACTIVITY</div>' +
      '<div class="perf-main-section">' +
        '<div class="perf-two-col">' +
          '<div class="perf-col">' +
            '<div class="perf-col-label">OPP. CREATED</div>' +
            '<button class="perf-clickable-val" data-lo-perf-modal="loMainPipe">' + mainPipe.created + '</button>' +
            '<div class="perf-card-exact">Still Active: <strong>' + mainPipe.stillActive + '</strong> / ' + mainPipe.created + '</div>' +
          '</div>' +
          '<div class="perf-col perf-col-secondary">' +
            '<div class="perf-col-label">GOAL</div>' +
            '<div class="perf-col-goal-val">' + oppsGoal + '</div>' +
          '</div>' +
        '</div>' +
        goalBar(oppsPct) +
        '<div class="perf-pct-row">' +
          '<span class="perf-big-pct" style="color:' + oppsCol + '">' + oppsPct + '%<span class="perf-pct-of"> of goal</span></span>' +
          goalChip(oppsPct) +
        '</div>' +
      '</div>' +
      (hasCmp
        ? '<div class="perf-cmp-section">' +
            '<div class="perf-cmp-vs-hdr">VS ' + cmpLbl.toUpperCase() + '</div>' +
            '<div class="perf-two-col">' +
              '<div class="perf-col">' +
                '<div class="perf-col-label">OPP. CREATED</div>' +
                '<button class="perf-cmp-big-val perf-cmp-clickable" data-lo-perf-modal="loCmpPipe">' + cmpPipe.created + '</button>' +
                '<div class="perf-cmp-metric-sub">Active: ' + cmpPipe.stillActive + '</div>' +
              '</div>' +
              '<div class="perf-col perf-col-secondary">' +
                '<div class="perf-col-label">GOAL %</div>' +
                '<div class="perf-cmp-pct-val">' + (cmpOppsPct !== null ? cmpOppsPct + '% of goal' : '—') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="perf-change-row">' +
              '<span class="perf-change-lbl">CHANGE</span>' +
              dChipInt(mainPipe.created, cmpPipe.created) +
            '</div>' +
          '</div>'
        : '') +
    '</div>' +

    // Card 3: B2B Behavior
    '<div class="perf-kpi-card">' +
      '<div class="perf-card-tag">B2B BEHAVIOR &mdash; HUNTING / FARMING</div>' +
      '<div class="perf-main-section">' +
        '<div class="perf-hf-row">' +
          '<div class="perf-hf-block">' +
            '<div class="perf-col-label" style="color:#A32D2D">HUNTING</div>' +
            '<button class="perf-clickable-val" style="color:#A32D2D" data-lo-perf-modal="loMainHunting">' + mainHF.hunting + '</button>' +
            '<div class="perf-card-exact">' + hPct + '% of active</div>' +
            hfChip(mainHF.hunting, teamAvg.avgH) +
          '</div>' +
          '<div class="perf-hf-divider"></div>' +
          '<div class="perf-hf-block">' +
            '<div class="perf-col-label" style="color:#085041">FARMING</div>' +
            '<button class="perf-clickable-val" style="color:#085041" data-lo-perf-modal="loMainFarming">' + mainHF.farming + '</button>' +
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
          '<span class="perf-hf-avg-note">' + fmtShortDate(mainHFBase) + ' → ' + fmtShortDate(mainHFCutoff) + '</span>' +
        '</div>' +
      '</div>' +
      (hasCmp && cmpHF
        ? '<div class="perf-cmp-section">' +
            '<div class="perf-cmp-vs-hdr">' + cmpHFLbl + '</div>' +
            '<div class="perf-cmp-hf-row">' +
              '<div class="perf-cmp-hf-col">' +
                '<div class="perf-col-label" style="color:#A32D2D">HUNTING</div>' +
                '<button class="perf-cmp-big-val perf-cmp-clickable" style="color:#A32D2D" data-lo-perf-modal="loCmpHunting">' + cmpHF.hunting + '</button>' +
                dChipInt(mainHF.hunting, cmpHF.hunting) +
              '</div>' +
              '<div class="perf-cmp-hf-col">' +
                '<div class="perf-col-label" style="color:#085041">FARMING</div>' +
                '<button class="perf-cmp-big-val perf-cmp-clickable" style="color:#085041" data-lo-perf-modal="loCmpFarming">' + cmpHF.farming + '</button>' +
                dChipInt(mainHF.farming, cmpHF.farming) +
              '</div>' +
            '</div>' +
          '</div>'
        : '') +
    '</div>' +

    '</div>';
}

function populateLoSelects() {
  const ownerEl = document.getElementById('lo-perf-owner');
  if (!ownerEl) return;

  const los = getAllowedLOs();
  const prevLO = ownerEl.value;
  ownerEl.innerHTML = '<option value="">&#8212; Select LO &#8212;</option>' +
    los.map(lo => '<option value="' + lo + '"' + (lo === prevLO ? ' selected' : '') + '>' + lo + '</option>').join('');

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
  const curY = today.getUTCFullYear();

  const yearEl = document.getElementById('lo-perf-year');
  if (yearEl) {
    const pv = yearEl.value;
    yearEl.innerHTML = yOpts;
    yearEl.value = pv || String(curY);
    if (!yearEl.value && sortedYears.length) yearEl.value = String(sortedYears[0]);
  }
  const cmpYearEl = document.getElementById('lo-perf-cmp-year');
  if (cmpYearEl) {
    const pv = cmpYearEl.value;
    cmpYearEl.innerHTML = yOpts;
    cmpYearEl.value = pv || String(curY);
    if (!cmpYearEl.value && sortedYears.length) cmpYearEl.value = String(sortedYears[0]);
  }

  const monthsEl = document.getElementById('lo-perf-months');
  const cmpMonthsEl = document.getElementById('lo-perf-cmp-months');
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

export function initLoPerformance() {
  populateLoSelects();
  renderLoPerformance();
}

// Event delegation for LO Performance modal clicks
document.addEventListener('click', e => {
  const el = e.target.closest('[data-lo-perf-modal]');
  if (!el) return;
  const key = el.getAttribute('data-lo-perf-modal');
  const m = _loPerfModalCache.get(key);
  if (m) openModal(m.title, m.sub, m.head, m.body, m.csvData);
});
