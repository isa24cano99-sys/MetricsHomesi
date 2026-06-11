function setStatus(t, msg) {
  const bar = document.getElementById('status-bar');
  bar.className = 'status-bar ' + (t === 'ok' ? 'sb-ok' : t === 'err' ? 'sb-err' : t === 'warn' ? 'sb-warn' : 'sb-load');
  document.getElementById('status-text').textContent = msg;
}

function setProgress(type, pct) {
  document.getElementById('pf-' + type).style.width = pct + '%';
  if (pct >= 100) setTimeout(() => document.getElementById('pb-' + type).classList.add('hidden'), 800);
}

function handleFile(e, type) {
  const file = e.target.files[0]; if (!file) return;
  const uz = document.getElementById('uz-' + type);
  uz.classList.add('uploading');
  document.getElementById('pb-' + type).classList.remove('hidden');
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'binary', cellDates: false });
      let data;
      if (type === 'leads') {
        const sn = wb.SheetNames.find(n => /lead|refer/i.test(n)) || wb.SheetNames[0];
        data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null });
        leadsData = data;
      } else {
        const sn = wb.SheetNames.find(n => /opp/i.test(n)) || wb.SheetNames[1] || wb.SheetNames[0];
        data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null });
        oppData = data;
      }
      setProgress(type, 15);
      if (dbConnected) await uploadToSupabase(type, data, file.name);
      setProgress(type, 100);
      uz.classList.remove('uploading'); uz.classList.add('ok');
      document.getElementById('uz-' + type + '-lbl').textContent = '✓ ' + file.name + ' (' + data.length + ' rows)';
      const saved = document.getElementById('uz-' + type + '-saved');
      saved.textContent = '💾 Saved ' + new Date().toLocaleDateString('es-CO');
      saved.classList.remove('hidden');
      if (leadsData || oppData) document.getElementById('run-btn').disabled = false;
      setStatus('ok', '✅ ' + file.name + ' saved to Supabase (' + data.length + ' rows)');
    } catch (err) {
      uz.classList.remove('uploading');
      setStatus('err', '❌ Error: ' + err.message);
    }
  };
  reader.readAsBinaryString(file);
}

async function initApp() {
  setStatus('load', '⏳ Connecting to Supabase...');
  try {
    const meta = await sbFetch('upload_meta?select=file_type,file_name,row_count,uploaded_at');
    dbConnected = true;
    let hasData = false;
    for (const m of meta) {
      const type = m.file_type;
      document.getElementById('uz-' + type).classList.add('ok');
      document.getElementById('uz-' + type + '-lbl').textContent = '✓ ' + m.file_name + ' (' + m.row_count + ' rows)';
      const saved = document.getElementById('uz-' + type + '-saved');
      saved.textContent = '💾 Saved ' + new Date(m.uploaded_at).toLocaleDateString('es-CO');
      saved.classList.remove('hidden');
      hasData = true;
    }
    const master = await sbFetch('master_assignments?select=*');
    for (const m of master) {
      if (m.source === 'manual') {
        masterMap.set(m.realtor_key, { name: m.realtor_name, owner: m.owner, branch: m.branch, source: m.source, updatedAt: m.updated_at, confirmed: m.confirmed === true || m.confirmed === 'true' });
      }
    }
    const logs = await sbFetch('change_log?select=*&order=created_at.desc&limit=200');
    changeLog = logs.map(l => ({ date: l.change_date, realtor: l.realtor, from: l.from_assignment, to: l.to_assignment }));

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

function openSettings() {
  document.getElementById('settings-panel').classList.add('open');
  document.getElementById('settings-overlay').classList.add('open');
}

function closeSettings() {
  document.getElementById('settings-panel').classList.remove('open');
  document.getElementById('settings-overlay').classList.remove('open');
}

// Init: set default date values and start app
const today = new Date();
document.getElementById('cutoff-date').value = today.toISOString().split('T')[0];
const inf = new Date(today); inf.setFullYear(inf.getFullYear() - 1);
document.getElementById('inactive-from').value = inf.toISOString().split('T')[0];

initApp();
