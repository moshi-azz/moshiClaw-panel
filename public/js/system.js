// ─── PROCESS MANAGER ─────────────────────────────────────────────────────────
async function loadProcesses() {
  try {
    const res = await fetch('/api/processes', { headers: { 'Authorization': 'Bearer ' + authToken } });
    const data = await res.json();
    renderProcesses(data.processes || []);
  } catch(err) {
    console.error('Error cargando procesos:', err);
  }
}

function renderProcesses(procs) {
  const list = qs('#proc-list');
  if (!list) return;
  if (!procs.length) {
    list.innerHTML = '<div style="color:var(--text3);text-align:center;padding:10px;font-size:12px">No hay procesos activos detectados</div>';
    return;
  }
  list.innerHTML = procs.map(p => `
    <div class="proc-row">
      <span class="proc-name" title="PID: ${p.pid}">${p.name}</span>
      <span class="proc-cpu">${(p.cpu || 0).toFixed(1)}%</span>
      <span class="proc-mem">${(p.mem || 0).toFixed(1)}%</span>
      <button class="proc-kill" onclick="killProcess(${p.pid})">✕</button>
    </div>
  `).join('');
}

async function killProcess(pid) {
  if (!confirm(`¿Seguro que querés terminar el proceso PID ${pid}?`)) return;
  try {
    const res = await fetch('/api/processes/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
      body: JSON.stringify({ pid })
    });
    const data = await res.json();
    if (data.success) {
      setTimeout(loadProcesses, 1000); // Reload after 1s
    } else {
      alert('Error: ' + data.error);
    }
  } catch(err) { alert('Request error'); }
}

async function quickAction(type) {
  if (type === 'notify') {
    if (Notification.permission === 'granted') {
      new Notification('🔔 moshiClaw', { body: 'Prueba de notificación exitosa' });
    } else {
      Notification.requestPermission();
    }
    return;
  }
  
  if (!confirm(`¿Ejecutar acción: ${type}?`)) return;
  
  try {
    const res = await fetch(`/api/system/${type}`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken }
    });
    const data = await res.json();
    if (data.success) {
        alert(data.message || 'Acción ejecutada con éxito.');
        if (type === 'reboot' || type === 'shutdown') {
            // Indicar que se perderá la conexión
            document.body.innerHTML = `<div style="display:flex; height:100vh; align-items:center; justify-content:center; flex-direction:column; background:#000; color:#fff;">
                <h1 style="color:var(--accent)">${type === 'reboot' ? 'Reiniciando...' : 'Apagando...'}</h1>
                <p>La conexión se ha cerrado.</p>
            </div>`;
        }
    } else {
        alert('Error: ' + data.error);
    }
  } catch(e) { alert('Error al enviar acción directa al sistema'); }
}
// ─── SCRIPT VAULT (Phase 4) ──────────────────────────────────────────────────
async function loadScripts() {
    try {
        const res = await fetch('/api/scripts', { headers: { 'Authorization': 'Bearer ' + authToken } });
        const data = await res.json();
        renderScripts(data.scripts || []);
    } catch(err) { console.error(err); }
}

function renderScripts(scripts) {
    const list = qs('#scripts-list');
    if (!list) return;
    if (!scripts.length) {
        list.innerHTML = '<div style="color:var(--text3);text-align:center;padding:20px;font-size:12px">Tu bóveda está vacía</div>';
        return;
    }
    list.innerHTML = scripts.map(s => `
        <div class="script-item">
            <div class="script-name">${s.name}<div class="script-cmd-hint">${s.cmd}</div></div>
            <div style="display:flex; gap:8px;">
                <button class="btn-run" onclick="runScript(${s.id})"><i data-lucide="play"></i> RUN</button>
                <button class="icon-btn" onclick="deleteScript(${s.id})" style="border-color:var(--red); color:var(--red); width:32px; height:32px;"><i data-lucide="trash-2"></i></button>
            </div>
        </div>
    `).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function runScript(id) {
    const outBox = qs('#script-output-box');
    const outText = qs('#script-output');
    outBox.style.display = 'block';
    outText.textContent = '> Ejecutando script...\n';
    
    try {
        const res = await fetch('/api/scripts/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
            body: JSON.stringify({ id })
        });
        const data = await res.json();
        outText.textContent += data.output || 'Finalizado sin salida.';
        if (data.exitCode !== 0) outText.textContent += `\n[Error con código ${data.exitCode}]`;
    } catch(err) {
        outText.textContent += 'Error de red al ejecutar.';
    }
}

function showAddScript() {
    qs('#script-modal').classList.add('open');
}

async function saveNewScript() {
    const name = qs('#script-name').value.trim();
    const cmd = qs('#script-cmd').value.trim();
    if (!name || !cmd) return alert('Faltan datos');
    
    try {
        const res = await fetch('/api/scripts/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
            body: JSON.stringify({ name, cmd })
        });
        const data = await res.json();
        if (data.success) {
            qs('#script-modal').classList.remove('open');
            qs('#script-name').value = '';
            qs('#script-cmd').value = '';
            loadScripts();
        }
    } catch(err) { alert('Error al guardar'); }
}

