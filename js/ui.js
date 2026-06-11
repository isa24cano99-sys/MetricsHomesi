function onModeSelect(val) {
  const isActive = val === 'active';
  const cfgActive = document.getElementById('cfg-active-window');
  const cfgInact = document.getElementById('cfg-inactive-from');
  if (cfgActive) { cfgActive.style.opacity = isActive ? '1' : '0.4'; cfgActive.style.pointerEvents = isActive ? 'auto' : 'none'; }
  if (cfgInact) { cfgInact.style.opacity = isActive ? '0.4' : '1'; cfgInact.style.pointerEvents = isActive ? 'none' : 'auto'; }
  if (activeResults.length > 0 || inactiveResults.length > 0) setMode(val);
}

function setMode(mode) {
  currentMode = mode;
  document.getElementById('filter-med').innerHTML = '<option value="">All Ratings</option>' +
    [...new Set(mode === 'active' ? activeResults.map(r => r.med) : ['Inactive'])].sort().map(m => '<option value="' + m + '">' + m + '</option>').join('');
  renderTable();
}

function populateFilters(owners) {
  document.getElementById('filter-own').innerHTML = '<option value="">All Owners</option>' + owners.map(o => '<option value="' + o + '">' + o + '</option>').join('');
  const branches = [...new Set([...activeResults, ...inactiveResults].map(r => r.assignedBranch).filter(Boolean))].sort();
  document.getElementById('filter-branch').innerHTML = '<option value="">All Branches</option>' + branches.map(b => '<option value="' + b + '">' + b + '</option>').join('');
  document.getElementById('assign-filter-owner').innerHTML = owners.map(o => '<option value="' + o + '">' + o + '</option>').join('');
  document.getElementById('assign-filter-branch').innerHTML = branches.map(b => '<option value="' + b + '">' + b + '</option>').join('');
}

