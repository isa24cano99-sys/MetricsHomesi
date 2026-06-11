function showScorecardDetail(owner, med) {
  const rows = activeResults.filter(r => r.assignedOwner === owner && r.med === med);
  if (!rows.length) return;

  const cutoffStr = document.getElementById('cutoff-date').value;
  const windowDays = parseInt(document.getElementById('window-days').value) || 60;
  const cutoff = new Date(cutoffStr + 'T23:59:59Z');
  const floorDate = new Date(cutoff);
  floorDate.setUTCDate(floorDate.getUTCDate() - windowDays);
  floorDate.setUTCHours(0, 0, 0, 0);

  const head = '<tr>' +
    '<th>#</th>' +
    '<th>Realtor</th>' +
    '<th>Branch</th>' +
    '<th>Period Leads</th>' +
    '<th>1st Lead</th>' +
    '<th>2nd to Last Lead</th>' +
    '<th>Leads w/ Pre-Appr</th>' +
    '<th>Leads w/ Ratified</th>' +
    '<th>Leads Closed Won</th>' +
    '<th>Curr. Pre-Approval</th>' +
    '<th>Curr. Ratified</th>' +
    '<th>Curr. Closed Won</th>' +
    '</tr>';

  const body = rows.map((r, i) =>
    '<tr>' +
    '<td style="color:#8899BB;font-size:10px">' + (i + 1) + '</td>' +
    '<td style="font-weight:600">' + r.name + '</td>' +
    '<td>' + (r.assignedBranch || '—') + '</td>' +
    '<td style="text-align:center"><span class="clickable-num" data-rkey="' + encodeURIComponent(r.key) + '" data-dtype="leads" title="View leads">' + r.cnt + '</span></td>' +
    '<td class="dt">' + fmtDate(r.firstDate) + '</td>' +
    '<td class="dt">' + fmtDate(r.penult) + '</td>' +
    '<td style="text-align:center;color:' + (r.pa ? '#185FA5' : '#CCD5E0') + '">' + (r.pa || '—') + '</td>' +
    '<td style="text-align:center;color:' + (r.rat ? '#3C3489' : '#CCD5E0') + '">' + (r.rat || '—') + '</td>' +
    '<td style="text-align:center;color:' + (r.cw ? '#085041' : '#CCD5E0') + ';font-weight:' + (r.cw ? '700' : '400') + '">' + (r.cw || '—') + '</td>' +
    '<td style="text-align:center;color:' + (r.curPa ? '#185FA5' : '#CCD5E0') + ';font-style:italic">' + (r.curPa || '—') + '</td>' +
    '<td style="text-align:center;color:' + (r.curRat ? '#3C3489' : '#CCD5E0') + ';font-style:italic">' + (r.curRat || '—') + '</td>' +
    '<td style="text-align:center;color:' + (r.curCw ? '#085041' : '#CCD5E0') + ';font-style:italic;font-weight:' + (r.curCw ? '700' : '400') + '">' + (r.curCw || '—') + '</td>' +
    '</tr>'
  ).join('');

  const csvData = [
    ['#', 'Realtor', 'Branch', 'Period Leads', '1st Lead', '2nd to Last Lead',
     'Leads w/ Pre-Appr', 'Leads w/ Ratified', 'Leads Closed Won',
     'Curr. Pre-Approval', 'Curr. Ratified', 'Curr. Closed Won'],
    ...rows.map((r, i) => [
      i + 1, r.name, r.assignedBranch || '', r.cnt,
      fmtDate(r.firstDate), fmtDate(r.penult),
      r.pa || 0, r.rat || 0, r.cw || 0,
      r.curPa || 0, r.curRat || 0, r.curCw || 0
    ])
  ];

  openModal(
    owner + ' — ' + med,
    rows.length + ' realtor' + (rows.length !== 1 ? 's' : '') + ' · window: ' + fmtDate(floorDate) + ' → ' + fmtDate(cutoff),
    head,
    body,
    csvData
  );
}

function closeModal(e) {
  if (e.target === document.getElementById('detail-modal'))
    document.getElementById('detail-modal').classList.add('hidden');
}

