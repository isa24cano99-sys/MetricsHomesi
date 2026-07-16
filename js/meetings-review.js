import { state } from './state.js';
import { norm, getField, parseDate } from './utils.js';
import { sbFetch } from './supabase.js';

function parseZoomTime(s) {
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  return null;
}

function _maxLeadDate(leads) {
  let max = null;
  for (const row of leads) {
    const d = parseDate(getField(row, 'Created Date', 'created date', 'Create Date', 'create date'));
    if (d && (!max || d > max)) max = d;
  }
  return max;
}

function _fmtLeadDate(d) {
  if (!d) return '';
  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return MO[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

// Returns { level: 'exact'|'partial'|'none', count, lastDate, ownerMatch, leads, matchedName? }
function findRealtorMatch(participantName, hostName) {
  const SKIP = new Set(['de','la','el','the','del','las','los','y','e','a','of','en']);
  const sigWords = n => norm(n).split(/\s+/).filter(w => w.length >= 3 && !SKIP.has(w));
  const nPart = norm(participantName);
  const nHost = norm(hostName || '');
  const leads = state.leadsData || [];

  const exactLeads = leads.filter(row =>
    norm(String(getField(row, 'Referred By', 'referred by') || '').trim()) === nPart
  );
  if (exactLeads.length) {
    const ownerMatch = exactLeads.some(row =>
      norm(String(getField(row, 'Lead Owner', 'lead owner') || '').trim()) === nHost
    );
    return { level: 'exact', leads: exactLeads, count: exactLeads.length, lastDate: _maxLeadDate(exactLeads), ownerMatch };
  }

  const partWords = sigWords(participantName);
  if (partWords.length >= 2) {
    const refGroups = new Map();
    for (const row of leads) {
      const ref = String(getField(row, 'Referred By', 'referred by') || '').trim();
      if (!ref) continue;
      const nRef = norm(ref);
      if (!refGroups.has(nRef)) refGroups.set(nRef, { leads: [], originalName: ref });
      refGroups.get(nRef).leads.push(row);
    }
    for (const { leads: rLeads, originalName } of refGroups.values()) {
      const refWords = sigWords(originalName);
      if (partWords.filter(w => refWords.includes(w)).length >= 2) {
        const ownerMatch = rLeads.some(row =>
          norm(String(getField(row, 'Lead Owner', 'lead owner') || '').trim()) === nHost
        );
        return { level: 'partial', leads: rLeads, count: rLeads.length, lastDate: _maxLeadDate(rLeads), ownerMatch, matchedName: originalName };
      }
    }
  }

  return { level: 'none' };
}

/*
  Supabase table required:
  CREATE TABLE meeting_participants_review (
    id BIGSERIAL PRIMARY KEY,
    participant_name TEXT NOT NULL,
    participant_email TEXT,
    meeting_id TEXT NOT NULL,
    meeting_date DATE,
    host_name TEXT,
    is_realtor BOOLEAN,
    reviewed_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(participant_name, meeting_id)
  );
*/

// key: "participantName|meetingId" → { isRealtor: bool, confirmedRealtorName: string|null }
// confirmedRealtorName: null = not decided, '' = denied (different person), 'Name' = confirmed match
const _reviewData = new Map();

let _delegationSetup = false;
function setupDelegation() {
  if (_delegationSetup) return;
  _delegationSetup = true;
  document.addEventListener('click', e => {
    const markBtn = e.target.closest('[data-mr-action="mark-participant"]');
    if (markBtn) {
      const name      = markBtn.dataset.participant || '';
      const email     = markBtn.dataset.email || '';
      const host      = markBtn.dataset.host || '';
      const meetingId = markBtn.dataset.meetingId || '';
      const date      = markBtn.dataset.date || '';
      const isRealtor = markBtn.dataset.isRealtor === 'true';
      markMeetingParticipant(name, email, host, meetingId, date, isRealtor);
      return;
    }
    const confirmBtn = e.target.closest('[data-mr-action="confirm-match"]');
    if (confirmBtn) {
      const name          = confirmBtn.dataset.participant || '';
      const email         = confirmBtn.dataset.email || '';
      const host          = confirmBtn.dataset.host || '';
      const meetingId     = confirmBtn.dataset.meetingId || '';
      const date          = confirmBtn.dataset.date || '';
      const confirmedName = confirmBtn.dataset.confirmedName; // '' = denied, 'Name' = confirmed
      markMeetingParticipant(name, email, host, meetingId, date, true, confirmedName);
      return;
    }
    const dncBtn = e.target.closest('[data-mr-action="toggle-no-count"]');
    if (dncBtn) {
      const currentValue = dncBtn.dataset.current === 'true';
      toggleDoesNotCount(dncBtn.dataset.meetingId || '', dncBtn.dataset.host || '', currentValue);
    }
  });
}

export async function loadMeetingReviews() {
  try {
    const rows = await sbFetch('meeting_participants_review?select=participant_name,meeting_id,is_realtor,confirmed_realtor_name,does_not_count');
    _reviewData.clear();
    state.doNotCountMeetings = new Set();
    for (const r of (rows || [])) {
      if (r.participant_name === '_meeting_') {
        if (r.does_not_count) state.doNotCountMeetings.add(r.meeting_id || '');
      } else {
        _reviewData.set(
          (r.participant_name || '') + '|' + (r.meeting_id || ''),
          { isRealtor: r.is_realtor, confirmedRealtorName: r.confirmed_realtor_name ?? null }
        );
      }
    }
  } catch (_) {}
}

export async function markMeetingParticipant(name, email, host, meetingId, date, isRealtor, confirmedRealtorName) {
  const key = name + '|' + meetingId;
  const existing = _reviewData.get(key) || {};
  const newConfirmed = confirmedRealtorName !== undefined ? confirmedRealtorName : (existing.confirmedRealtorName ?? null);
  _reviewData.set(key, { isRealtor, confirmedRealtorName: newConfirmed });
  try {
    const body = {
      participant_name: name,
      participant_email: email || null,
      meeting_id: meetingId,
      meeting_date: date || null,
      host_name: host || null,
      is_realtor: isRealtor
    };
    if (confirmedRealtorName !== undefined) {
      // '' = denied (different person), 'Name' = confirmed, null cleared
      body.confirmed_realtor_name = confirmedRealtorName === '' ? null : (confirmedRealtorName || null);
    }
    const result = await sbFetch('meeting_participants_review?on_conflict=participant_name,meeting_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(body)
    });
    console.log('[MR] saved:', result);
  } catch (e) {
    console.warn('[markMeetingParticipant] error:', e.message);
  }
  renderMeetingsReview();
}

export async function toggleDoesNotCount(meetingId, hostName, currentValue) {
  console.log('[MR] markDoesNotCount called:', meetingId, hostName, currentValue);
  const newVal = !currentValue;
  if (!state.doNotCountMeetings) state.doNotCountMeetings = new Set();
  if (newVal) { state.doNotCountMeetings.add(meetingId); } else { state.doNotCountMeetings.delete(meetingId); }
  try {
    const body = { participant_name: '_meeting_', meeting_id: meetingId, host_name: hostName || null, does_not_count: newVal, is_realtor: null };
    const result = await sbFetch('meeting_participants_review?on_conflict=participant_name,meeting_id', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(body)
    });
    console.log('[MR] toggleDNC result:', result);
  } catch (e) {
    console.warn('[toggleDNC] error:', e.message);
    if (newVal) { state.doNotCountMeetings.delete(meetingId); } else { state.doNotCountMeetings.add(meetingId); }
  }
  renderMeetingsReview();
}

