async function runCalc() {
  document.getElementById('run-btn').disabled = true;
  document.getElementById('run-btn').textContent = '⏳ Calculating...';
  try {
    await _runCalc();
  } catch (e) {
    setStatus('err', '❌ Calculation error: ' + e.message);
    console.error('runCalc error:', e);
  } finally {
    document.getElementById('run-btn').disabled = false;
    document.getElementById('run-btn').innerHTML = '<i class="ti ti-player-play"></i> Calculate Metrics';
  }
}

async function _runCalc() {
  if (!leadsData || !oppData) {
    try {
      setStatus('load', '⏳ Loading data from Supabase...');
      await loadDataFromSupabase();
      if (!leadsData || !leadsData.length) {
        setStatus('err', '❌ No lead data found. Please upload the file first.');
        return;
      }
    } catch (e) {
      setStatus('err', '❌ Error loading data: ' + e.message);
      return;
    }
  }
  setStatus('load', '⏳ Processing ' + leadsData.length + ' leads and ' + (oppData ? oppData.length : 0) + ' opportunities...');
  console.log('DATA CHECK - leadsData:', leadsData ? leadsData.length : 'null', 'oppData:', oppData ? oppData.length : 'null');
  if (leadsData && leadsData.length > 0) {
    var sample = leadsData[0];
    console.log('SAMPLE LEAD KEYS:', Object.keys(sample));
    console.log('SAMPLE LEAD:', JSON.stringify(sample).slice(0, 200));
  }
  const cutoffStr = document.getElementById('cutoff-date').value;
  const windowDays = parseInt(document.getElementById('window-days').value) || 60;
  const reactDays = parseInt(document.getElementById('react-days').value) || 150;
  const inactFromStr = document.getElementById('inactive-from').value;
  const allowedOwners = document.getElementById('owners-list').value.split(',').map(s => s.trim()).filter(Boolean);
  const allowedNorm = new Map(allowedOwners.map(o => [norm(o), o]));
  const cutoff = new Date(cutoffStr + 'T23:59:59Z');
  const floorDate = new Date(cutoff); floorDate.setUTCDate(floorDate.getUTCDate() - windowDays);
  const reactThreshold = new Date(cutoff); reactThreshold.setUTCDate(reactThreshold.getUTCDate() - reactDays);
  const inactFloor = inactFromStr ? new Date(inactFromStr + 'T00:00:00Z') : new Date('2024-01-01');

  const byRef = new Map();
  const leadRowsMap = new Map();
  const oppRowsMap = new Map();
  for (const row of (leadsData || [])) {
    const ref = getField(row, 'Referred By', 'referred by'); if (!ref || !String(ref).trim()) continue;
    const key = norm(ref), name = String(ref).trim();
    const cd = parseDate(getField(row, 'Created Date', 'Create Date', 'created date', 'create date'));
    const ownerStr = String(getField(row, 'Lead Owner', 'lead owner', 'owner') || '').trim();
    const branchStr = String(getField(row, 'Branch', 'branch') || '').trim();
    if (!byRef.has(key)) byRef.set(key, { name, allDates: [], recentDates: [], owners: new Map(), branches: new Map() });
    const rec = byRef.get(key);
    if (cd) {
      rec.allDates.push(cd);
      if (cd >= floorDate && cd <= cutoff) {
        rec.recentDates.push(cd);
        if (ownerStr) rec.owners.set(ownerStr, (rec.owners.get(ownerStr) || 0) + 1);
        if (branchStr) rec.branches.set(branchStr, (rec.branches.get(branchStr) || 0) + 1);
        if (!leadRowsMap.has(key)) leadRowsMap.set(key, []);
        leadRowsMap.get(key).push(row);
      }
    }
  }
  console.log('byRef size:', byRef.size, 'entries found');
  console.log('cutoff:', cutoff, 'floorDate:', floorDate, 'windowDays:', windowDays);
  if (byRef.size > 0) {
    var firstEntry = [...byRef.entries()][0];
    var sampleRec = firstEntry[1];
    console.log('SAMPLE REALTOR:', firstEntry[0]);
    console.log('  allDates count:', sampleRec.allDates.length);
    console.log('  recentDates count:', sampleRec.recentDates.length);
    if (sampleRec.allDates.length > 0) console.log('  first allDate:', sampleRec.allDates[0]);
    if (sampleRec.allDates.length > 0) console.log('  last allDate:', sampleRec.allDates[sampleRec.allDates.length - 1]);
  }
  var withRecent = 0;
  for (var [k, v] of byRef.entries()) if (v.recentDates.length > 0) withRecent++;
  console.log('Realtors with recent leads:', withRecent, 'out of', byRef.size);

  // Block 1: count any opp that passed through each stage in window (not exclusive, not Closed Lost)
  const cwMap = new Map(), ratMap = new Map(), paMap = new Map(), oppOwnerMap = new Map();
  // Block 2: current stage analysis (exclusive: CW > Rat > PA, never Closed Lost)
  const curCwMap = new Map(), curRatMap = new Map(), curPaMap = new Map();
  for (const row of (oppData || [])) {
    const ref = getField(row, 'Referred By', 'referred by'); if (!ref || !String(ref).trim()) continue;
    const key = norm(ref);
    const stage = String(getField(row, 'Stage', 'stage') || '').trim().toLowerCase();
    const disbDate = parseDate(getField(row, 'Disbursement Date', 'disbursement date'));
    const paDate = parseDate(getField(row, 'Pre-Approved Date', 'pre-approved date'));
    const ratDate = parseDate(getField(row, 'Ratified Date', 'ratified date'));
    const oppOwner = getField(row, 'Opportunity Owner', 'opportunity owner');
    if (oppOwner) oppOwnerMap.set(key, String(oppOwner).trim());
    if (!oppRowsMap.has(key)) oppRowsMap.set(key, []);
    oppRowsMap.get(key).push(row);
    // Block 1: Closed Lost counts for PA and Ratified but NOT Closed Won
    if (stage !== 'closed lost') {
      if (stage === 'closed won' && disbDate && disbDate >= floorDate && disbDate <= cutoff) cwMap.set(key, (cwMap.get(key) || 0) + 1);
    }
    if (paDate && paDate >= floorDate && paDate <= cutoff) paMap.set(key, (paMap.get(key) || 0) + 1);
    if (ratDate && ratDate >= floorDate && ratDate <= cutoff) ratMap.set(key, (ratMap.get(key) || 0) + 1);
    // Block 2: Closed Lost excluded entirely
    if (stage === 'closed lost') continue;
    const isCW = stage === 'closed won' && disbDate && disbDate >= floorDate && disbDate <= cutoff;
    const isRat = !isCW && ratDate && ratDate >= floorDate && ratDate <= cutoff;
    const isPA = !isCW && !isRat && paDate && paDate >= floorDate && paDate <= cutoff;
    if (isCW) curCwMap.set(key, (curCwMap.get(key) || 0) + 1);
    else if (isRat) curRatMap.set(key, (curRatMap.get(key) || 0) + 1);
    else if (isPA) curPaMap.set(key, (curPaMap.get(key) || 0) + 1);
  }

  activeResults = []; inactiveResults = [];

  for (const [key, rec] of byRef.entries()) {
    const allSorted = [...rec.allDates].sort((a, b) => a - b);
    const uniqueDays = [], seen = new Set();
    for (const d of allSorted) { const k = d.toISOString().slice(0, 10); if (!seen.has(k)) { seen.add(k); uniqueDays.push(d); } }
    const firstDate = uniqueDays[0] || null, lastDate = uniqueDays[uniqueDays.length - 1] || null, penult = uniqueDays.length >= 2 ? uniqueDays[uniqueDays.length - 2] : null;
    const cnt = rec.recentDates.length, isActive = cnt > 0;
    const hasLeadSince = rec.allDates.some(d => d >= inactFloor);
    const isInactive = !isActive && lastDate && lastDate < floorDate && hasLeadSince;
    if (!isActive && !isInactive) continue;

    let assignedOwner = '', assignedBranch = '', ownerSource = 'auto', confirmed = false;
    const me = masterMap.get(key);
    if (me && me.owner && me.source === 'manual') {
      assignedOwner = me.owner; assignedBranch = me.branch || ''; ownerSource = me.source || 'auto'; confirmed = me.confirmed || false;
    } else {
      if (rec.owners.size > 0) { let best = '', bestN = -1; for (const [o, n] of rec.owners.entries()) { const c = allowedNorm.get(norm(o)); if (c && n > bestN) { bestN = n; best = c; } } if (bestN > -1) assignedOwner = best; }
      if (!assignedOwner && oppOwnerMap.has(key)) { const c = allowedNorm.get(norm(oppOwnerMap.get(key))); if (c) assignedOwner = c; }
      if (rec.branches.size > 0) { let best = '', bestN = -1; for (const [b, n] of rec.branches.entries()) if (n > bestN) { bestN = n; best = b; } assignedBranch = best; }
    }

    const cw = cwMap.get(key) || 0, pa = paMap.get(key) || 0, rat = ratMap.get(key) || 0;

    if (isActive) {
      const c1 = true, c2 = firstDate ? firstDate >= floorDate : false, c3 = firstDate ? firstDate < floorDate : false, c4 = penult ? penult <= reactThreshold : false;
      const c5 = cw > 0, c6 = pa > 0, c7 = rat > 0;
      // Medición priority: Closing(c5) > Ratified(c7) > Pre-Approval(c6)
      // NEW(c2) and RESCUED(c4) are mutually exclusive; OLD(c3) = Farming
      let med;
      if      (c1 && c2 && c5)  med = 'Hunting New - Closing';
      else if (c1 && c2 && c7)  med = 'Hunting New - Ratified';
      else if (c1 && c2 && c6)  med = 'Hunting New - Pre Approval';
      else if (c1 && c2)        med = 'Hunting New';
      else if (c1 && c4 && c5)  med = 'Hunting Rescued - Closing';
      else if (c1 && c4 && c7)  med = 'Hunting Rescued - Ratified';
      else if (c1 && c4 && c6)  med = 'Hunting Rescued - Pre Approval';
      else if (c1 && c4)        med = 'Hunting Rescued';
      else if (c1 && c3 && c5)  med = 'Farming Closing';
      else if (c1 && c3 && c7)  med = 'Farming Ratified';
      else if (c1 && c3 && c6)  med = 'Farming Pre Approval';
      else if (c1 && c3)        med = 'Farming Lead';
      else                      med = 'Sin medición';
      const curCw = curCwMap.get(key) || 0, curRat = curRatMap.get(key) || 0, curPa = curPaMap.get(key) || 0;
      activeResults.push({ key, name: rec.name, cnt, firstDate, penult, lastDate, c1, c2, c3, c4, cw, pa, rat, curCw, curRat, curPa, med, assignedOwner, assignedBranch, ownerSource, confirmed, leadRows: leadRowsMap.get(key) || [], oppRows: oppRowsMap.get(key) || [] });
    } else {
      const curCw2 = curCwMap.get(key) || 0, curRat2 = curRatMap.get(key) || 0, curPa2 = curPaMap.get(key) || 0;
      inactiveResults.push({ key, name: rec.name, cnt: rec.recentDates.length || rec.allDates.length, firstDate, penult, lastDate, cw, pa, rat, curCw: curCw2, curRat: curRat2, curPa: curPa2, med: 'Inactive', assignedOwner, assignedBranch, ownerSource, confirmed, daysSinceLast: lastDate ? Math.floor((cutoff - lastDate) / 86400000) : null, leadRows: leadRowsMap.get(key) || [], oppRows: oppRowsMap.get(key) || [] });
    }
    const existing = masterMap.get(key);
    if (!existing || existing.source === 'auto') {
      masterMap.set(key, { name: rec.name, owner: assignedOwner, branch: assignedBranch, source: 'auto', updatedAt: fmtNow(), confirmed: false });
    }
  }

  const selMode = document.getElementById('mode-selector').value;
  currentMode = selMode;
  console.log('MODE:', selMode, 'active:', activeResults.length, 'inactive:', inactiveResults.length);

  const allowedOwnersArr = document.getElementById('owners-list').value.split(',').map(s => s.trim()).filter(Boolean);
  document.getElementById('assign-filter-owner').innerHTML = '<option value="">All Owners</option>' + allowedOwnersArr.map(o => '<option value="' + o + '">' + o + '</option>').join('');

  populateFilters(allowedOwnersArr);
  renderSummary(windowDays, null, null, cutoff, floorDate, inactFloor);
  setMode(currentMode);
  renderScorecard(allowedOwnersArr);
  renderAssignCards();
  renderLog();
  console.log('RESULTS: active=', activeResults.length, 'inactive=', inactiveResults.length);
  document.getElementById('results').classList.remove('hidden');
  setStatus('ok', '✅ Calculation complete — ' + activeResults.length + ' active · ' + inactiveResults.length + ' inactive');
}