async function deleteScript(id) {
    if (!confirm('¿Seguro que querés borrar este script?')) return;
    try {
        await fetch(`/api/scripts/${id}`, { 
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + authToken } 
        });
        loadScripts();
    } catch(err) { console.error(err); }
}

// ─── HEALTH HISTORY (Phase 4) ────────────────────────────────────────────────
let historyChart = null;

async function loadHealthHistory() {
    try {
        const res = await fetch('/api/stats/history', { headers: { 'Authorization': 'Bearer ' + authToken } });
        const data = await res.json();
        renderHistoryChart(data.history || []);
    } catch(err) { console.error(err); }
}

function renderHistoryChart(history) {
    const ctx = qs('#chart-history').getContext('2d');
    const labels = history.map(h => new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const cpuData = history.map(h => h.cpu);
    const ramData = history.map(h => h.ram);

    if (historyChart) historyChart.destroy();

    historyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'CPU%',
                    data: cpuData,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0
                },
                {
                    label: 'RAM%',
                    data: ramData,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: true, ticks: { display: false }, grid: { display: false } },
                y: { min: 0, max: 100, ticks: { font: { size: 9 }, color: '#71717a' }, grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });
}

// ─── STATS / MONITOR ─────────────────────────────────────────────────────────
function updateStats(s) {
  if (!s) return;
  qs('#m-cpu').textContent = s.cpu.usage + '%';
  qs('#m-cpu-temp').textContent = s.cpu.temp ? s.cpu.temp + '°C' : 'temp N/A';
  qs('#m-ram').textContent = s.ram.percent + '%';
  qs('#m-ram-detail').textContent = `${s.ram.used} / ${s.ram.total}`;
  qs('#m-net').textContent = `↓ ${s.network.rx}\n↑ ${s.network.tx}`;
  qs('#m-iface').textContent = s.network.iface;
  qs('#m-os').textContent = s.os.distro;
  qs('#m-host').textContent = s.os.hostname;

  if (s.cpu.model) qs('#m-cpu-model').textContent = s.cpu.model;
  if (s.hardware) {
    qs('#m-gpu').textContent = s.hardware.gpu || 'N/A';
    qs('#m-hw-model').textContent = s.hardware.model || '—';
    qs('#m-hw-make').textContent = s.hardware.manufacturer || '—';
  }

  // Notificaciones (Phase 3)
  if ('Notification' in window && Notification.permission === 'granted') {
     const now = Date.now();
     if (now - lastNotifTime > 60000) { // Max 1 notif per minute
         if (s.cpu.usage > 90) {
             new Notification('⚠️ moshiClaw: Alerta de Sistema', { body: `La CPU está al ${s.cpu.usage}%` });
             lastNotifTime = now;
         } else if (s.ram.percent > 90) {
             new Notification('⚠️ moshiClaw: Alerta de Sistema', { body: `La RAM está al ${s.ram.percent}%` });
             lastNotifTime = now;
         }
     }
  }

  // Actualizar charts
  if (cpuChart) {
    cpuChart.data.labels.push('');
    cpuChart.data.datasets[0].data.push(s.cpu.usage);
    if (cpuChart.data.labels.length > 30) { cpuChart.data.labels.shift(); cpuChart.data.datasets[0].data.shift(); }
    cpuChart.update('none');
  }
  if (ramChart) {
    ramChart.data.labels.push('');
    ramChart.data.datasets[0].data.push(s.ram.percent);
    if (ramChart.data.labels.length > 30) { ramChart.data.labels.shift(); ramChart.data.datasets[0].data.shift(); }
    ramChart.update('none');
  }

  // Discos
  const diskEl = qs('#disk-list');
  diskEl.innerHTML = s.disks.map(d => `
    <div class="disk-item">
      <div class="disk-header">
        <span class="disk-mount">${d.mount}</span>
        <span class="disk-info">${d.used} / ${d.total} · <b>${d.percent}%</b></span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${d.percent<60?'low':d.percent<85?'mid':'high'}" style="width:${d.percent}%"></div>
      </div>
    </div>
  `).join('');
}

// ─── CHARTS ──────────────────────────────────────────────────────────────────
function initCharts() {
  const chartOpts = (color) => ({
    type: 'line',
    data: { labels: Array(30).fill(''), datasets: [{ data: Array(30).fill(0), borderColor: color, backgroundColor: color + '22', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { display: false, min: 0, max: 100 }
      }
    }
  });
  cpuChart = new Chart(qs('#chart-cpu'), chartOpts('#00d4ff'));
  ramChart = new Chart(qs('#chart-ram'), chartOpts('#7c3aed'));
}