function renderTable() {
  const fm = Array.from(document.getElementById('filter-med').selectedOptions).map(o => o.value).filter(Boolean);
  const fo = Array.from(document.getElementById('filter-own').selectedOptions).map(o => o.value).filter(Boolean);
  const fb = Array.from(document.getElementById('filter-branch').selectedOptions).map(o => o.value).filter(Boolean);
  var rows = (currentMode === 'active' ? activeResults : inactiveResults)
    .filter(function (r) { return (!fm.length || fm.includes(r.med)) && (!fo.length || fo.includes(r.assignedOwner)) && (!fb.length || fb.includes(r.assignedBranch)); });

  var filtActive = activeResults.filter(function (r) { return (!fm.length || fm.includes(r.med)) && (!fo.length || fo.includes(r.assignedOwner)) && (!fb.length || fb.includes(r.assignedBranch)); });
  var filtInactive = inactiveResults.filter(function (r) { return (!fo.length || fo.includes(r.assignedOwner)) && (!fb.length || fb.includes(r.assignedBranch)); });
  const cutoffStr = document.getElementById('cutoff-date').value;
  const windowDays = parseInt(document.getElementById('window-days').value) || 60;
  const cutoff = new Date(cutoffStr + 'T23:59:59Z');
  const floorDate = new Date(cutoff);
  floorDate.setUTCDate(floorDate.getUTCDate() - windowDays);
  floorDate.setUTCHours(0, 0, 0, 0);
  const inactFrom = new Date(document.getElementById('inactive-from').value + 'T00:00:00Z');
  renderSummary(windowDays, filtActive, filtInactive, cutoff, floorDate, inactFrom);

  rows.sort(function (a, b) {
    var av = a[sortCol], bv = b[sortCol];
    if (av instanceof Date) av = av.getTime();
    if (bv instanceof Date) bv = bv.getTime();
    if (av == null) av = sortDir > 0 ? Infinity : -Infinity;
    if (bv == null) bv = sortDir > 0 ? Infinity : -Infinity;
    if (typeof av === 'string') return sortDir * av.localeCompare(bv);
    return sortDir * (av - bv);
  });

  var yy = '<span class="bool-y">&#10003;</span>';
  var nn = '<span class="bool-n">&#8211;</span>';
  var th = document.getElementById('table-head');
  var tb = document.getElementById('table-body');

  if (currentMode === 'active') {
    var totCnt = rows.reduce(function(s, r) { return s + r.cnt; }, 0);
    var totPa = rows.reduce(function(s, r) { return s + r.pa; }, 0);
    var totRat = rows.reduce(function(s, r) { return s + r.rat; }, 0);
    var totCw = rows.reduce(function(s, r) { return s + r.cw; }, 0);
    var totCurPa = rows.reduce(function(s, r) { return s + r.curPa; }, 0);
    var totCurRat = rows.reduce(function(s, r) { return s + r.curRat; }, 0);
    var totCurCw = rows.reduce(function(s, r) { return s + r.curCw; }, 0);
    var tS = 'background:#0D2B5E;color:white;font-weight:700;font-size:10px;text-align:center;padding:7px 10px';
    var tL = 'background:#0D2B5E;color:white;font-weight:700;font-size:10px;padding:7px 10px;letter-spacing:.4px;text-transform:uppercase';
    var tE = 'background:#0D2B5E';
    th.innerHTML = [
      '<tr>',
      '<th class="sticky-col sticky-col-0 sticky-shadow" onclick="srt(String.fromCharCode(110,97,109,101))">Realtor &#8597;</th>',
      '<th class="sticky-col sticky-col-1" onclick="srt(String.fromCharCode(97,115,115,105,103,110,101,100,79,119,110,101,114))">Owner &#8597;</th>',
      '<th class="sticky-col sticky-col-2" onclick="srt(String.fromCharCode(97,115,115,105,103,110,101,100,66,114,97,110,99,104))">Branch &#8597;</th>',
      '<th class="sticky-col sticky-col-3 sticky-shadow" style="min-width:170px">Rating</th>',
      '<th style="min-width:90px" onclick="srt(String.fromCharCode(99,110,116))" title="Total leads in the selected time window">Period Leads &#8597;</th>',
      '<th style="min-width:80px" onclick="srt(String.fromCharCode(102,105,114,115,116,68,97,116,101))">1st Lead &#8597;</th>',
      '<th style="min-width:90px" onclick="srt(String.fromCharCode(112,101,110,117,108,116))">2nd to Last Lead &#8597;</th>',
      '<th style="min-width:60px;text-align:center" title="C1: Has at least 1 lead in the active window">Active C1</th>',
      '<th style="min-width:60px;text-align:center" title="C2: First lead fell within the window — new to the team">New C2</th>',
      '<th style="min-width:60px;text-align:center" title="C3: Has history prior to window — known realtor">Old C3</th>',
      '<th style="min-width:65px;text-align:center" title="C4: 2nd to last lead exceeded reactivation threshold — reactivating">React. C4</th>',
      '<th style="min-width:110px" onclick="srt(String.fromCharCode(112,97))" title="Leads that reached Pre-Approval in window (used in rating)">Leads w/ Pre-Appr &#8597;</th>',
      '<th style="min-width:110px" onclick="srt(String.fromCharCode(114,97,116))" title="Leads that reached Ratified in window (used in rating)">Leads w/ Ratified &#8597;</th>',
      '<th style="min-width:120px" onclick="srt(String.fromCharCode(99,119))" title="Leads closed (Closed Won) in window (used in rating)">Leads Closed Won &#8597;</th>',
      '<th style="min-width:120px;font-style:italic;background:#1a3a5c" onclick="srt(String.fromCharCode(99,117,114,80,97))" title="Opportunities currently in Pre-Approval (exclusive, excludes Closed Lost)">Curr. Pre-Approval &#8597;</th>',
      '<th style="min-width:120px;font-style:italic;background:#1a3a5c" onclick="srt(String.fromCharCode(99,117,114,82,97,116))" title="Opportunities currently in Ratified (exclusive)">Curr. Ratified &#8597;</th>',
      '<th style="min-width:120px;font-style:italic;background:#1a3a5c" onclick="srt(String.fromCharCode(99,117,114,67,119))" title="Opportunities currently in Closed Won (exclusive)">Curr. Closed Won &#8597;</th>',
      '</tr>',
      '<tr>',
      '<th style="' + tL + '">TOTAL</th>',
      '<th style="' + tE + '"></th>',
      '<th style="' + tE + '"></th>',
      '<th style="' + tE + '"></th>',
      '<th style="' + tS + '">' + totCnt + '</th>',
      '<th style="' + tE + '"></th>',
      '<th style="' + tE + '"></th>',
      '<th style="' + tE + '"></th>',
      '<th style="' + tE + '"></th>',
      '<th style="' + tE + '"></th>',
      '<th style="' + tE + '"></th>',
      '<th style="' + tS + '">' + totPa + '</th>',
      '<th style="' + tS + '">' + totRat + '</th>',
      '<th style="' + tS + '">' + totCw + '</th>',
      '<th style="' + tS + ';font-style:italic">' + totCurPa + '</th>',
      '<th style="' + tS + ';font-style:italic">' + totCurRat + '</th>',
      '<th style="' + tS + ';font-style:italic">' + totCurCw + '</th>',
      '</tr>'
    ].join('');

    window._resultMap = window._resultMap || {};
    rows.forEach(function (r) { window._resultMap[r.key] = r; });

    tb.innerHTML = rows.map(function (r) {
      var k = encodeURIComponent(r.key);
      return [
        '<tr>',
        '<td class="sticky-col sticky-col-0 sticky-shadow" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;max-width:140px" title="' + r.name + '">' + r.name + (r.confirmed ? '<span style="color:#1D9E75;font-size:9px;margin-left:3px">&#10003;</span>' : '') + '</td>',
        '<td class="sticky-col sticky-col-1"><span class="ot">' + (r.assignedOwner || '&#8211;') + '</span></td>',
        '<td class="sticky-col sticky-col-2"><span class="ot">' + (r.assignedBranch || '&#8211;') + '</span></td>',
        '<td class="sticky-col sticky-col-3 sticky-shadow"><span class="badge ' + (BADGE[r.med] || 'b-sin') + '">' + r.med + '</span></td>',
        '<td style="text-align:center"><span class="clickable-num" data-rkey="' + k + '" data-dtype="leads" title="View ' + r.cnt + ' period leads">' + r.cnt + '</span></td>',
        '<td class="dt">' + fmtDate(r.firstDate) + '</td>',
        '<td class="dt">' + fmtDate(r.penult) + '</td>',
        '<td style="text-align:center">' + (r.c1 ? yy : nn) + '</td>',
        '<td style="text-align:center">' + (r.c2 ? yy : nn) + '</td>',
        '<td style="text-align:center">' + (r.c3 ? yy : nn) + '</td>',
        '<td style="text-align:center">' + (r.c4 ? yy : nn) + '</td>',
        '<td style="text-align:center;color:' + (r.pa ? '#185FA5' : '#CCD5E0') + '">' + (r.pa ? '<span class="clickable-num" data-rkey="' + k + '" data-dtype="pa" style="color:#185FA5" title="View Pre-Approval detail">' + r.pa + '</span>' : '&#8211;') + '</td>',
        '<td style="text-align:center;color:' + (r.rat ? '#3C3489' : '#CCD5E0') + '">' + (r.rat ? '<span class="clickable-num" data-rkey="' + k + '" data-dtype="rat" style="color:#3C3489" title="View Ratified detail">' + r.rat + '</span>' : '&#8211;') + '</td>',
        '<td style="text-align:center;color:' + (r.cw ? '#085041' : '#CCD5E0') + ';font-weight:' + (r.cw ? '700' : '400') + '">' + (r.cw ? '<span class="clickable-num" data-rkey="' + k + '" data-dtype="cw" style="color:#085041" title="View Closed Won detail">' + r.cw + '</span>' : '&#8211;') + '</td>',
        '<td style="text-align:center;color:' + (r.curPa ? '#185FA5' : '#CCD5E0') + ';font-style:italic;background:rgba(230,241,251,0.45)">' + (r.curPa ? '<span class="clickable-num" data-rkey="' + k + '" data-dtype="curPa" style="color:#185FA5" title="View curr. Pre-Appr opps">' + r.curPa + '</span>' : '&#8211;') + '</td>',
        '<td style="text-align:center;color:' + (r.curRat ? '#3C3489' : '#CCD5E0') + ';font-style:italic;background:rgba(238,237,254,0.45)">' + (r.curRat ? '<span class="clickable-num" data-rkey="' + k + '" data-dtype="curRat" style="color:#3C3489" title="View curr. Ratified opps">' + r.curRat + '</span>' : '&#8211;') + '</td>',
        '<td style="text-align:center;color:' + (r.curCw ? '#085041' : '#CCD5E0') + ';font-style:italic;font-weight:' + (r.curCw ? '700' : '400') + ';background:rgba(225,245,238,0.45)">' + (r.curCw ? '<span class="clickable-num" data-rkey="' + k + '" data-dtype="curCw" style="color:#085041" title="View curr. Closed Won opps">' + r.curCw + '</span>' : '&#8211;') + '</td>',
        '</tr>'
      ].join('');
    }).join('');


  } else {
    th.innerHTML = [
      '<tr>',
      '<th style="min-width:140px" onclick="srt(String.fromCharCode(110,97,109,101))">Realtor &#8597;</th>',
      '<th style="min-width:90px" onclick="srt(String.fromCharCode(108,97,115,116,68,97,116,101))">Last Lead &#8597;</th>',
      '<th style="min-width:90px" onclick="srt(String.fromCharCode(100,97,121,115,83,105,110,99,101,76,97,115,116))">Inactive Days &#8597;</th>',
      '<th style="min-width:80px" onclick="srt(String.fromCharCode(99,110,116))">Period Leads &#8597;</th>',
      '<th style="min-width:80px" onclick="srt(String.fromCharCode(102,105,114,115,116,68,97,116,101))">1st Lead &#8597;</th>',
      '<th style="min-width:100px" onclick="srt(String.fromCharCode(99,119))">Closed Won &#8597;</th>',
      '<th style="min-width:90px" onclick="srt(String.fromCharCode(112,97))">Pre-Appr &#8597;</th>',
      '<th style="min-width:80px" onclick="srt(String.fromCharCode(114,97,116))">Ratified &#8597;</th>',
      '<th style="min-width:110px" onclick="srt(String.fromCharCode(97,115,115,105,103,110,101,100,79,119,110,101,114))">Owner &#8597;</th>',
      '<th style="min-width:90px" onclick="srt(String.fromCharCode(97,115,115,105,103,110,101,100,66,114,97,110,99,104))">Branch &#8597;</th>',
      '<th>Status</th>',
      '</tr>'
    ].join('');

    tb.innerHTML = rows.map(function (r) {
      return [
        '<tr>',
        '<td style="font-weight:600;max-width:140px;overflow:hidden;text-overflow:ellipsis" title="' + r.name + '">' + r.name + '</td>',
        '<td class="dt">' + fmtDate(r.lastDate) + '</td>',
        '<td style="text-align:center;font-weight:700;color:#B8960C">' + (r.daysSinceLast != null ? r.daysSinceLast + 'd' : '&#8211;') + '</td>',
        '<td style="text-align:center">' + (r.cnt || '&#8211;') + '</td>',
        '<td class="dt">' + fmtDate(r.firstDate) + '</td>',
        '<td style="text-align:center">' + (r.cw || '&#8211;') + '</td>',
        '<td style="text-align:center">' + (r.pa || '&#8211;') + '</td>',
        '<td style="text-align:center">' + (r.rat || '&#8211;') + '</td>',
        '<td><span class="ot">' + (r.assignedOwner || '&#8211;') + '</span></td>',
        '<td><span class="ot">' + (r.assignedBranch || '&#8211;') + '</span></td>',
        '<td><span class="badge b-inactive">Inactive</span></td>',
        '</tr>'
      ].join('');
    }).join('');
  }
}

function srt(col) {
  if (sortCol === col) sortDir *= -1;
  else { sortCol = col; sortDir = -1; }
  renderTable();
}

// Event delegation — handles all clickable numbers in the table
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-rkey]');
  if (!el) return;
  var key = decodeURIComponent(el.getAttribute('data-rkey') || '');
  var dtype = el.getAttribute('data-dtype') || '';
  if (!key || !dtype) return;
  var allR = activeResults.concat(inactiveResults);
  var r = allR.find(function (x) { return x.key === key; });
  if (!r) return;
  if (dtype === 'leads') showLeadDetail(key, r.name);
  else showOppDetail(key, r.name, dtype);
});

function showTab(t) {
  const ts = ['med', 'sc', 'assign', 'log'];
  document.querySelectorAll('.tab').forEach((el, i) => el.classList.toggle('active', ts[i] === t));
  ts.forEach(id => document.getElementById('tab-' + id).classList.toggle('hidden', id !== t));
}
