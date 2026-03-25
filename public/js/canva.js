// ─── CANVA ─────────────────────────────────────────────────────────────────────
const _canvaToken = () => localStorage.getItem('oc_token') || '';

async function refreshCanvaStatus() {
  try {
    const res = await fetch('/api/canva/status', { headers: { 'Authorization': 'Bearer ' + _canvaToken() } });
    const data = await res.json();
    const dc = qs('#canva-disconnected');
    const cc = qs('#canva-connected');
    const createSec = qs('#canva-create-section');
    const designsSec = qs('#canva-designs-section');

    if (data.connected) {
      dc.style.display = 'none';
      cc.style.display = '';
      createSec.style.display = '';
      designsSec.style.display = '';
      const p = data.profile;
      qs('#canva-user-name').textContent = p?.display_name || p?.email || p?.user_name || 'cuenta vinculada';
      loadCanvaDesigns();
    } else {
      dc.style.display = '';
      cc.style.display = 'none';
      createSec.style.display = 'none';
      designsSec.style.display = 'none';
    }
  } catch (e) {
    console.error('refreshCanvaStatus:', e);
  }
}

function connectCanva() {
  // Abrir flujo OAuth en popup (Canva cierra la ventana al terminar)
  const popup = window.open('/auth/canva', 'canva_oauth', 'width=600,height=700,scrollbars=yes');
  const listener = (e) => {
    if (e.data?.canva === 'connected') {
      window.removeEventListener('message', listener);
      if (popup && !popup.closed) popup.close();
      refreshCanvaStatus();
    } else if (e.data?.canva === 'error') {
      window.removeEventListener('message', listener);
      alert('Error al conectar Canva: ' + (e.data.msg || 'desconocido'));
    }
  };
  window.addEventListener('message', listener);
  // Fallback: si el popup cierra sin postMessage, revisar estado
  const pollClose = setInterval(() => {
    if (popup && popup.closed) {
      clearInterval(pollClose);
      window.removeEventListener('message', listener);
      setTimeout(refreshCanvaStatus, 500);
    }
  }, 800);
}

async function disconnectCanva() {
  if (!confirm('¿Desconectar tu cuenta de Canva?')) return;
  await fetch('/api/canva/disconnect', { method: 'POST', headers: { 'Authorization': 'Bearer ' + _canvaToken() } });
  refreshCanvaStatus();
}

async function loadCanvaDesigns() {
  const list = qs('#canva-designs-list');
  if (!list) return;
  list.textContent = 'Cargando...';
  try {
    const res = await fetch('/api/canva/designs', { headers: { 'Authorization': 'Bearer ' + _canvaToken() } });
    const data = await res.json();
    const designs = data.designs || data.items || [];
    if (!designs.length) { list.textContent = 'No se encontraron diseños.'; return; }
    list.innerHTML = designs.slice(0, 20).map(d => {
      const editUrl = d.urls?.edit_url || d.edit_url || '#';
      return `<div style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%">${d.title || d.id || 'Sin título'}</span>
        ${editUrl !== '#' ? `<a href="${editUrl}" target="_blank" rel="noopener"
          style="font-size:11px;color:var(--accent);text-decoration:none;white-space:nowrap">Editar ↗</a>` : ''}
      </div>`;
    }).join('');
  } catch (e) {
    list.textContent = 'Error: ' + e.message;
  }
}

async function createCanvaDesign() {
  const type  = qs('#canva-design-type').value;
  const title = qs('#canva-design-title').value.trim() || `Nuevo ${type}`;
  const btn   = qs('#btn-canva-create');
  const result = qs('#canva-create-result');
  btn.disabled = true;
  btn.textContent = 'Creando...';
  result.style.display = 'none';
  try {
    const res = await fetch('/api/canva/designs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _canvaToken() },
      body: JSON.stringify({ design_type: type, title })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const design = data.design || data;
    const editUrl = design.urls?.edit_url || design.edit_url;
    result.style.display = '';
    result.innerHTML = editUrl
      ? `✅ Diseño creado: <a href="${editUrl}" target="_blank" rel="noopener" style="color:var(--accent)">${title} ↗</a>`
      : `✅ Diseño creado (ID: ${design.id})`;
    loadCanvaDesigns();
  } catch (e) {
    result.style.display = '';
    result.textContent = '❌ ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear en Canva';
  }
}