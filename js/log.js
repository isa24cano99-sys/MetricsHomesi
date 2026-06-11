function renderLog() {
  const list = document.getElementById('log-list');
  if (!changeLog.length) {
    list.innerHTML = '<div class="empty-state">No changes recorded yet</div>';
    return;
  }
  list.innerHTML = changeLog.map(e =>
    '<div class="log-entry">' +
      '<span class="log-date">' + e.date + '</span>' +
      '<span><strong>' + e.realtor + '</strong>: ' + e.from + ' → ' + e.to + '</span>' +
    '</div>'
  ).join('');
}
