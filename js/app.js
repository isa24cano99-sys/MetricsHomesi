import { state } from './state.js';
import { bus } from './events.js';
import { sbFetch, uploadToSupabase, uploadCalls, uploadLoReference, uploadZoomMeetings, loadCallsData, loadZoomData } from './supabase.js';
import { runCalc } from './calc.js';
import { setMode, renderTable, populateFilters, renderSummary, srt, onModeSelect, showTab } from './ui.js';
import { renderScorecard, refreshScorecard, clearScorecardFilters, renderRankings } from './scorecard.js';
import { renderAssignCards, clearAssignFilters, confirmAssign, unconfirm, updateAssign, saveAllAssignments, showAssignView, renderUnassigned, saveUnassigned, loadSfReference, applyUaSuggestion } from './assignments.js';
import { renderLog } from './log.js';
import { exportCSV, exportMasterCSV, exportLog, dl } from './export.js';
import { showScorecardDetail, showLeadDetail, showOppDetail, showAllLeadsForRealtor, showConvertedLeadsDetail, openModal, closeModal } from './modal.js';
import { initPipeline, renderPipeline, renderClosedWon, clearPipelineFilters, clearClosedWonFilters, showPipelineStageDetail, downloadCwOwnerCsv } from './pipeline.js';
import { initTrends, renderTrends } from './trends.js';
import { initPerformance, renderPerformance, loadKpiSettings, saveKpiSettings, saveOwnersList } from './performance.js';
// LO Metrics modules
import { runLoCalc } from './lo-calc.js';
import { setLoMode, renderLoTable, populateLoFilters, renderLoSummary, srtLo, onLoModeSelect, showLoTab } from './lo-ui.js';
import { renderLoScorecard, refreshLoScorecard, clearLoScorecardFilters } from './lo-scorecard.js';
import { renderLoAssignCards, clearLoAssignFilters, confirmLoAssign, unconfirmLo, updateLoAssign, saveAllLoAssignments, showLoAssignView, renderLoUnassigned, saveLoUnassigned } from './lo-assignments.js';
import { initLoPipeline, renderLoPipeline, renderLoCwSection, clearLoPipelineFilters, clearLoCwFilters } from './lo-pipeline.js';
import { initLoTrends, renderLoTrends } from './lo-trends.js';
import { initLoPerformance, renderLoPerformance } from './lo-performance.js';

// card-id suffix for each file type (used for progress bars and status labels)
const TYPE_TO_CARD = {
  leads: 'leads',
  opp: 'opp',
  calls: 'calls',
  lo_reference: 'loref',
  zoom: 'zoom'
};

function setStatus(t, msg) {
  const bar = document.getElementById('status-bar');
  bar.className = 'status-bar ' + (t === 'ok' ? 'sb-ok' : t === 'err' ? 'sb-err' : t === 'warn' ? 'sb-warn' : 'sb-load');
  document.getElementById('status-text').textContent = msg;
}

function setProgress(cardId, pct) {
  const pf = document.getElementById('pf-' + cardId);
  if (pf) pf.style.width = pct + '%';
  if (pct >= 100) setTimeout(() => {
    const pb = document.getElementById('pb-' + cardId);
    if (pb) pb.classList.add('hidden');
  }, 800);
}

bus.on('status', ({ type, msg }) => setStatus(type, msg));

bus.on('calc:complete', ({ windowDays, cutoff, floorDate, inactFloor, allowedOwners }) => {
  populateFilters(allowedOwners);
  renderSummary(windowDays, null, null, cutoff, floorDate, inactFloor);
  setMode(state.currentMode);
  renderScorecard(allowedOwners);
  renderAssignCards();
  renderLog();
  initPipeline();
  initTrends();
  initPerformance();
  document.getElementById('results').classList.remove('hidden');
});

bus.on('lo-calc:complete', ({ windowDays, cutoff, floorDate, inactFloor, allowedOwners }) => {
  populateLoFilters(allowedOwners);
  renderLoSummary(windowDays, state.loActiveResults, state.loInactiveResults, cutoff, floorDate, inactFloor);
  setLoMode(state.loCurrentMode);
  renderLoScorecard(allowedOwners);
  renderLoAssignCards();
  initLoPipeline();
  initLoTrends();
  initLoPerformance();
  document.getElementById('lo-results').classList.remove('hidden');
});