function renderSummary(w, filtActive, filtInactive, cutoffDate, floorDate, inactFrom) {
  const src = filtActive || activeResults;
  const srcInact = (filtInactive || inactiveResults).filter(r => r.assignedOwner && r.assignedOwner !== '');
  const total = src.length, inact = srcInact.length;
  const h = src.filter(r => r.med.startsWith('Hunting')).length;
  const f = src.filter(r => r.med.startsWith('Farming')).length;
  const clos = src.filter(r => r.med.includes('Closing')).length;
  const activeSub = (floorDate && cutoffDate) ? 'from ' + fmtDate(floorDate) + ' to ' + fmtDate(cutoffDate) : 'leads in last ' + (w || 60) + ' days';
  const inactiveSub = (floorDate && inactFrom) ? 'no leads since ' + fmtDate(floorDate) + ', from ' + fmtDate(inactFrom) : 'no recent activity';
  document.getElementById('summary-cards').innerHTML = [
    ['Active Realtors', total, activeSub],
    ['Inactive', inact, inactiveSub],
    ['Hunting', h, Math.round(h / (total || 1) * 100) + '% of active'],
    ['Farming', f, Math.round(f / (total || 1) * 100) + '% of active'],
    ['With Closing', clos, 'Active Closed Won']
  ].map(([l, v, s]) => '<div class="mc"><div class="mc-l">' + l + '</div><div class="mc-v">' + v + '</div><div class="mc-s">' + s + '</div></div>').join('');
}
