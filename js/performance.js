import { state } from './state.js';
import { norm, parseDate, fmtDate, getField } from './utils.js';
import { sbFetch } from './supabase.js';
import { openModal } from './modal.js';

export const kpiGoals = { loanAmount: 700000, pipelineOpps: 10, loanCountGoal: 2 };

export async function loadKpiSettings() {
  try {
    const rows = await sbFetch('kpi_settings?select=key,value,text_value');
    for (const r of (rows || [])) {
      if (r.key === 'loan_amount_goal') kpiGoals.loanAmount = Number(r.value) || 700000;
      if (r.key === 'loan_count_goal') kpiGoals.loanCountGoal = Number(r.value) || 2;
      if (r.key === 'pipeline_opps_goal') kpiGoals.pipelineOpps = Number(r.value) || 10;
      if (r.key === 'owners_list' && r.text_value) {
        const el = document.getElementById('owners-list');
        if (el) el.value = r.text_value;
      }
      if (r.key === 'lo_list' && r.text_value) {
        const el = document.getElementById('lo-list');
        const el2 = document.getElementById('lo-list-settings');
        if (el) el.value = r.text_value;
        if (el2) el2.value = r.text_value;
      }
    }
  } catch (_) { /* table may not exist yet — use defaults */ }
  const lcgEl = document.getElementById('kpi-loan-count-goal');
  const oEl   = document.getElementById('kpi-opps-goal');
  if (lcgEl) lcgEl.value = kpiGoals.loanCountGoal;
  if (oEl)   oEl.value   = kpiGoals.pipelineOpps;
}