export function initMeetingsReview() {
  setupDelegation();
  const yearSel  = document.getElementById('mr-year');
  const monthSel = document.getElementById('mr-month');
  const hostSel  = document.getElementById('mr-host');
  if (!yearSel) return;

  // BD owners from the owners-list textarea — used to filter hosts
  const allowedOwners = (document.getElementById('owners-list') || { value: '' }).value
    .split(',').map(s => s.trim()).filter(s => s !== '');
  const ownersNorm = new Set(allowedOwners.map(o => norm(o)));

  console.log('[MR] allowed owners:', allowedOwners);
  console.log('[MR] allowed norm set:', [...ownersNorm]);
  console.log('[MR] unique hosts in zoomData:', [...new Set((state.zoomData || []).map(r => r.host_name))]);
  console.log('[MR] hosts that pass filter:', [...new Set((state.zoomData || []).map(r => r.host_name))].filter(h => ownersNorm.has(norm(h?.trim() || ''))));

  const MS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const yearsSet  = new Set();
  const monthsSet = new Set();
  const hostsSet  = new Set();
  for (const r of (state.zoomData || [])) {
    if (r.month_key) {
      yearsSet.add(Number(r.month_key.slice(0, 4)));
      monthsSet.add(r.month_key.slice(5, 7));
    }
    if (r.host_name && ownersNorm.has(norm(r.host_name.trim()))) hostsSet.add(r.host_name.trim());
  }

  const prevYear = yearSel.value;
  yearSel.innerHTML = '<option value="">All Years</option>' +
    [...yearsSet].sort((a, b) => b - a).map(y => '<option value="' + y + '"' + (String(y) === prevYear ? ' selected' : '') + '>' + y + '</option>').join('');

  const prevMonth = monthSel.value;
  monthSel.innerHTML = '<option value="">All Months</option>' +
    [...monthsSet].sort().map(mm => {
      const label = MS_FULL[parseInt(mm, 10) - 1] || mm;
      return '<option value="' + mm + '"' + (mm === prevMonth ? ' selected' : '') + '>' + label + '</option>';
    }).join('');

  const filteredHosts = [...hostsSet].sort();
  console.log('[MR] populating selector with:', filteredHosts);

  const prevHost = hostSel.value;
  hostSel.innerHTML = '<option value="">All BDs</option>' +
    filteredHosts.map(h => '<option value="' + h + '"' + (h === prevHost ? ' selected' : '') + '>' + h + '</option>').join('');

  renderMeetingsReview();
}