function handleFile(e, type) {
  const file = e.target.files[0]; if (!file) return;
  const cardId = TYPE_TO_CARD[type];
  const uz = document.getElementById('uz-' + cardId);
  if (uz) uz.classList.add('uploading');
  const pb = document.getElementById('pb-' + cardId);
  if (pb) pb.classList.remove('hidden');

  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'binary', cellDates: false });
      let data;

      if (type === 'leads') {
        const sn = wb.SheetNames.find(n => /lead|refer/i.test(n)) || wb.SheetNames[0];
        data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null });
        state.leadsData = data;
      } else if (type === 'opp') {
        const sn = wb.SheetNames.find(n => /opp/i.test(n)) || wb.SheetNames[1] || wb.SheetNames[0];
        data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null });
        state.oppData = data;
      } else if (type === 'calls') {
        const sn = wb.SheetNames[0];
        data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null });
      } else if (type === 'lo_reference') {
        const sn = wb.SheetNames[0];
        data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null });
      } else if (type === 'zoom') {
        const sn = wb.SheetNames[0];
        data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null });
      }

      setProgress(cardId, 15);

      if (state.dbConnected) {
        if (type === 'leads' || type === 'opp') {
          await uploadToSupabase(type, data, file.name, {
            onProgress: (t, pct) => setProgress(cardId, pct),
            onStatus: setStatus
          });
        } else if (type === 'calls') {
          await uploadCalls(data, file.name, {
            onProgress: (t, pct) => setProgress(cardId, pct),
            onStatus: setStatus
          });
        } else if (type === 'lo_reference') {
          await uploadLoReference(data, file.name, {
            onProgress: (t, pct) => setProgress(cardId, pct),
            onStatus: setStatus
          });
          await loadLoReferenceMap();
        } else if (type === 'zoom') {
          const year = document.getElementById('zoom-upload-year').value;
          const month = document.getElementById('zoom-upload-month').value;
          const monthKey = year + '-' + month;
          await uploadZoomMeetings(data, monthKey, file.name, {
            onProgress: (t, pct) => setProgress(cardId, pct),
            onStatus: setStatus
          });
        }
      }

      setProgress(cardId, 100);
      if (uz) { uz.classList.remove('uploading'); uz.classList.add('ok'); }
      const lbl = document.getElementById('uz-' + cardId + '-lbl');
      if (lbl) lbl.textContent = '✓ ' + file.name + ' (' + (data ? data.length : 0) + ' rows)';
      const saved = document.getElementById('uz-' + cardId + '-saved');
      if (saved) {
        saved.textContent = '💾 Saved ' + new Date().toLocaleDateString('es-CO');
        saved.classList.remove('hidden');
      }
      if (state.leadsData || state.oppData) document.getElementById('run-btn').disabled = false;
      setStatus('ok', '✅ ' + file.name + ' saved to Supabase (' + (data ? data.length : 0) + ' rows)');
    } catch (err) {
      if (uz) uz.classList.remove('uploading');
      setStatus('err', '❌ Error: ' + err.message);
    }
  };
  reader.readAsBinaryString(file);
}

function openSettings() {
  document.getElementById('settings-panel').classList.add('open');
  document.getElementById('settings-overlay').classList.add('open');
}

function closeSettings() {
  document.getElementById('settings-panel').classList.remove('open');
  document.getElementById('settings-overlay').classList.remove('open');
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const wrap = document.getElementById('app-wrap');
  sidebar.classList.toggle('collapsed');
  wrap.classList.toggle('sidebar-collapsed');
  localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed') ? '1' : '0');
}

function showView(viewId) {
  ['view-bd-metrics', 'view-data-upload', 'view-lo-metrics'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', id !== 'view-' + viewId);
  });
  document.querySelectorAll('.sidebar-item[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
  });
}

async function loadLoReferenceMap() {
  try {
    const rows = await sbFetch('lo_reference?select=alias,canonical_name');
    state.loReferenceMap = new Map();
    for (const r of (rows || [])) {
      if (r.alias && r.canonical_name) state.loReferenceMap.set(r.alias, r.canonical_name);
    }
  } catch (_) {}
}