export async function saveKpiSettings() {
  const lcgEl = document.getElementById('kpi-loan-count-goal');
  const oEl   = document.getElementById('kpi-opps-goal');
  if (lcgEl) kpiGoals.loanCountGoal = Math.max(0, Number(lcgEl.value) || 2);
  if (oEl)   kpiGoals.pipelineOpps  = Math.max(0, Number(oEl.value)   || 10);
  try {
    await sbFetch('kpi_settings?on_conflict=key', {
      method: 'POST',
      prefer: 'return=minimal,resolution=merge-duplicates',
      headers: { 'Prefer': 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify([
        { key: 'loan_count_goal',   value: kpiGoals.loanCountGoal },
        { key: 'pipeline_opps_goal', value: kpiGoals.pipelineOpps }
      ])
    });
  } catch (_) { /* silent */ }
  renderPerformance();
}

export async function saveOwnersList() {
  const el = document.getElementById('owners-list');
  const val = el ? el.value : '';
  const statusEl = document.getElementById('owners-save-status');
  if (statusEl) statusEl.textContent = 'Saving…';
  try {
    await sbFetch('kpi_settings?on_conflict=key', {
      method: 'POST',
      prefer: 'return=minimal,resolution=merge-duplicates',
      headers: { 'Prefer': 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify([{ key: 'owners_list', text_value: val }])
    });
    if (statusEl) { statusEl.textContent = '✓ Saved'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
  } catch (e) {
    if (statusEl) statusEl.textContent = '⚠ Error: ' + e.message;
  }
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

function calcLoanClosings(owner, start, end) {
  let count = 0, totalAmount = 0;
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
    count++;
    totalAmount += parseFloat(raw) || 0;
  }
  return { count, totalAmount };
}

function calcClosingGoal(months0) {
  const mults = [1, 1.25, 1.25 * 1.25, 1.25 * 1.25 * 1.25];
  return months0.reduce((sum, m) => sum + kpiGoals.loanCountGoal * mults[Math.floor(m / 3)], 0);
}

function calcLeadsCreated(owner, start, end) {
  const nOwner = norm(owner);
  const rows = [];
  const realtorSet = new Set();
  for (const row of (state.leadsData || [])) {
    const leadOwner = String(getField(row, 'Lead Owner', 'lead owner', 'Owner', 'owner') || '').trim();
    if (norm(leadOwner) !== nOwner) continue;
    const ref = String(getField(row, 'Referred By', 'referred by') || '').trim();
    if (!ref) continue;
    const refKey = norm(ref);
    const me = state.masterMap.get(refKey);
    if (!me || norm(me.owner || '') !== nOwner) continue;
    const cd = parseDate(getField(row, 'Created Date', 'created date', 'Create Date', 'create date'));
    if (!cd || cd < start || cd > end) continue;
    rows.push(row);
    realtorSet.add(refKey);
  }
  return { count: rows.length, uniqueRealtors: realtorSet.size, rows };
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

// H/F window: replicates calc.js assignment logic for a specific owner and window
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

function calcTeamAvgHF(cutoff, baseDate) {
  const owners = getAllowedOwners();
  const hVals = [], fVals = [];
  for (const o of owners) {
    const hf = calcHuntingFarmingForWindow(o, baseDate, cutoff);
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

function parseZoomTime(s) {
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  return null;
}

function fmtZoomDT(d) {
  if (!d) return '—';
  const h = d.getHours(), mi = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  return MS_SHORT[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' · ' + (h % 12 || 12) + ':' + mi + ' ' + ampm;
}

function calcCalls(ownerName, startDate, endDate) {
  const nOwner = norm(ownerName);
  const filtered = (state.callsData || []).filter(r => {
    if (norm(r.assigned_to || '') !== nOwner) return false;
    const d = parseDate(r.call_date);
    return d && d >= startDate && d <= endDate;
  });
  const totalCalls = filtered.length;
  const effectiveCalls = filtered.filter(r => r.effective === 1 || r.effective === 1.0).length;
  const effectivenessRate = totalCalls > 0 ? Math.round((effectiveCalls / totalCalls * 100) * 10) / 10 : 0;
  return { totalCalls, effectiveCalls, effectivenessRate };
}

function calcZoom(ownerName, startDate, endDate) {
  const nOwner = norm(ownerName);

  // Build the set of YYYY-MM month keys that fall within [startDate, endDate]
  const monthKeys = new Set();
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const last   = new Date(Date.UTC(endDate.getUTCFullYear(),   endDate.getUTCMonth(),   1));
  while (cursor <= last) {
    const mm = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    monthKeys.add(cursor.getUTCFullYear() + '-' + mm);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const meetingMap = new Map();
  for (const r of (state.zoomData || [])) {
    if (norm(r.host_name || '') !== nOwner) continue;
    if (!monthKeys.has(r.month_key)) continue;
    const d = parseZoomTime(r.start_time);
    const key = (r.meeting_id || '') + '|' + (r.month_key || '') + '|' + (r.start_time || '');
    if (!meetingMap.has(key)) meetingMap.set(key, { rows: [], startTime: d || null, rawTime: r.start_time, duration: r.duration_minutes });
    meetingMap.get(key).rows.push(r);
  }

  const meetingsWithGuest = [];
  for (const m of meetingMap.values()) {
    const guests = m.rows.filter(r => r.is_guest === 'Yes');
    if (guests.length) meetingsWithGuest.push({ ...m, guests });
  }

  const externalMap = new Map();
  for (const m of meetingsWithGuest) {
    for (const g of m.guests) {
      const nn = norm(g.participant_name || '');
      if (!nn) continue;
      if (!externalMap.has(nn)) externalMap.set(nn, { name: g.participant_name || '', email: g.participant_email || '', meetingDate: m.startTime });
    }
  }
  const externalsList = [...externalMap.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const meetingsDetail = meetingsWithGuest.map(m => ({
    startTime: m.startTime,
    duration: m.duration,
    meetingId: (m.rows[0] || {}).meeting_id || '',
    externals: [...new Map(m.guests.map(g => [norm(g.participant_name || ''), g.participant_name || ''])).values()].filter(Boolean),
    internalRows: m.rows.filter(r => r.is_guest !== 'Yes')
  })).sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  return { meetingsWithExternal: meetingsWithGuest.length, uniqueExternals: externalMap.size, externalsList, meetingsDetail };
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

function getMeetingLOs(internalRows) {
  const seen = new Set();
  const names = [];
  for (const r of (internalRows || [])) {
    const name = (r.participant_name || '').trim();
    if (!name || name.includes('(Host)')) continue;
    const canonical = state.loReferenceMap.get(norm(name));
    if (canonical && !seen.has(canonical)) { seen.add(canonical); names.push(canonical); }
  }
  return names.length ? names.join(', ') : '—';
}

function buildZoomMeetingsModal(meetingsDetail, owner, label) {
  // Build meeting_id → topic lookup from raw zoomData
  const topicMap = new Map();
  for (const r of (state.zoomData || [])) {
    if (r.meeting_id && !topicMap.has(r.meeting_id)) topicMap.set(r.meeting_id, (r.topic || '').trim() || null);
  }
  if (meetingsDetail.length && state.zoomData) {
    const meetingId = meetingsDetail[0].meetingId;
    const sampleRow = state.zoomData.find(r => r.meeting_id === meetingId);
    console.log('[MR] sample zoom row for topic:', JSON.stringify(sampleRow));
  }
  const head = '<tr><th>Meeting Topic</th><th>Date &amp; Time</th><th>Duration (min)</th><th>Loan Officer</th><th>External Participants</th></tr>';
  const body = meetingsDetail.map(m => {
    const topic = topicMap.get(m.meetingId) || '—';
    const loStr = getMeetingLOs(m.internalRows);
    return '<tr>' +
      '<td style="font-size:11px;font-weight:600;color:var(--hs-navy);max-width:180px">' + topic + '</td>' +
      '<td class="dt">' + fmtZoomDT(m.startTime) + '</td>' +
      '<td style="text-align:center">' + (m.duration || '—') + '</td>' +
      '<td style="font-size:11px;font-weight:600;color:var(--hs-navy)">' + loStr + '</td>' +
      '<td style="font-size:11px">' + m.externals.join(', ') + '</td>' +
      '</tr>';
  }).join('');
  return {
    title: owner + ' — Meetings with External',
    sub: label + ' · ' + meetingsDetail.length + ' meeting' + (meetingsDetail.length !== 1 ? 's' : ''),
    head, body,
    csvData: [
      ['Meeting Topic', 'Date & Time', 'Duration (min)', 'Loan Officer', 'External Participants'],
      ...meetingsDetail.map(m => [topicMap.get(m.meetingId) || '—', fmtZoomDT(m.startTime), m.duration || '', getMeetingLOs(m.internalRows), m.externals.join('; ')])
    ]
  };
}

function buildZoomExternalsModal(externalsList, owner, label) {
  const head = '<tr><th>Name</th><th>Email</th><th>Meeting Date</th></tr>';
  const body = externalsList.map(e => {
    return '<tr>' +
      '<td style="font-weight:600">' + (e.name || '—') + '</td>' +
      '<td style="font-size:11px;color:#667799">' + (e.email || '—') + '</td>' +
      '<td class="dt">' + fmtZoomDT(e.meetingDate) + '</td>' +
      '</tr>';
  }).join('');
  return {
    title: owner + ' — Unique External Contacts',
    sub: label + ' · ' + externalsList.length + ' contact' + (externalsList.length !== 1 ? 's' : ''),
    head, body,
    csvData: [
      ['Name', 'Email', 'Meeting Date'],
      ...externalsList.map(e => [e.name || '', e.email || '', fmtZoomDT(e.meetingDate)])
    ]
  };
}

function buildLeadsModal(rows, owner, label) {
  const enriched = rows.map(row => ({
    realtor:     String(getField(row, 'Referred By', 'referred by') || '—').trim(),
    leadOwner:   String(getField(row, 'Lead Owner', 'lead owner', 'Owner', 'owner') || '—').trim(),
    createdDate: parseDate(getField(row, 'Created Date', 'created date', 'Create Date', 'create date')),
    status:      String(getField(row, 'Lead Status', 'lead status') || '—').trim(),
    converted:   getField(row, 'Converted', 'converted')
  })).sort((a, b) => (a.createdDate || 0) - (b.createdDate || 0));
  const head = '<tr><th>Realtor</th><th>Lead Owner</th><th>Created Date</th><th>Lead Status</th><th>Converted</th></tr>';
  const body = enriched.map(e =>
    '<tr>' +
    '<td style="font-weight:600">' + e.realtor + '</td>' +
    '<td style="font-size:11px">' + e.leadOwner + '</td>' +
    '<td class="dt">' + fmtDate(e.createdDate) + '</td>' +
    '<td style="font-size:11px">' + e.status + '</td>' +
    '<td style="text-align:center">' + (e.converted ? '<span style="color:#085041;font-weight:700">Yes</span>' : '<span style="color:#8899BB">No</span>') + '</td>' +
    '</tr>'
  ).join('');
  return {
    title: owner + ' — Leads Created',
    sub: label + ' · ' + enriched.length + ' lead' + (enriched.length !== 1 ? 's' : ''),
    head, body,
    csvData: [
      ['Realtor', 'Lead Owner', 'Created Date', 'Lead Status', 'Converted'],
      ...enriched.map(e => [e.realtor, e.leadOwner, fmtDate(e.createdDate), e.status, e.converted ? 'Yes' : 'No'])
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

  const windowDays = parseInt((document.getElementById('window-days') || {}).value) || 60;

  // Main H/F window derived from Performance period selection
  const mainSorted = [...months0].sort((a, b) => a - b);
  const mainLastM  = mainSorted[mainSorted.length - 1];
  const isMainCurrent = year === today.getUTCFullYear() && months0.includes(today.getUTCMonth());
  const mainHFCutoff = isMainCurrent
    ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999))
    : new Date(Date.UTC(year, mainLastM + 1, 0, 23, 59, 59, 999));
  const mainHFBase = new Date(mainHFCutoff);
  mainHFBase.setUTCDate(mainHFBase.getUTCDate() - windowDays);

  const mainClosings = calcLoanClosings(owner, start, end);
  const mainPipe     = calcPipelineActivity(owner, start, end);
  const mainHF       = calcHuntingFarmingForWindow(owner, mainHFBase, mainHFCutoff);
  const teamAvg      = calcTeamAvgHF(mainHFCutoff, mainHFBase);
  const mainCalls    = calcCalls(owner, start, end);
  const mainZoom     = calcZoom(owner, start, end);
  const mainLeads    = calcLeadsCreated(owner, start, end);

  const cmpClosings = hasCmp ? calcLoanClosings(owner, cmpBounds.start, cmpBounds.end) : null;
  const cmpPipe     = hasCmp ? calcPipelineActivity(owner, cmpBounds.start, cmpBounds.end) : null;
  const cmpCalls    = hasCmp ? calcCalls(owner, cmpBounds.start, cmpBounds.end) : null;
  const cmpZoom     = hasCmp ? calcZoom(owner, cmpBounds.start, cmpBounds.end) : null;
  const cmpLeads    = hasCmp ? calcLeadsCreated(owner, cmpBounds.start, cmpBounds.end) : null;

  // Comparison H/F window: fully-past month uses last day; current month uses same day as main cutoff
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
    cmpHF = calcHuntingFarmingForWindow(owner, cmpHFBase, cmpHFCutoff);
    cmpHFLbl = ('VS ' + MS_SHORT[lastCmpM] + ' ' + cmpYear + ' · ' + fmtShortDate(cmpHFBase) + ' → ' + fmtShortDate(cmpHFCutoff)).toUpperCase();
  }

  const closingGoal    = calcClosingGoal(months0);
  const closingGoalStr = closingGoal % 1 === 0 ? String(closingGoal) : closingGoal.toFixed(2);
  const closingPct     = closingGoal > 0 ? Math.round((mainClosings.count / closingGoal) * 100) : 0;
  const closingCol     = closingPct >= 100 ? '#085041' : closingPct >= 70 ? '#D4A000' : '#CC3030';
  const oppsGoal       = kpiGoals.pipelineOpps;
  const oppsPct        = oppsGoal > 0 ? Math.round((mainPipe.created / oppsGoal) * 100) : 0;
  const oppsCol        = oppsPct >= 100 ? '#085041' : oppsPct >= 70 ? '#D4A000' : '#CC3030';
  const cmpClosingPct  = hasCmp && closingGoal > 0 ? Math.round((cmpClosings.count / closingGoal) * 100) : null;
  const cmpOppsPct     = hasCmp && oppsGoal > 0 ? Math.round((cmpPipe.created / oppsGoal) * 100) : null;

  const total = mainHF.total || 1;
  const hPct = Math.round((mainHF.hunting / total) * 100);
  const fPct = Math.round((mainHF.farming / total) * 100);

  const mainLbl = pLabel(year, months0, today, false);
  const cmpLbl  = hasCmp ? pLabel(cmpYear, cmpMonths0, today, true) : '';

  // Populate modal cache
  _perfModalCache.clear();
  _perfModalCache.set('mainLoan',          buildLoanModal(owner, start, end, mainLbl));
  _perfModalCache.set('mainPipe',          buildPipelineModal(owner, start, end, mainLbl));
  _perfModalCache.set('mainHunting',       buildHFModal(true,  mainHF.huntingRealtors, owner, mainLbl));
  _perfModalCache.set('mainFarming',       buildHFModal(false, mainHF.farmingRealtors, owner, mainLbl));
  _perfModalCache.set('mainZoomMeetings',  buildZoomMeetingsModal(mainZoom.meetingsDetail, owner, mainLbl));
  _perfModalCache.set('mainZoomExternals', buildZoomExternalsModal(mainZoom.externalsList, owner, mainLbl));
  _perfModalCache.set('mainLeads',         buildLeadsModal(mainLeads.rows, owner, mainLbl));
  if (hasCmp) {
    _perfModalCache.set('cmpLoan',          buildLoanModal(owner, cmpBounds.start, cmpBounds.end, cmpLbl));
    _perfModalCache.set('cmpPipe',          buildPipelineModal(owner, cmpBounds.start, cmpBounds.end, cmpLbl));
    _perfModalCache.set('cmpZoomMeetings',  buildZoomMeetingsModal(cmpZoom.meetingsDetail, owner, cmpLbl));
    _perfModalCache.set('cmpZoomExternals', buildZoomExternalsModal(cmpZoom.externalsList, owner, cmpLbl));
    _perfModalCache.set('cmpLeads',         buildLeadsModal(cmpLeads.rows, owner, cmpLbl));
    if (cmpHF) {
      _perfModalCache.set('cmpHunting', buildHFModal(true,  cmpHF.huntingRealtors, owner, cmpLbl));
      _perfModalCache.set('cmpFarming', buildHFModal(false, cmpHF.farmingRealtors, owner, cmpLbl));
    }
  }

  const callsRateColor = mainCalls.effectivenessRate > 20 ? 'green' : mainCalls.effectivenessRate >= 10 ? 'yellow' : 'red';
  const cmpCallsRateColor = cmpCalls ? (cmpCalls.effectivenessRate > 20 ? 'green' : cmpCalls.effectivenessRate >= 10 ? 'yellow' : 'red') : 'red';

  content.innerHTML =
    '<div class="perf-owner-heading">' + owner + '</div>' +

    '<div class="perf-banner">' +
      '<span class="perf-banner-main">' + mainLbl + '</span>' +
      (hasCmp ? '<span class="perf-banner-vs">vs</span><span class="perf-banner-cmp">' + cmpLbl + '</span>' : '') +
    '</div>' +

    '<div class="perf-kpi-grid">' +

    // ── Card 1: B2C Goal Performance ──
    '<div class="perf-kpi-card">' +
      '<div class="perf-card-tag">B2C GOAL PERFORMANCE</div>' +
      '<div class="perf-main-section">' +
        '<div class="perf-two-col">' +
          '<div class="perf-col">' +
            '<div class="perf-col-label">CLOSINGS</div>' +
            '<button class="perf-clickable-val" data-perf-modal="mainLoan">' + mainClosings.count + '</button>' +
            '<div class="perf-card-exact">Volume: ' + fmtMoney(mainClosings.totalAmount) + '</div>' +
          '</div>' +
          '<div class="perf-col perf-col-secondary">' +
            '<div class="perf-col-label">GOAL</div>' +
            '<div class="perf-col-goal-val">' + closingGoalStr + '</div>' +
          '</div>' +
        '</div>' +
        goalBar(closingPct) +
        '<div class="perf-pct-row">' +
          '<span class="perf-big-pct" style="color:' + closingCol + '">' + closingPct + '%<span class="perf-pct-of"> of goal</span></span>' +
          goalChip(closingPct) +
        '</div>' +
      '</div>' +
      (hasCmp
        ? '<div class="perf-cmp-section">' +
            '<div class="perf-cmp-vs-hdr">VS ' + cmpLbl.toUpperCase() + '</div>' +
            '<div class="perf-two-col">' +
              '<div class="perf-col">' +
                '<div class="perf-col-label">CLOSINGS</div>' +
                '<button class="perf-cmp-big-val perf-cmp-clickable" data-perf-modal="cmpLoan">' + cmpClosings.count + '</button>' +
                '<div class="perf-cmp-metric-sub">Vol: ' + fmtMoney(cmpClosings.totalAmount) + '</div>' +
              '</div>' +
              '<div class="perf-col perf-col-secondary">' +
                '<div class="perf-col-label">GOAL %</div>' +
                '<div class="perf-cmp-pct-val">' + (cmpClosingPct !== null ? cmpClosingPct + '% of goal' : '—') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="perf-change-row">' +
              '<span class="perf-change-lbl">CHANGE</span>' +
              dChipInt(mainClosings.count, cmpClosings.count) +
            '</div>' +
          '</div>'
        : '') +
    '</div>' +

    // ── Card 2: Calls ──
    '<div class="perf-kpi-card">' +
      '<div class="perf-card-tag">CALLS</div>' +
      '<div class="perf-main-section">' +
        '<div class="perf-two-col">' +
          '<div class="perf-col">' +
            '<div class="perf-col-label">TOTAL CALLS</div>' +
            '<div class="perf-act-big">' + mainCalls.totalCalls + '</div>' +
            '<div class="perf-card-exact">Effective: ' + mainCalls.effectiveCalls + '</div>' +
          '</div>' +
          '<div class="perf-col perf-col-secondary">' +
            '<div class="perf-col-label">RATE</div>' +
            '<div class="perf-rate-chip perf-rate-' + callsRateColor + '" style="font-size:18px;padding:4px 10px">' + mainCalls.effectivenessRate + '%</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      (hasCmp
        ? '<div class="perf-cmp-section">' +
            '<div class="perf-cmp-vs-hdr">VS ' + cmpLbl.toUpperCase() + '</div>' +
            '<div class="perf-two-col">' +
              '<div class="perf-col">' +
                '<div class="perf-col-label">TOTAL CALLS</div>' +
                '<div class="perf-cmp-big-val">' + cmpCalls.totalCalls + '</div>' +
                '<div class="perf-cmp-metric-sub">Effective: ' + cmpCalls.effectiveCalls + '</div>' +
              '</div>' +
              '<div class="perf-col perf-col-secondary">' +
                '<div class="perf-col-label">RATE</div>' +
                '<div class="perf-rate-chip perf-rate-' + cmpCallsRateColor + '" style="font-size:13px">' + cmpCalls.effectivenessRate + '%</div>' +
              '</div>' +
            '</div>' +
            '<div class="perf-change-row">' +
              '<span class="perf-change-lbl">CHANGE</span>' +
              dChipInt(mainCalls.totalCalls, cmpCalls.totalCalls) +
            '</div>' +
          '</div>'
        : '') +
    '</div>' +

    // ── Card 3: Meetings ──
    '<div class="perf-kpi-card">' +
      '<div class="perf-card-tag">MEETINGS</div>' +
      '<div class="perf-main-section">' +
        '<div class="perf-two-col">' +
          '<div class="perf-col">' +
            '<div class="perf-col-label">WITH EXTERNAL</div>' +
            '<button class="perf-clickable-val" data-perf-modal="mainZoomMeetings">' + mainZoom.meetingsWithExternal + '</button>' +
            '<div class="perf-card-exact">Unique realtors: <button class="perf-cmp-clickable" style="font-size:11px;font-weight:700;color:#334466;background:none;border:none;cursor:pointer;padding:0" data-perf-modal="mainZoomExternals">' + mainZoom.uniqueExternals + '</button></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      (hasCmp
        ? '<div class="perf-cmp-section">' +
            '<div class="perf-cmp-vs-hdr">VS ' + cmpLbl.toUpperCase() + '</div>' +
            '<div class="perf-two-col">' +
              '<div class="perf-col">' +
                '<div class="perf-col-label">WITH EXTERNAL</div>' +
                '<button class="perf-cmp-big-val perf-cmp-clickable" data-perf-modal="cmpZoomMeetings">' + cmpZoom.meetingsWithExternal + '</button>' +
                '<div class="perf-cmp-metric-sub">Unique: <button class="perf-cmp-clickable" style="font-size:10px;color:#667799;background:none;border:none;cursor:pointer;padding:0" data-perf-modal="cmpZoomExternals">' + cmpZoom.uniqueExternals + '</button></div>' +
              '</div>' +
            '</div>' +
            '<div class="perf-change-row">' +
              '<span class="perf-change-lbl">CHANGE</span>' +
              dChipInt(mainZoom.meetingsWithExternal, cmpZoom.meetingsWithExternal) +
            '</div>' +
          '</div>'
        : '') +
    '</div>' +

    // ── Card 4: B2B Behavior ──
    '<div class="perf-kpi-card">' +
      '<div class="perf-card-tag">B2B BEHAVIOR &mdash; HUNTING / FARMING</div>' +
      '<div class="perf-main-section">' +
        '<div class="perf-hf-row">' +
          '<div class="perf-hf-block">' +
            '<div class="perf-col-label" style="color:#A32D2D">HUNTING</div>' +
            '<button class="perf-clickable-val" style="color:#A32D2D" data-perf-modal="mainHunting">' + mainHF.hunting + '</button>' +
            '<div class="perf-card-exact">' + hPct + '% of active</div>' +
            hfChip(mainHF.hunting, teamAvg.avgH) +
          '</div>' +
          '<div class="perf-hf-divider"></div>' +
          '<div class="perf-hf-block">' +
            '<div class="perf-col-label" style="color:#085041">FARMING</div>' +
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
          '<span class="perf-hf-avg-note">' + fmtShortDate(mainHFBase) + ' → ' + fmtShortDate(mainHFCutoff) + '</span>' +
        '</div>' +
      '</div>' +
      (hasCmp && cmpHF
        ? '<div class="perf-cmp-section">' +
            '<div class="perf-cmp-vs-hdr">' + cmpHFLbl + '</div>' +
            '<div class="perf-cmp-hf-row">' +
              '<div class="perf-cmp-hf-col">' +
                '<div class="perf-col-label" style="color:#A32D2D">HUNTING</div>' +
                '<button class="perf-cmp-big-val perf-cmp-clickable" style="color:#A32D2D" data-perf-modal="cmpHunting">' + cmpHF.hunting + '</button>' +
                dChipInt(mainHF.hunting, cmpHF.hunting) +
              '</div>' +
              '<div class="perf-cmp-hf-col">' +
                '<div class="perf-col-label" style="color:#085041">FARMING</div>' +
                '<button class="perf-cmp-big-val perf-cmp-clickable" style="color:#085041" data-perf-modal="cmpFarming">' + cmpHF.farming + '</button>' +
                dChipInt(mainHF.farming, cmpHF.farming) +
              '</div>' +
            '</div>' +
          '</div>'
        : '') +
    '</div>' +

    // ── Card 5: Leads Created ──
    '<div class="perf-kpi-card">' +
      '<div class="perf-card-tag">LEADS CREATED</div>' +
      '<div class="perf-main-section">' +
        '<div class="perf-two-col">' +
          '<div class="perf-col">' +
            '<div class="perf-col-label">LEADS</div>' +
            '<button class="perf-clickable-val" data-perf-modal="mainLeads">' + mainLeads.count + '</button>' +
            '<div class="perf-card-exact">From ' + mainLeads.uniqueRealtors + ' unique realtor' + (mainLeads.uniqueRealtors !== 1 ? 's' : '') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      (hasCmp
        ? '<div class="perf-cmp-section">' +
            '<div class="perf-cmp-vs-hdr">VS ' + cmpLbl.toUpperCase() + '</div>' +
            '<div class="perf-two-col">' +
              '<div class="perf-col">' +
                '<div class="perf-col-label">LEADS</div>' +
                '<button class="perf-cmp-big-val perf-cmp-clickable" data-perf-modal="cmpLeads">' + cmpLeads.count + '</button>' +
                '<div class="perf-cmp-metric-sub">From ' + cmpLeads.uniqueRealtors + ' realtor' + (cmpLeads.uniqueRealtors !== 1 ? 's' : '') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="perf-change-row">' +
              '<span class="perf-change-lbl">CHANGE</span>' +
              dChipInt(mainLeads.count, cmpLeads.count) +
            '</div>' +
          '</div>'
        : '') +
    '</div>' +

    // ── Card 6: Opportunities Created ──
    '<div class="perf-kpi-card">' +
      '<div class="perf-card-tag">OPPORTUNITIES CREATED</div>' +
      '<div class="perf-main-section">' +
        '<div class="perf-two-col">' +
          '<div class="perf-col">' +
            '<div class="perf-col-label">OPP. CREATED</div>' +
            '<button class="perf-clickable-val" data-perf-modal="mainPipe">' + mainPipe.created + '</button>' +
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
                '<button class="perf-cmp-big-val perf-cmp-clickable" data-perf-modal="cmpPipe">' + cmpPipe.created + '</button>' +
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