function openModal(title, sub, headHtml, bodyHtml, csvData) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-sub').textContent = sub;
  const modalBody = document.querySelector('#detail-modal .modal-body');
  if (headHtml) {
    modalBody.innerHTML = '<table class="modal-table"><thead id="modal-thead"></thead><tbody id="modal-tbody"></tbody></table>';
    document.getElementById('modal-thead').innerHTML = headHtml;
    document.getElementById('modal-tbody').innerHTML = bodyHtml;
  } else {
    modalBody.innerHTML = bodyHtml;
  }
  let csvBtn = document.getElementById('modal-csv-btn');
  if (!csvBtn) {
    csvBtn = document.createElement('button');
    csvBtn.id = 'modal-csv-btn';
    csvBtn.className = 'modal-csv-btn';
    document.querySelector('#detail-modal .modal-close').before(csvBtn);
  }
  csvBtn.style.display = csvData ? '' : 'none';
  if (csvData) {
    csvBtn.innerHTML = '<i class="ti ti-download"></i> Download CSV';
    csvBtn.onclick = () => dl(csvData, 'detalle.csv');
  }
  document.getElementById('detail-modal').classList.remove('hidden');
}

function showLeadDetail(key, realtorName) {
  var allResults = [...activeResults, ...inactiveResults];
  var r = allResults.find(function (x) { return x.key === key; });
  if (!r || !r.leadRows || !r.leadRows.length) { alert('No leads available.'); return; }
  var rows = r.leadRows;
  var head = '<tr>' +
    '<th>#</th>' +
    '<th>Lead Name</th>' +
    '<th>Lead Status</th>' +
    '<th>Created Date</th>' +
    '</tr>';
  console.log('LEAD ROW SAMPLE:', JSON.stringify(rows[0]).slice(0, 300));
  var body = rows.map(function (row, i) {
    var fn = String(getField(row, 'First Name', 'first name') || '').trim();
    var ln = String(getField(row, 'Last Name', 'last name') || '').trim();
    var co = String(getField(row, 'Company / Account', 'company / account') || '').trim();
    var name = (fn + ' ' + ln).trim() || co || '—';
    var status = String(getField(row, 'Lead Status', 'lead status', 'status') || '—').trim();
    var cd = parseDate(getField(row, 'Created Date', 'Create Date', 'created date', 'create date'));
    return '<tr>' +
      '<td style="color:#8899BB;font-size:10px">' + (i + 1) + '</td>' +
      '<td style="font-weight:600">' + name + '</td>' +
      '<td><span class="modal-stage stage-other">' + status + '</span></td>' +
      '<td class="dt">' + fmtDate(cd) + '</td>' +
      '</tr>';
  }).join('');
  openModal(
    realtorName + ' — Period Leads',
    rows.length + ' lead' + (rows.length !== 1 ? 's' : '') + ' in the selected window',
    head, body
  );
}

