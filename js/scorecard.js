function renderScorecard(owners) {
  const cats = Object.keys(BADGE).filter(k => k !== 'Inactive');

  // Populate filter selects preserving current selections
  const medEl = document.getElementById('sc-filter-med');
  const ownEl = document.getElementById('sc-filter-own');
  const prevMeds = Array.from(medEl.selectedOptions).map(o => o.value);
  const prevOwns = Array.from(ownEl.selectedOptions).map(o => o.value);

  medEl.innerHTML = cats.map(c => '<option value="' + c + '">' + c + '</option>').join('');
  ownEl.innerHTML = owners.map(o => '<option value="' + o + '">' + o + '</option>').join('');

  Array.from(medEl.options).forEach(o => { if (prevMeds.includes(o.value)) o.selected = true; });
  Array.from(ownEl.options).forEach(o => { if (prevOwns.includes(o.value)) o.selected = true; });

  // Read active selections
  const scMeds = Array.from(medEl.selectedOptions).map(o => o.value).filter(Boolean);
  const scOwns = Array.from(ownEl.selectedOptions).map(o => o.value).filter(Boolean);

  const filtOwners = scOwns.length ? owners.filter(o => scOwns.includes(o)) : owners;

  document.getElementById('scorecard-grid').innerHTML = filtOwners.map(owner => {
    const mine = activeResults.filter(r => r.assignedOwner === owner);
    if (!mine.length) return '';
    const rows = cats
      .filter(c => !scMeds.length || scMeds.includes(c))
      .map(c => {
        const n = mine.filter(r => r.med === c).length;
        return n ? '<div class="sc-row"><span class="sc-cat">' + c + '</span><span class="sc-num clickable-num" data-owner="' + owner + '" data-med="' + c + '" title="View realtors">' + n + '</span></div>' : '';
      }).join('');
    if (!rows) return '';
    return '<div class="sc-card">' +
      '<div class="sc-head">' +
        '<div class="sc-avatar">' + initials(owner) + '</div>' +
        '<span class="sc-name">' + owner + '</span>' +
        '<span class="sc-total">' + mine.length + '</span>' +
      '</div>' +
      '<div class="sc-body">' + rows + '</div>' +
    '</div>';
  }).join('');
}

function refreshScorecard() {
  const owners = document.getElementById('owners-list').value.split(',').map(s => s.trim()).filter(Boolean);
  renderScorecard(owners);
}

document.addEventListener('click', function (e) {
  const el = e.target.closest('[data-owner][data-med]');
  if (!el) return;
  showScorecardDetail(el.getAttribute('data-owner'), el.getAttribute('data-med'));
});

function clearScorecardFilters() {
  Array.from(document.getElementById('sc-filter-med').options).forEach(o => o.selected = false);
  Array.from(document.getElementById('sc-filter-own').options).forEach(o => o.selected = false);
  refreshScorecard();
}
