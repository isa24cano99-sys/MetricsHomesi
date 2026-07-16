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

const _reviewData = new Map(); // key: "participantName|meetingId" → { is_realtor }

export async function loadMeetingReviews() {
  try {
    const rows = await sbFetch('meeting_participants_review?select=participant_name,meeting_id,is_realtor');
    _reviewData.clear();
    for (const r of (rows || [])) {
      _reviewData.set((r.participant_name || '') + '|' + (r.meeting_id || ''), r.is_realtor);
    }
  } catch (_) {}
}

export async function markMeetingParticipant(name, email, host, meetingId, date, isRealtor) {
  const key = name + '|' + meetingId;
  _reviewData.set(key, isRealtor);
  try {
    await sbFetch('meeting_participants_review?on_conflict=participant_name,meeting_id', {
      method: 'POST',
      prefer: 'return=minimal,resolution=merge-duplicates',
      headers: { 'Prefer': 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify({
        participant_name: name,
        participant_email: email || null,
        meeting_id: meetingId,
        meeting_date: date || null,
        host_name: host || null,
        is_realtor: isRealtor
      })
    });
  } catch (e) {
    console.warn('[markMeetingParticipant] error:', e.message);
  }
  renderMeetingsReview();
}

export function initMeetingsReview() {
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

  const prevHost = hostSel.value;
  hostSel.innerHTML = '<option value="">All BDs</option>' +
    [...hostsSet].sort().map(h => '<option value="' + h + '"' + (h === prevHost ? ' selected' : '') + '>' + h + '</option>').join('');

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

  // Build per-meeting groups from zoomData
  const meetingMap = new Map();
  for (const r of (state.zoomData || [])) {
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

  const html = meetings.map(m => {
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
    const externals  = participants.filter(p => isGuest(p));

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
      const isRealtor = _reviewData.get(reviewKey);

      let status = '';
      if (reviewed && isRealtor)  status = '<span class="mr-status-realtor">&#10003; Realtor</span>';
      if (reviewed && !isRealtor) status = '<span class="mr-status-not">&#10007; Not Realtor</span>';

      // Pipeline lookup — only when confirmed as realtor
      let pipelineChip = '';
      if (reviewed && isRealtor) {
        const nName = norm(name);
        const matchingLeads = (state.leadsData || []).filter(row => {
          const ref = String(getField(row, 'Referred By', 'referred by') || '').trim();
          return norm(ref) === nName;
        });
        if (matchingLeads.length) {
          const allTimeCount = matchingLeads.length;
          let maxDate = null;
          for (const row of matchingLeads) {
            const d = parseDate(getField(row, 'Created Date', 'created date', 'Create Date', 'create date'));
            if (d && (!maxDate || d > maxDate)) maxDate = d;
          }
          const bdOwner = (state.masterMap.get(nName) || {}).owner || '';
          const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const dateLabel = maxDate ? MO[maxDate.getMonth()] + ' ' + maxDate.getDate() + ', ' + maxDate.getFullYear() : '';
          const tip = allTimeCount + ' lead' + (allTimeCount !== 1 ? 's' : '') +
            (dateLabel ? ' · Last: ' + dateLabel : '') +
            (bdOwner ? ' · BD: ' + bdOwner : '');
          pipelineChip = '<span class="mr-chip-pipeline" title="' + escHtml(tip) + '">In pipeline &#10003;</span>';
        } else {
          pipelineChip = '<span class="mr-chip-nopipeline">Not in pipeline</span>';
        }
      }

      const mId = JSON.stringify(m.meeting_id);
      const mDate = m.start_time
        ? m.start_time.getFullYear() + '-' + String(m.start_time.getMonth() + 1).padStart(2, '0') + '-' + String(m.start_time.getDate()).padStart(2, '0')
        : '';
      const safeN = JSON.stringify(name);
      const safeE = JSON.stringify(email);
      const safeH = JSON.stringify(m.host_name);

      const actions = reviewed
        ? '<button class="mr-btn" onclick="markMeetingParticipant(' + safeN + ',' + safeE + ',' + safeH + ',' + mId + ',' + JSON.stringify(mDate) + ',true)" title="Mark as Realtor">&#10003; Realtor</button>' +
          '<button class="mr-btn" onclick="markMeetingParticipant(' + safeN + ',' + safeE + ',' + safeH + ',' + mId + ',' + JSON.stringify(mDate) + ',false)" title="Not a Realtor">&#10007; Not</button>'
        : '<button class="mr-btn mr-btn-realtor" onclick="markMeetingParticipant(' + safeN + ',' + safeE + ',' + safeH + ',' + mId + ',' + JSON.stringify(mDate) + ',true)">&#10003; Realtor</button>' +
          '<button class="mr-btn mr-btn-not" onclick="markMeetingParticipant(' + safeN + ',' + safeE + ',' + safeH + ',' + mId + ',' + JSON.stringify(mDate) + ',false)">&#10007; Not Realtor</button>';

      return '<div class="mr-participant">' +
        '<span class="mr-participant-name">' + escHtml(name) + (email ? ' <span class="mr-participant-email">' + escHtml(email) + '</span>' : '') + '</span>' +
        '<span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' + status + pipelineChip + '<span class="mr-participant-actions">' + actions + '</span></span>' +
        '</div>';
    };

    return '<div class="mr-card">' +
      '<div class="mr-card-header">' +
        (m.topic ? '<div class="mr-card-topic">' + escHtml(m.topic) + '</div>' : '') +
        '<div class="mr-card-meta">' +
          '<span class="mr-meta-date">' + escHtml(dateStr) + '</span>' +
          (timeStr ? ' <span class="mr-meta-time">' + escHtml(timeStr) + '</span>' : '') +
          ' &nbsp;·&nbsp; <span class="mr-meta-host">' + escHtml(m.host_name) + '</span>' +
          (m.duration ? ' &nbsp;·&nbsp; <span class="mr-meta-duration">' + m.duration + ' min</span>' : '') +
          ' &nbsp;·&nbsp; <span class="mr-meta-count">' + participants.length + ' participant' + (participants.length !== 1 ? 's' : '') + '</span>' +
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
  }).join('');

  content.innerHTML = html;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