function showOppDetail(key, realtorName, colType) {
  var allResults = [...activeResults, ...inactiveResults];
  var r = allResults.find(function (x) { return x.key === key; });
  if (!r || !r.oppRows || !r.oppRows.length) { alert('No opportunities available.'); return; }

  var cutoffStr = document.getElementById('cutoff-date').value;
  var windowDays = parseInt(document.getElementById('window-days').value) || 60;
  var cutoff = new Date(cutoffStr + 'T23:59:59Z');
  var floorDate = new Date(cutoff); floorDate.setUTCDate(floorDate.getUTCDate() - windowDays);

  var filtered = r.oppRows.filter(function (row) {
    var stage = String(getField(row, 'Stage', 'stage') || '').trim().toLowerCase();
    var disbDate = parseDate(getField(row, 'Disbursement Date', 'disbursement date'));
    var paDate = parseDate(getField(row, 'Pre-Approved Date', 'pre-approved date', 'pre approved date'));
    var ratDate = parseDate(getField(row, 'Ratified Date', 'ratified date'));
    var isCW = stage === 'closed won' && disbDate && disbDate >= floorDate && disbDate <= cutoff;
    var isRat = ratDate && ratDate >= floorDate && ratDate <= cutoff;
    var isPA = paDate && paDate >= floorDate && paDate <= cutoff;
    // Block 1: Closed Lost counts for PA and Ratified but NOT Closed Won
    if (colType === 'pa') return isPA;
    if (colType === 'rat') return isRat;
    if (colType === 'cw') return isCW;
    // Block 2: Closed Lost excluded entirely
    if (stage === 'closed lost') return false;
    if (colType === 'curCw') return isCW;
    if (colType === 'curRat') return !isCW && isRat;
    if (colType === 'curPa') return !isCW && !isRat && isPA;
    return false;
  });

  if (!filtered.length) { alert('No opportunities found for this filter.'); return; }

  var labels = {
    pa: 'Leads w/ Pre-Approval', rat: 'Leads w/ Ratified', cw: 'Leads Closed Won',
    curPa: 'Curr. Pre-Approval', curRat: 'Curr. Ratified', curCw: 'Curr. Closed Won'
  };
  var dateLabel = { pa: 'Pre-Approval Date', rat: 'Ratified Date', cw: 'Disbursement Date', curPa: 'Pre-Approval Date', curRat: 'Ratified Date', curCw: 'Disbursement Date' };
  var stageCls = { pa: 'stage-pa', rat: 'stage-rat', cw: 'stage-cw', curPa: 'stage-pa', curRat: 'stage-rat', curCw: 'stage-cw' };

  var head = '<tr>' +
    '<th>#</th>' +
    '<th>Loan #</th>' +
    '<th>Opportunity Name</th>' +
    '<th>Loan Officer</th>' +
    '<th>Branch</th>' +
    '<th>Loan Amount</th>' +
    '<th>' + dateLabel[colType] + '</th>' +
    '<th>Stage</th>' +
    '</tr>';

  var body = filtered.map(function (row, i) {
    var oppName = String(getField(row, 'Opportunity Name', 'opportunity name') || '—').trim();
    var lo = String(getField(row, 'Loan Officer', 'loan officer', 'Loan Officers', 'loan officers') || '—').trim();
    var branch = String(getField(row, 'Branch', 'branch') || '—').trim();
    var amt = getField(row, 'Loan Amount', 'loan amount', 'Loan #', 'loan #');
    var amtFmt = amt ? '$' + Number(amt).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—';
    var stage = String(getField(row, 'Stage', 'stage') || '—').trim();
    var disbDate = parseDate(getField(row, 'Disbursement Date', 'disbursement date'));
    var paDate = parseDate(getField(row, 'Pre-Approved Date', 'pre-approved date', 'pre approved date'));
    var ratDate = parseDate(getField(row, 'Ratified Date', 'ratified date'));
    var dateVal = null;
    if (colType === 'pa' || colType === 'curPa') dateVal = paDate;
    else if (colType === 'rat' || colType === 'curRat') dateVal = ratDate;
    else if (colType === 'cw' || colType === 'curCw') dateVal = disbDate;
    var lnNum = String(getField(row, 'Loan #', 'loan #') || '—').trim();
    return '<tr>' +
      '<td style="color:#8899BB;font-size:10px">' + (i + 1) + '</td>' +
      '<td style="font-family:monospace;font-size:10px;color:#556080">' + lnNum + '</td>' +
      '<td style="font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis" title="' + oppName + '">' + oppName + '</td>' +
      '<td>' + lo + '</td>' +
      '<td>' + branch + '</td>' +
      '<td class="modal-amount">' + amtFmt + '</td>' +
      '<td class="dt">' + fmtDate(dateVal) + '</td>' +
      '<td><span class="modal-stage ' + stageCls[colType] + '">' + stage + '</span></td>' +
      '</tr>';
  }).join('');

  const csvData = [
    ['#', 'Loan #', 'Opportunity Name', 'Loan Officer', 'Branch', 'Loan Amount', dateLabel[colType], 'Stage'],
    ...filtered.map((row, i) => {
      var oppName = String(getField(row, 'Opportunity Name', 'opportunity name') || '').trim();
      var lo = String(getField(row, 'Loan Officer', 'loan officer', 'Loan Officers', 'loan officers') || '').trim();
      var branch = String(getField(row, 'Branch', 'branch') || '').trim();
      var amt = getField(row, 'Loan Amount', 'loan amount', 'Loan #', 'loan #');
      var stage = String(getField(row, 'Stage', 'stage') || '').trim();
      var disbDate = parseDate(getField(row, 'Disbursement Date', 'disbursement date'));
      var paDate = parseDate(getField(row, 'Pre-Approved Date', 'pre-approved date', 'pre approved date'));
      var ratDate = parseDate(getField(row, 'Ratified Date', 'ratified date'));
      var dateVal = null;
      if (colType === 'pa' || colType === 'curPa') dateVal = paDate;
      else if (colType === 'rat' || colType === 'curRat') dateVal = ratDate;
      else if (colType === 'cw' || colType === 'curCw') dateVal = disbDate;
      var lnNum = String(getField(row, 'Loan #', 'loan #') || '').trim();
      return [i + 1, lnNum, oppName, lo, branch, amt || '', fmtDate(dateVal), stage];
    })
  ];

  openModal(
    realtorName + ' — ' + labels[colType],
    filtered.length + ' opportunit' + (filtered.length !== 1 ? 'ies' : 'y') + ' · window: ' + fmtDate(floorDate) + ' → ' + fmtDate(cutoff),
    head, body, csvData
  );
}