async function loadLoMasterMap() {
  try {
    const rows = await sbFetch('lo_master_assignments?select=*');
    for (const m of (rows || [])) {
      if (m.source === 'manual') {
        state.loMasterMap.set(m.realtor_key, {
          name: m.realtor_name, loan_officer: m.loan_officer, branch: m.branch,
          source: m.source, updatedAt: m.updated_at,
          confirmed: m.confirmed === true || m.confirmed === 'true'
        });
      }
    }
  } catch (_) {}
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-rkey]');
  if (!el) return;
  const key = decodeURIComponent(el.getAttribute('data-rkey') || '');
  const dtype = el.getAttribute('data-dtype') || '';
  if (!key || !dtype) return;
  const allR = state.activeResults.concat(state.inactiveResults)
    .concat(state.loActiveResults).concat(state.loInactiveResults);
  const r = allR.find(x => x.key === key);
  if (!r) return;
  if (dtype === 'leads') showLeadDetail(key, r.name);
  else if (dtype === 'converted') showConvertedLeadsDetail(key, r.name);
  else showOppDetail(key, r.name, dtype);
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-owner][data-med]');
  if (!el) return;
  showScorecardDetail(el.getAttribute('data-owner'), el.getAttribute('data-med'));
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-pl-owner][data-pl-stage]');
  if (!el) return;
  showPipelineStageDetail(el.getAttribute('data-pl-owner'), el.getAttribute('data-pl-stage'));
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-cw-owner]');
  if (!el) return;
  downloadCwOwnerCsv(el.getAttribute('data-cw-owner'));
});

async function initApp() {
  setStatus('load', '⏳ Connecting to Supabase...');

  // Restore sidebar state from localStorage
  if (localStorage.getItem('sidebarCollapsed') === '1') {
    document.getElementById('sidebar').classList.add('collapsed');
    document.getElementById('app-wrap').classList.add('sidebar-collapsed');
  }

  // Populate zoom year selector
  const zoomYearSel = document.getElementById('zoom-upload-year');
  if (zoomYearSel) {
    const curYear = new Date().getFullYear();
    for (let y = curYear; y >= curYear - 3; y--) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      zoomYearSel.appendChild(opt);
    }
    // Default zoom month to current month
    const curMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    const zoomMonthSel = document.getElementById('zoom-upload-month');
    if (zoomMonthSel) {
      Array.from(zoomMonthSel.options).forEach(o => { o.selected = o.value === curMonth; });
    }
  }

  try {
    const meta = await sbFetch('upload_meta?select=file_type,file_name,row_count,uploaded_at');
    state.dbConnected = true;

    // map file_type → card id suffix
    const typeToCard = {
      leads: 'leads', opp: 'opp', calls: 'calls',
      lo_reference: 'loref', zoom_meetings: 'zoom'
    };
    let hasData = false;

    for (const m of (meta || [])) {
      const type = m.file_type;
      if (type === 'realtor_map') {
        const statusEl = document.getElementById('sf-ref-status');
        if (statusEl) statusEl.innerHTML =
          '<span style="color:#1A9E5A;font-weight:700">Uploaded ✓</span>' +
          ' &nbsp;' + m.file_name + ' &nbsp;·&nbsp; ' + m.row_count + ' rows &nbsp;·&nbsp; ' +
          new Date(m.uploaded_at).toLocaleDateString('es-CO');
        continue;
      }
      const cardId = typeToCard[type];
      if (!cardId) continue;
      const uzEl = document.getElementById('uz-' + cardId);
      if (uzEl) uzEl.classList.add('ok');
      const lblEl = document.getElementById('uz-' + cardId + '-lbl');
      if (lblEl) lblEl.textContent = '✓ ' + m.file_name + ' (' + m.row_count + ' rows)';
      const savedEl = document.getElementById('uz-' + cardId + '-saved');
      if (savedEl) {
        savedEl.textContent = '💾 Saved ' + new Date(m.uploaded_at).toLocaleDateString('es-CO');
        savedEl.classList.remove('hidden');
      }
      if (type === 'leads' || type === 'opp') hasData = true;
    }

    const master = await sbFetch('master_assignments?select=*');
    for (const m of (master || [])) {
      if (m.source === 'manual') {
        state.masterMap.set(m.realtor_key, { name: m.realtor_name, owner: m.owner, branch: m.branch, source: m.source, updatedAt: m.updated_at, confirmed: m.confirmed === true || m.confirmed === 'true' });
      }
    }

    const logs = await sbFetch('change_log?select=*&order=created_at.desc&limit=200');
    state.changeLog = (logs || []).map(l => ({ date: l.change_date, realtor: l.realtor, from: l.from_assignment, to: l.to_assignment }));

    try {
      const romRows = await sbFetch('realtor_owner_map?select=realtor_key,owner');
      for (const r of (romRows || [])) {
        if (r.realtor_key && r.owner) state.realtorOwnerMap.set(r.realtor_key, r.owner);
      }
    } catch (_) {}

    await loadLoReferenceMap();
    await loadLoMasterMap();
    await loadKpiSettings();
    try { await loadCallsData(); } catch (_) {}
    try { await loadZoomData(); } catch (_) {}

    if (hasData) {
      setStatus('ok', '✅ Supabase connected — saved data available. Press Calculate to view results.');
      document.getElementById('run-btn').disabled = false;
    } else {
      setStatus('ok', '✅ Supabase connected — upload your files to get started.');
    }
  } catch (e) {
    setStatus('err', '❌ Error: ' + e.message);
  }
}

