import { SB_URL, SB_KEY } from './config.js';
import { getField, parseDate, fmtDB } from './utils.js';

export async function sbFetch(path, opts = {}) {
  const headers = {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json'
  };
  if (opts.prefer) headers['Prefer'] = opts.prefer;
  const res = await fetch(SB_URL + '/rest/v1/' + path, {
    ...opts,
    headers: { ...headers, ...(opts.headers || {}) }
  });
  if (!res.ok) {
    const e = await res.text();
    let msg = e;
    try { const j = JSON.parse(e); msg = j.message || j.error || e; } catch (_) {}
    throw new Error(msg || 'HTTP ' + res.status);
  }
  const text = await res.text();
  if (!text || text.trim() === '') return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

export async function uploadToSupabase(type, data, fileName, { onProgress = () => {}, onStatus = () => {} } = {}) {
  const tbl = type === 'leads' ? 'leads' : 'opportunities';
  try {
    await sbFetch(tbl + '?id=neq.0', { method: 'DELETE', prefer: 'return=minimal', headers: { 'Prefer': 'return=minimal' } });
  } catch (e) {
    console.log('Delete note:', e.message);
  }
  onProgress(type, 30);
  const rows = data.map(row => {
    if (type === 'leads') return {
      referred_by: getField(row, 'Referred By', 'referred by') || null,
      lead_owner: String(getField(row, 'Lead Owner', 'lead owner', 'owner') || '').trim() || null,
      branch: String(getField(row, 'Branch', 'branch') || '').trim() || null,
      create_date: fmtDB(parseDate(getField(row, 'Created Date', 'Create Date', 'created date', 'create date'))),
      first_name: String(getField(row, 'First Name', 'first name') || '').trim() || null,
      last_name: String(getField(row, 'Last Name', 'last name') || '').trim() || null,
      lead_status: String(getField(row, 'Lead Status', 'lead status') || '').trim() || null
    };
    return {
      referred_by: getField(row, 'Referred By', 'referred by') || null,
      stage: String(getField(row, 'Stage', 'stage') || '').trim() || null,
      disbursement_date: fmtDB(parseDate(getField(row, 'Disbursement Date', 'disbursement date'))),
      pre_approved_date: fmtDB(parseDate(getField(row, 'Pre-Approved Date', 'pre-approved date', 'pre approved date'))),
      ratified_date: fmtDB(parseDate(getField(row, 'Ratified Date', 'ratified date'))),
      opportunity_owner: String(getField(row, 'Opportunity Owner', 'opportunity owner') || '').trim() || null,
      opportunity_name: String(getField(row, 'Opportunity Name', 'opportunity name') || '').trim() || null,
      loan_number: String(getField(row, 'Loan #', 'loan #') || '').trim() || null,
      loan_officer: String(getField(row, 'Loan Officers', 'Loan Officer', 'loan officers', 'loan officer') || '').trim() || null,
      loan_amount: getField(row, 'Loan Amount', 'loan amount') || null,
      branch: String(getField(row, 'Branch', 'branch') || '').trim() || null,
      created_date: fmtDB(parseDate(getField(row, 'Created Date', 'created date')))
    };
  }).filter(r => r.referred_by);
  onProgress(type, 50);
  const batchSize = 200;
  const totalBatches = Math.ceil(rows.length / batchSize);
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    onStatus('load', '⏳ Uploading ' + type + ': batch ' + batchNum + ' of ' + totalBatches + ' (' + rows.length + ' rows)...');
    try {
      await sbFetch(tbl, { method: 'POST', prefer: 'return=minimal', body: JSON.stringify(batch) });
    } catch (e) {
      throw new Error('Error in batch ' + batchNum + ': ' + e.message);
    }
    onProgress(type, 50 + Math.round((i / rows.length) * 45));
  }
  await sbFetch('upload_meta?file_type=eq.' + type, { method: 'DELETE', prefer: 'return=minimal' });
  await sbFetch('upload_meta', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ file_type: type, file_name: fileName, row_count: rows.length }) });
  onProgress(type, 95);
}

export async function loadDataFromSupabase({ onStatus = () => {} } = {}) {
  onStatus('load', '⏳ Querying Supabase...');
  async function fetchAll(table) {
    const all = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const page = await sbFetch(table + '?select=*&limit=' + pageSize + '&offset=' + from + '&order=id.asc');
      if (!page || !page.length) break;
      all.push(...page);
      onStatus('load', '⏳ Loading ' + table + ': ' + all.length + ' rows...');
      if (page.length < pageSize) break;
      from += pageSize;
    }
    return all;
  }
  const [leads, opps] = await Promise.all([fetchAll('leads'), fetchAll('opportunities')]);
  onStatus('load', '⏳ Processing ' + leads.length + ' leads and ' + opps.length + ' opportunities...');
  const leadsData = leads.map(r => ({
    'Referred By': r.referred_by, 'Lead Owner': r.lead_owner, 'Branch': r.branch,
    'Created Date': r.create_date, 'Create Date': r.create_date,
    'First Name': r.first_name, 'Last Name': r.last_name, 'Lead Status': r.lead_status
  }));
  const oppData = opps.map(r => ({
    'Referred By': r.referred_by, 'Stage': r.stage,
    'Disbursement Date': r.disbursement_date, 'Pre-Approved Date': r.pre_approved_date,
    'Ratified Date': r.ratified_date, 'Opportunity Owner': r.opportunity_owner,
    'Opportunity Name': r.opportunity_name, 'Loan #': r.loan_number,
    'Loan Officer': r.loan_officer, 'Loan Amount': r.loan_amount, 'Branch': r.branch,
    'Created Date': r.created_date
  }));
  return { leadsData, oppData };
}