function showAllLeadsForRealtor(key, realtorName) {
  const decodedKey = decodeURIComponent(key);

  const allLeads = (leadsData || []).filter(row => {
    const ref = getField(row, 'Referred By', 'referred by');
    return ref && norm(String(ref)) === decodedKey;
  });
  allLeads.sort((a, b) => {
    const da = parseDate(getField(a, 'Created Date', 'Create Date', 'created date'));
    const db = parseDate(getField(b, 'Created Date', 'Create Date', 'created date'));
    return (da || 0) - (db || 0);
  });

  const allResults = activeResults.concat(inactiveResults);
  const r = allResults.find(x => x.key === decodedKey);
  const allOpps = (r && r.oppRows) ? r.oppRows : [];

  if (!allLeads.length && !allOpps.length) {
    alert('No data available for this realtor.');
    return;
  }

  const firstDate = allLeads.length ? parseDate(getField(allLeads[0], 'Created Date', 'Create Date', 'created date')) : null;
  const lastDate  = allLeads.length ? parseDate(getField(allLeads[allLeads.length - 1], 'Created Date', 'Create Date', 'created date')) : null;

  const sub = allLeads.length + ' lead' + (allLeads.length !== 1 ? 's' : '') +
    (firstDate ? ' · oldest: ' + fmtDate(firstDate) : '') +
    (lastDate  ? ' · most recent: ' + fmtDate(lastDate) : '') +
    ' · ' + allOpps.length + ' opportunit' + (allOpps.length !== 1 ? 'ies' : 'y');

  const secStyle = 'font-family:\'Barlow\',sans-serif;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--hs-red);margin-bottom:8px';
  const divStyle = 'border-top:2px solid var(--hs-red);margin:20px 0 12px';

  // ── Leads section ──────────────────────────────────────────────────────────
  const leadsHead = '<tr><th>#</th><th>Lead Name</th><th>Owner/BD</th><th>Created Date</th><th>Branch</th></tr>';
  const leadsBody = allLeads.map((row, i) => {
    const fn     = String(getField(row, 'First Name', 'first name') || '').trim();
    const ln     = String(getField(row, 'Last Name', 'last name') || '').trim();
    const leadName = (fn + ' ' + ln).trim() || '—';
    const owner  = String(getField(row, 'Lead Owner', 'lead owner', 'owner') || '—').trim();
    const cd     = parseDate(getField(row, 'Created Date', 'Create Date', 'created date'));
    const branch = String(getField(row, 'Branch', 'branch') || '—').trim();
    return '<tr>' +
      '<td style="color:#8899BB;font-size:10px">' + (i + 1) + '</td>' +
      '<td style="font-weight:600">' + leadName + '</td>' +
      '<td>' + owner + '</td>' +
      '<td class="dt">' + fmtDate(cd) + '</td>' +
      '<td>' + branch + '</td>' +
      '</tr>';
  }).join('');

  // ── Opps section ───────────────────────────────────────────────────────────
  function stageColor(s) {
    const sl = (s || '').toLowerCase();
    if (sl === 'closed won')  return '#085041';
    if (sl === 'closed lost') return '#C0392B';
    if (sl === 'proposal')    return '#185FA5';
    if (sl === 'negotiation') return '#3C3489';
    return '#667799';
  }

  const oppsHead = '<tr><th>Loan #</th><th>Created Date</th><th>Opportunity Name</th><th>Opp. Owner</th><th>Branch</th><th>Loan Officer</th><th>Current Stage</th><th>Last Milestone Date</th><th>Last Milestone</th></tr>';
  const oppsBody = allOpps.map(row => {
    const lnNum    = String(getField(row, 'Loan #', 'loan #') || '—').trim();
    const oppName  = String(getField(row, 'Opportunity Name', 'opportunity name') || '—').trim();
    const oppOwner = String(getField(row, 'Opportunity Owner', 'opportunity owner') || '—').trim();
    const branch   = String(getField(row, 'Branch', 'branch') || '—').trim();
    const lo       = String(getField(row, 'Loan Officer', 'loan officer', 'Loan Officers', 'loan officers') || '—').trim();
    const stage    = String(getField(row, 'Stage', 'stage') || '—').trim();
    const oppCd    = parseDate(getField(row, 'Created Date', 'created date', 'create date'));
    const disbDate = parseDate(getField(row, 'Disbursement Date', 'disbursement date'));
    const ratDate  = parseDate(getField(row, 'Ratified Date', 'ratified date'));
    const paDate   = parseDate(getField(row, 'Pre-Approved Date', 'pre-approved date', 'pre approved date'));
    let lastReachedDate, lastReachedStage;
    if (stage.toLowerCase() === 'closed won' && disbDate) { lastReachedDate = disbDate; lastReachedStage = 'Closed Won'; }
    else if (ratDate) { lastReachedDate = ratDate; lastReachedStage = 'Ratified'; }
    else if (paDate)  { lastReachedDate = paDate;  lastReachedStage = 'Pre-Approval'; }
    else              { lastReachedDate = null;     lastReachedStage = '—'; }
    const sc = stageColor(stage);
    return '<tr>' +
      '<td style="font-family:monospace;font-size:10px;color:#556080">' + lnNum + '</td>' +
      '<td class="dt">' + fmtDate(oppCd) + '</td>' +
      '<td style="font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis" title="' + oppName + '">' + oppName + '</td>' +
      '<td>' + oppOwner + '</td>' +
      '<td>' + branch + '</td>' +
      '<td>' + lo + '</td>' +
      '<td><span style="color:' + sc + ';font-weight:600">' + stage + '</span></td>' +
      '<td class="dt">' + fmtDate(lastReachedDate) + '</td>' +
      '<td style="color:#667799;font-size:10px;font-weight:600">' + lastReachedStage + '</td>' +
      '</tr>';
  }).join('');

  const bodyHtml =
    '<div style="' + secStyle + '">Leads (' + allLeads.length + ')</div>' +
    '<div style="overflow-x:auto">' +
      '<table class="modal-table"><thead>' + leadsHead + '</thead><tbody>' + leadsBody + '</tbody></table>' +
    '</div>' +
    '<div style="' + divStyle + '"></div>' +
    '<div style="' + secStyle + '">Opportunities (' + allOpps.length + ')</div>' +
    '<div style="overflow-x:auto">' +
      '<table class="modal-table"><thead>' + oppsHead + '</thead><tbody>' + oppsBody + '</tbody></table>' +
    '</div>';

  // ── CSV combinado ──────────────────────────────────────────────────────────
  const csvData = [
    ['LEADS'],
    ['#', 'Lead Name', 'Realtor', 'Owner/BD', 'Created Date', 'Branch'],
    ...allLeads.map((row, i) => {
      const fn     = String(getField(row, 'First Name', 'first name') || '').trim();
      const ln     = String(getField(row, 'Last Name', 'last name') || '').trim();
      const leadName = (fn + ' ' + ln).trim() || '';
      const owner  = String(getField(row, 'Lead Owner', 'lead owner', 'owner') || '').trim();
      const cd     = parseDate(getField(row, 'Created Date', 'Create Date', 'created date'));
      const branch = String(getField(row, 'Branch', 'branch') || '').trim();
      return [i + 1, leadName, realtorName, owner, fmtDate(cd), branch];
    }),
    [],
    ['OPPORTUNITIES'],
    ['Loan #', 'Created Date', 'Opportunity Name', 'Opp. Owner', 'Branch', 'Loan Officer', 'Current Stage', 'Last Milestone Date', 'Last Milestone'],
    ...allOpps.map(row => {
      const lnNum    = String(getField(row, 'Loan #', 'loan #') || '').trim();
      const oppName  = String(getField(row, 'Opportunity Name', 'opportunity name') || '').trim();
      const oppOwner = String(getField(row, 'Opportunity Owner', 'opportunity owner') || '').trim();
      const branch   = String(getField(row, 'Branch', 'branch') || '').trim();
      const lo       = String(getField(row, 'Loan Officer', 'loan officer', 'Loan Officers', 'loan officers') || '').trim();
      const stage    = String(getField(row, 'Stage', 'stage') || '').trim();
      const oppCd    = parseDate(getField(row, 'Created Date', 'created date', 'create date'));
      const disbDate = parseDate(getField(row, 'Disbursement Date', 'disbursement date'));
      const ratDate  = parseDate(getField(row, 'Ratified Date', 'ratified date'));
      const paDate   = parseDate(getField(row, 'Pre-Approved Date', 'pre-approved date', 'pre approved date'));
      let lastReachedDate, lastReachedStage;
      if (stage.toLowerCase() === 'closed won' && disbDate) { lastReachedDate = disbDate; lastReachedStage = 'Closed Won'; }
      else if (ratDate) { lastReachedDate = ratDate; lastReachedStage = 'Ratified'; }
      else if (paDate)  { lastReachedDate = paDate;  lastReachedStage = 'Pre-Approval'; }
      else              { lastReachedDate = null;     lastReachedStage = '—'; }
      return [lnNum, fmtDate(oppCd), oppName, oppOwner, branch, lo, stage, fmtDate(lastReachedDate), lastReachedStage];
    })
  ];

  openModal(realtorName + ' — Full Profile', sub, '', bodyHtml, csvData);
}