// Expose functions needed by inline HTML onclick handlers
Object.assign(window, {
  runCalc, openSettings, closeSettings, onModeSelect, renderTable, showTab, srt,
  clearScorecardFilters, refreshScorecard, renderRankings,
  renderAssignCards, saveAllAssignments, clearAssignFilters, confirmAssign, unconfirm, updateAssign,
  showAssignView, renderUnassigned, saveUnassigned, loadSfReference, applyUaSuggestion,
  exportCSV, exportMasterCSV, exportLog, dl,
  closeModal, showAllLeadsForRealtor,
  handleFile,
  renderPipeline, renderClosedWon, clearPipelineFilters, clearClosedWonFilters, showPipelineStageDetail, renderTrends,
  renderPerformance, saveKpiSettings, saveOwnersList,
  toggleSidebar, showView,
  // LO Metrics
  runLoCalc, renderLoTable, setLoMode, showLoTab, srtLo, onLoModeSelect,
  renderLoScorecard, refreshLoScorecard, clearLoScorecardFilters,
  renderLoAssignCards, saveAllLoAssignments, clearLoAssignFilters,
  confirmLoAssign, unconfirmLo, updateLoAssign, showLoAssignView, renderLoUnassigned, saveLoUnassigned,
  renderLoPipeline, renderLoCwSection, clearLoPipelineFilters, clearLoCwFilters,
  renderLoTrends, renderLoPerformance,
  exportLoCsv: () => {
    const { exportCsvRaw } = dl ? { exportCsvRaw: dl } : {};
    const results = state.loCurrentMode === 'active' ? state.loActiveResults : state.loInactiveResults;
    const rows = [
      ['Realtor', 'Branch', 'LO', 'Rating', 'Period Leads', 'Converted', 'Closed Won', 'Pre-Approval', 'Ratified'],
      ...results.map(r => [r.name, r.assignedBranch || '', r.assignedOwner || '', r.med, r.cnt, r.convertedCount || 0, r.cw || 0, r.pa || 0, r.rat || 0])
    ];
    const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'lo-metrics.csv'; a.click();
    URL.revokeObjectURL(url);
  }
});

// Set default date values and start app
const today = new Date();
const todayStr = today.toISOString().split('T')[0];
const infDate = new Date(today); infDate.setFullYear(infDate.getFullYear() - 1);
const infStr = infDate.toISOString().split('T')[0];

document.getElementById('cutoff-date').value = todayStr;
document.getElementById('inactive-from').value = infStr;
document.getElementById('lo-cutoff-date').value = todayStr;
document.getElementById('lo-inactive-from').value = infStr;

initApp();