export function clearMrFilters() {
  const yearSel  = document.getElementById('mr-year');
  const monthSel = document.getElementById('mr-month');
  const hostSel  = document.getElementById('mr-host');
  if (yearSel)  yearSel.value  = '';
  if (monthSel) monthSel.value = '';
  if (hostSel)  hostSel.value  = '';
  renderMeetingsReview();
}

export function renderMeetingsReview() {
  const content = document.getElementById('mr-content');
  if (!content) return;

  const yearVal  = (document.getElementById('mr-year')  || {}).value || '';
  const monthVal = (document.getElementById('mr-month') || {}).value || '';
  const hostVal  = (document.getElementById('mr-host')  || {}).value || '';

  // Always restrict to BD owners — same parsing as initMeetingsReview
  const allowedOwners = (document.getElementById('owners-list') || { value: '' }).value
    .split(',').map(s => s.trim()).filter(s => s !== '');
  const ownersNorm = new Set(allowedOwners.map(o => norm(o)));

  // Build per-meeting groups from zoomData
  const meetingMap = new Map();
  for (const r of (state.zoomData || [])) {
    // Base filter: host must be a BD in the allowed list
    if (!ownersNorm.has(norm((r.host_name || '').trim()))) continue;

    const mk = r.month_key || '';
    if (yearVal  && mk.slice(0, 4) !== yearVal)  continue;
    if (monthVal && mk.slice(5, 7) !== monthVal) continue;
    if (hostVal  && (r.host_name || '').trim() !== hostVal) continue;

    const key = (r.meeting_id || '') + '|' + mk + '|' + (r.start_time || '');
    if (!meetingMap.has(key)) {
      meetingMap.set(key, {
        meeting_id: r.meeting_id || '',
        host_name: (r.host_name || '').trim(),
        host_email: (r.host_email || '').trim(),
        start_time: parseZoomTime(r.start_time),
        duration: r.duration_minutes,
        topic: (r.topic || '').trim() || null,
        rows: []
      });
    }
    meetingMap.get(key).rows.push(r);
  }

  if (!meetingMap.size) {
    content.innerHTML = '<div class="empty-state">No meetings found for the selected filters.</div>';
    return;
  }

  // Keep only meetings that have at least one external participant (is_guest === 'Yes')
  // Sort meetings by date descending
  const meetings = [...meetingMap.values()]
    .filter(m => m.rows.some(r => r.is_guest === 'Yes'))
    .sort((a, b) => (b.start_time || 0) - (a.start_time || 0));

  const MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const doNotCount = state.doNotCountMeetings || new Set();
  const rendered = meetings.map(m => {
    const isDNC = doNotCount.has(m.meeting_id);
    const dateStr = m.start_time
      ? MS[m.start_time.getMonth()] + ' ' + m.start_time.getDate() + ', ' + m.start_time.getFullYear()
      : '—';
    const timeStr = (() => {
      if (!m.start_time) return '';
      const h = m.start_time.getHours(), mi = String(m.start_time.getMinutes()).padStart(2, '0');
      return (h % 12 || 12) + ':' + mi + ' ' + (h >= 12 ? 'PM' : 'AM');
    })();

    const participants = m.rows.filter(r => r.participant_name && r.participant_name.trim());
    const isGuest = p => p.is_guest === 'Yes';
    const nHost = norm(m.host_name);

    const isLoParticipant = p => {
      const nn = norm(p.participant_name || '');
      return state.loReferenceMap.has(nn);
    };

    const internals = participants.filter(p => !isGuest(p));
    const rawExternals = participants.filter(p => isGuest(p));

    // Deduplicate externals: device entries like "Mariano's Z Fold6" collapse into clean name
    const DEVICE_WORDS = ['iphone', 'ipad', 'android', 'fold', 'samsung', 'pixel', 'tablet', 'galaxy'];
    const hasDeviceWord = n => { const nn = norm(n); return DEVICE_WORDS.some(w => nn.includes(w)); };
    const extNameKey = n => norm(n.trim().split(/\s+/)[0].replace(/[’']s$/i, '').replace(/[’']/g, ''));
    const extDeduped = [];
    const extSeen = new Map();
    for (const p of rawExternals) {
      const n = (p.participant_name || '').trim();
      const key = extNameKey(n);
      if (!extSeen.has(key)) {
        extSeen.set(key, extDeduped.length);
        extDeduped.push(p);
      } else {
        const idx = extSeen.get(key);
        if (hasDeviceWord((extDeduped[idx].participant_name || '').trim()) && !hasDeviceWord(n)) {
          extDeduped[idx] = p; // replace device entry with clean name
        }
      }
    }
    const externals = extDeduped;

    const renderInternalParticipant = p => {
      const name = (p.participant_name || '').trim();
      const email = (p.participant_email || '').trim();
      const isLO = isLoParticipant(p);
      const isHost = norm(name) === nHost;
      const badge = isLO
        ? '<span class="mr-badge-lo">LO</span>'
        : '<span class="mr-badge-internal">Internal</span>';
      const hostTag = isHost ? '<span class="mr-badge-internal" style="background:#E8EEF8;color:#334466">Host</span>' : '';
      return '<div class="mr-participant">' +
        '<span class="mr-participant-name">' + escHtml(name) + (email ? ' <span class="mr-participant-email">' + escHtml(email) + '</span>' : '') + '</span>' +
        '<span style="display:flex;gap:4px;align-items:center">' + hostTag + badge + '</span>' +
        '</div>';
    };

    const renderExternalParticipant = p => {
      const name = (p.participant_name || '').trim();
      const email = (p.participant_email || '').trim();
      const reviewKey = name + '|' + m.meeting_id;
      const reviewed = _reviewData.has(reviewKey);
      const reviewEntry = reviewed ? (_reviewData.get(reviewKey) || {}) : {};
      const isRealtor = reviewed ? reviewEntry.isRealtor : undefined;
      const confirmedRealtorName = reviewed ? reviewEntry.confirmedRealtorName : undefined;

      let status = '';
      if (reviewed && isRealtor === true)  status = '<span class="mr-status-realtor">&#10003; Realtor</span>';
      if (reviewed && isRealtor === false) status = '<span class="mr-status-not">&#10007; Not Realtor</span>';

      // Pipeline chip — hidden only when explicitly marked not-realtor
      let pipelineRow = '';
      if (!(reviewed && isRealtor === false)) {
        const match = findRealtorMatch(name, m.host_name);
        const mDateP = m.start_time
          ? m.start_time.getFullYear() + '-' + String(m.start_time.getMonth() + 1).padStart(2, '0') + '-' + String(m.start_time.getDate()).padStart(2, '0')
          : '';
        const confirmBase =
          ' data-participant="' + escHtml(name) + '"' +
          ' data-email="' + escHtml(email) + '"' +
          ' data-host="' + escHtml(m.host_name) + '"' +
          ' data-meeting-id="' + escHtml(m.meeting_id) + '"' +
          ' data-date="' + escHtml(mDateP) + '"';

        let chip = '';
        if (confirmedRealtorName) {
          // Confirmed partial match — look up leads for that name
          const cLeads = (state.leadsData || []).filter(row =>
            norm(String(getField(row, 'Referred By', 'referred by') || '').trim()) === norm(confirmedRealtorName)
          );
          const count = cLeads.length;
          const dateLabel = _fmtLeadDate(_maxLeadDate(cLeads));
          const tip = 'Confirmed match: ' + confirmedRealtorName + (count ? ' · ' + count + ' leads' : '') + (dateLabel ? ' · Last: ' + dateLabel : '');
          chip = '<span class="mr-chip-pipeline mr-chip-pipeline-strong" title="' + escHtml(tip) + '">&#10003; In pipeline · ' + count + ' lead' + (count !== 1 ? 's' : '') + '</span>';

        } else if (confirmedRealtorName === '') {
          // Explicitly denied partial match
          chip = '<span class="mr-chip-nopipeline">Not in pipeline</span>';

        } else if (match.level === 'exact') {
          const tip = match.ownerMatch ? 'Exact name match + BD matches host' : 'Exact name match in pipeline';
          const cls = match.ownerMatch ? 'mr-chip-pipeline mr-chip-pipeline-strong' : 'mr-chip-pipeline';
          const countStr = match.count + ' lead' + (match.count !== 1 ? 's' : '');
          chip = '<span class="' + cls + '" title="' + escHtml(tip) + '">&#10003; In pipeline · ' + countStr + (match.ownerMatch ? ' · same BD' : '') + '</span>';

        } else if (match.level === 'partial') {
          const tip = match.ownerMatch ? 'Partial name match + BD matches host' : 'Partial name match found in pipeline';
          const cls = match.ownerMatch ? 'mr-chip-partial mr-chip-partial-strong' : 'mr-chip-partial';
          const countStr = match.count + ' lead' + (match.count !== 1 ? 's' : '');
          const label = '~ Possible match: ' + escHtml(match.matchedName) + ' · ' + countStr + (match.ownerMatch ? ' · same BD' : '');
          const cAttrs = confirmBase + ' data-confirmed-name="' + escHtml(match.matchedName) + '"';
          const dAttrs = confirmBase + ' data-confirmed-name=""';
          const confirmBtns =
            '<div style="margin-top:3px;display:flex;gap:4px">' +
            '<button class="mr-btn mr-btn-confirm-match" data-mr-action="confirm-match"' + cAttrs + '>&#10003; Same person</button>' +
            '<button class="mr-btn mr-btn-deny-match" data-mr-action="confirm-match"' + dAttrs + '>&#10007; Different person</button>' +
            '</div>';
          chip = '<span class="' + cls + '" title="' + escHtml(tip) + '">' + label + '</span>' + confirmBtns;

        } else if (reviewed && isRealtor === true) {
          // Exact no-match and already marked as realtor
          chip = '<span class="mr-chip-nopipeline">Not in pipeline</span>';
        }

        if (chip) pipelineRow = '<div class="mr-pipeline-row">' + chip + '</div>';
      }

      const mDate = m.start_time
        ? m.start_time.getFullYear() + '-' + String(m.start_time.getMonth() + 1).padStart(2, '0') + '-' + String(m.start_time.getDate()).padStart(2, '0')
        : '';
      const dataAttrs =
        ' data-mr-action="mark-participant"' +
        ' data-participant="' + escHtml(name) + '"' +
        ' data-email="' + escHtml(email) + '"' +
        ' data-host="' + escHtml(m.host_name) + '"' +
        ' data-meeting-id="' + escHtml(m.meeting_id) + '"' +
        ' data-date="' + escHtml(mDate) + '"';

      let actions;
      if (reviewed && isRealtor === true) {
        actions = '<button class="mr-btn mr-btn-secondary"' + dataAttrs + ' data-is-realtor="false">&#10007; Mark as Not Realtor</button>';
      } else if (reviewed && isRealtor === false) {
        actions = '<button class="mr-btn mr-btn-secondary"' + dataAttrs + ' data-is-realtor="true">&#10003; Mark as Realtor</button>';
      } else {
        actions = '<button class="mr-btn mr-btn-realtor"' + dataAttrs + ' data-is-realtor="true">&#10003; Realtor</button>' +
                  '<button class="mr-btn mr-btn-not"' + dataAttrs + ' data-is-realtor="false">&#10007; Not Realtor</button>';
      }

      return '<div class="mr-participant">' +
        '<div class="mr-participant-top">' +
          '<span class="mr-participant-name">' + escHtml(name) + (email ? ' <span class="mr-participant-email">' + escHtml(email) + '</span>' : '') + '</span>' +
          '<span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' + status + '<span class="mr-participant-actions">' + actions + '</span></span>' +
        '</div>' +
        pipelineRow +
        '</div>';
    };

    const dncStyle = 'font-size:10px;font-weight:600;border:1.5px solid ' +
      (isDNC ? '#D4A000' : '#D0DAF0') + ';border-radius:5px;padding:2px 8px;cursor:pointer;background:' +
      (isDNC ? '#FFFBEB' : 'white') + ';color:' + (isDNC ? '#854D0E' : '#8899BB') + ';white-space:nowrap;flex-shrink:0';
    const dncBtnHtml = '<button data-mr-action="toggle-no-count" data-meeting-id="' + escHtml(m.meeting_id) +
      '" data-host="' + escHtml(m.host_name) + '" data-current="' + isDNC + '" style="' + dncStyle + '">' +
      (isDNC ? '&#8856; No cuenta' : '&#8856; Marcar &ldquo;No cuenta&rdquo;') + '</button>';
    const cardHtml = '<div class="mr-card" style="' + (isDNC ? 'border-color:#E8D59A' : '') + '">' +
      '<div class="mr-card-header">' +
        (m.topic ? '<div class="mr-card-topic">' + escHtml(m.topic) + '</div>' : '') +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
          '<div class="mr-card-meta">' +
            '<span class="mr-meta-date">' + escHtml(dateStr) + '</span>' +
            (timeStr ? ' <span class="mr-meta-time">' + escHtml(timeStr) + '</span>' : '') +
            ' &nbsp;·&nbsp; <span class="mr-meta-host">' + escHtml(m.host_name) + '</span>' +
            (m.duration ? ' &nbsp;·&nbsp; <span class="mr-meta-duration">' + m.duration + ' min</span>' : '') +
            ' &nbsp;·&nbsp; <span class="mr-meta-count">' + participants.length + ' participant' + (participants.length !== 1 ? 's' : '') + '</span>' +
          '</div>' +
          dncBtnHtml +
        '</div>' +
      '</div>' +
      (internals.length
        ? '<div class="mr-section">' +
            '<div class="mr-section-title">Internal Participants</div>' +
            '<div class="mr-participants-list">' + internals.map(renderInternalParticipant).join('') + '</div>' +
          '</div>'
        : '') +
      (externals.length
        ? '<div class="mr-section">' +
            '<div class="mr-section-title">External Participants</div>' +
            '<div class="mr-participants-list">' + externals.map(renderExternalParticipant).join('') + '</div>' +
          '</div>'
        : '') +
    '</div>';
    return { isDNC, html: cardHtml };
  });

  const activeHtml = rendered.filter(r => !r.isDNC).map(r => r.html).join('');
  const dncItems   = rendered.filter(r =>  r.isDNC);
  const dncSectionHtml = dncItems.length
    ? '<details style="margin-top:16px"><summary style="cursor:pointer;font-size:12px;font-weight:700;color:#854D0E;padding:6px 2px;list-style:none;display:flex;align-items:center;gap:6px;user-select:none"><span>&#9654;</span> Follow-up meetings (not counted) &mdash; ' + dncItems.length + '</summary><div style="margin-top:8px">' + dncItems.map(r => r.html).join('') + '</div></details>'
    : '';

  content.innerHTML = activeHtml + dncSectionHtml;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
