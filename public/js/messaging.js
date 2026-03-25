// ─── AUTORESPONDER UI ────────────────────────────────────────────────────────
async function arSetMode(mode) {
  const token = localStorage.getItem('oc_token') || '';
  try {
    const res = await fetch('/api/messaging/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ mode })
    });
    const data = await res.json();
    if (data.ok) {
      arHighlightMode(mode);
      const statusEl = qs('#autoresponder-status-msg');
      const modeLabels = { AUTO: '⚡ AUTO — Responde automáticamente', SEMI: '👁 SEMI — Requiere aprobación', PAUSADO: '⏸ PAUSADO — Sin respuestas automáticas' };
      if (statusEl) statusEl.textContent = modeLabels[mode] || mode;
    }
  } catch(e) { console.error('arSetMode:', e); }
}

function arHighlightMode(mode) {
  const modes = ['auto', 'semi', 'pausado'];
  const colors = { auto: 'var(--green)', semi: 'var(--orange)', pausado: 'var(--red)' };
  modes.forEach(m => {
    const btn = qs(`#ar-btn-${m}`);
    if (!btn) return;
    const isActive = m === mode.toLowerCase();
    btn.style.background = isActive ? colors[m] : 'var(--surface2)';
    btn.style.color = isActive ? '#fff' : 'var(--text2)';
    btn.style.borderColor = isActive ? colors[m] : 'var(--border)';
    btn.style.fontWeight = isActive ? '800' : '700';
  });
}

async function arApprove(pendingId) {
  const token = localStorage.getItem('oc_token') || '';
  try {
    await fetch(`/api/messaging/approve/${pendingId}`, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token }
    });
    await refreshMessagingStatus();
  } catch(e) { alert('Error al aprobar: ' + e.message); }
}

async function arReject(pendingId) {
  const token = localStorage.getItem('oc_token') || '';
  try {
    await fetch(`/api/messaging/reject/${pendingId}`, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token }
    });
    await refreshMessagingStatus();
  } catch(e) { alert('Error al rechazar: ' + e.message); }
}

// ─── MENSAJERÍA ───────────────────────────────────────────────────────────────

let waQrPoller = null;

async function refreshMessagingStatus() {
  try {
    const res = await fetch('/api/messaging/status', { headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('oc_token') || '') } });
    if (!res.ok) return;
    const data = await res.json();
    updateWaUI(data.whatsapp);
    updateFbUI(data.messenger);
    // Autoresponder
    const arEl = qs('#autoresponder-status-msg');
    if (arEl && data.autoresponder) {
      const ar = data.autoresponder;
      arEl.textContent = ar.enabled
        ? `Activo — ${ar.rules?.length || 0} regla(s) configurada(s)`
        : 'Desactivado';
      arEl.style.color = ar.enabled ? 'var(--green)' : 'var(--text3)';
    }
  } catch (e) {
    console.error('refreshMessagingStatus:', e);
  }
}

function updateWaUI(wa) {
  if (!wa) return;
  const dot = qs('#wa-status-dot');
  const txt = qs('#wa-status-text');
  const qrBox = qs('#wa-qr-box');
  const qrImg = qs('#wa-qr-img');
  const btnStart = qs('#btn-wa-start');
  const btnStop = qs('#btn-wa-stop');

  const statusMap = {
    disconnected:  { label: 'Desconectado', color: 'var(--text3)' },
    starting:      { label: 'Iniciando...', color: 'var(--orange)' },
    qr_pending:    { label: 'Esperando escaneo QR', color: 'var(--orange)' },
    phone_pending: { label: 'Generando código...', color: 'var(--orange)' },
    authenticated: { label: 'Autenticado', color: 'var(--orange)' },
    ready:         { label: 'Conectado ✓', color: 'var(--green)' },
    error:         { label: 'Error', color: 'var(--red)' },
  };
  const s = statusMap[wa.status] || { label: wa.status, color: 'var(--text3)' };
  if (dot) dot.style.background = s.color;
  if (txt) txt.textContent = s.label + (wa.error ? ` — ${wa.error}` : '');

  const isReady = wa.status === 'ready';
  const tabs = qs('#wa-login-tabs');
  if (btnStart) btnStart.style.display = isReady ? 'none' : 'flex';
  if (btnStop)  btnStop.style.display  = isReady ? 'flex' : 'none';
  if (tabs)     tabs.style.display     = isReady ? 'none' : 'flex';

  // Mostrar pairing code si llegó — cambiar al tab phone automáticamente
  if (wa.pairingCode) {
    const codeEl  = qs('#wa-pairing-code');
    const codeBox = qs('#wa-pairing-code-box');
    if (codeEl && codeEl.textContent !== wa.pairingCode) {
      codeEl.textContent  = wa.pairingCode;
      if (codeBox) codeBox.style.display = 'block';
      if (txt) txt.textContent = '📋 Ingresá este código en WhatsApp';
    }
    // Siempre asegurar que el tab teléfono está visible
    waSetTab('phone');
    startWaQrPoller(); // seguir esperando que se autentique
  }

  if (wa.status === 'qr_pending' && wa.qr) {
    const phoneBox = qs('#wa-phone-box');
    if (qrBox && (!phoneBox || phoneBox.style.display === 'none')) {
      if (qrImg) qrImg.src = wa.qr;
      if (qrBox) qrBox.style.display = 'block';
    } else if (qrImg) {
      qrImg.src = wa.qr;
    }
    startWaQrPoller();
  } else if (!isReady) {
    if (qrBox && wa.status !== 'qr_pending') qrBox.style.display = 'none';
    if (wa.status === 'disconnected' || wa.status === 'error') stopWaQrPoller();
  } else {
    if (qrBox) qrBox.style.display = 'none';
    stopWaQrPoller();
  }
}

function updateFbUI(fb) {
  if (!fb) return;
  const dot = qs('#fb-status-dot');
  const txt = qs('#fb-status-text');
  const loginForm = qs('#fb-login-form');
  const twoFaBox = qs('#fb-2fa-box');
  const btnStart = qs('#btn-fb-start');
  const btnStop  = qs('#btn-fb-stop');
  const userBadge = qs('#fb-user-badge');

  const statusMap = {
    disconnected: { label: 'Desconectado', color: 'var(--text3)' },
    starting:     { label: 'Iniciando...', color: 'var(--orange)' },
    logging_in:   { label: 'Iniciando sesión...', color: 'var(--orange)' },
    needs_2fa:    { label: 'Requiere verificación', color: 'var(--orange)' },
    ready:        { label: 'Conectado ✓', color: 'var(--green)' },
    error:        { label: 'Error', color: 'var(--red)' },
  };
  const s = statusMap[fb.status] || { label: fb.status, color: 'var(--text3)' };
  if (dot) dot.style.background = s.color;

  const isReady = fb.status === 'ready';
  const needs2fa = fb.status === 'needs_2fa';

  // Mostrar nombre de usuario cuando está conectado
  if (isReady && (fb.username || fb.email)) {
    const displayName = fb.username || fb.email;
    if (txt) txt.textContent = `Conectado como: ${displayName}`;
    if (userBadge) {
      userBadge.textContent = `👤 ${displayName}`;
      userBadge.style.display = 'inline-block';
    }
  } else {
    if (txt) txt.textContent = s.label + (fb.error ? ` — ${fb.error}` : '');
    if (userBadge) userBadge.style.display = 'none';
  }

  if (loginForm) loginForm.style.display = isReady ? 'none' : 'flex';
  if (twoFaBox)  twoFaBox.style.display  = needs2fa ? 'block' : 'none';
  if (btnStart)  btnStart.style.display  = isReady ? 'none' : 'flex';
  if (btnStop)   btnStop.style.display   = isReady ? 'flex' : 'none';
}

async function waStart() {
  const btn = qs('#btn-wa-start');
  if (btn) { btn.disabled = true; btn.textContent = 'Iniciando...'; }
  try {
    await fetch('/api/messaging/whatsapp/start', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('oc_token') || '') }
    });
    await refreshMessagingStatus();
    startWaQrPoller();
  } catch (e) {
    console.error('waStart:', e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="power" style="width:14px;height:14px;"></i> Conectar'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
  }
}

async function waStop() {
  await fetch('/api/messaging/whatsapp/stop', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('oc_token') || '') }
  });
  stopWaQrPoller();
  await refreshMessagingStatus();
}

function startWaQrPoller() {
  if (waQrPoller) return;
  waQrPoller = setInterval(async () => {
    try {
      const res = await fetch('/api/messaging/whatsapp/qr', { headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('oc_token') || '') } });
      const data = await res.json();

      if (data.status === 'ready' || data.status === 'authenticated') {
        stopWaQrPoller();
        await refreshMessagingStatus();
        return;
      }

      // Pairing code por teléfono
      if (data.pairingCode) {
        const codeEl  = qs('#wa-pairing-code');
        const codeBox = qs('#wa-pairing-code-box');
        const stTxt   = qs('#wa-status-text');
        if (codeEl && codeEl.textContent !== data.pairingCode) {
          codeEl.textContent = data.pairingCode;
          if (codeBox) codeBox.style.display = 'block';
          if (stTxt)   stTxt.textContent = 'Ingresá el código en WhatsApp';
          // Asegurar que el tab teléfono esté visible
          waSetTab('phone');
        }
        return; // seguir esperando
      }

      // QR normal
      if (data.status === 'qr_pending' && data.qr) {
        const img = qs('#wa-qr-img');
        if (img) img.src = data.qr;
        const phoneBox = qs('#wa-phone-box');
        const qrBox = qs('#wa-qr-box');
        if (qrBox && (!phoneBox || phoneBox.style.display === 'none')) {
          qrBox.style.display = 'block';
        }
        const txt = qs('#wa-status-text');
        if (txt) txt.textContent = 'Esperando escaneo QR';
        const dot = qs('#wa-status-dot');
        if (dot) dot.style.background = 'var(--orange)';
      } else {
        await refreshMessagingStatus();
      }
    } catch {}
  }, 4000);
}

function stopWaQrPoller() {
  if (waQrPoller) { clearInterval(waQrPoller); waQrPoller = null; }
}

// Toggle entre tab QR y tab Teléfono
function waSetTab(tab) {
  const tabQR    = qs('#wa-tab-qr');
  const tabPhone = qs('#wa-tab-phone');
  const qrBox    = qs('#wa-qr-box');
  const phoneBox = qs('#wa-phone-box');
  const pairBox  = qs('#wa-pairing-code-box');

  if (tab === 'qr') {
    if (tabQR)    { tabQR.style.background = 'var(--accent)'; tabQR.style.color = '#fff'; tabQR.style.borderColor = 'var(--accent)'; }
    if (tabPhone) { tabPhone.style.background = 'var(--surface)'; tabPhone.style.color = 'var(--text2)'; tabPhone.style.borderColor = 'var(--border)'; }
    // Mostrar QR si hay uno disponible
    const img = qs('#wa-qr-img');
    if (qrBox && img && img.src && img.src !== window.location.href) {
      qrBox.style.display = 'block';
    }
    if (phoneBox) phoneBox.style.display = 'none';
  } else {
    if (tabPhone) { tabPhone.style.background = 'var(--accent)'; tabPhone.style.color = '#fff'; tabPhone.style.borderColor = 'var(--accent)'; }
    if (tabQR)    { tabQR.style.background = 'var(--surface)'; tabQR.style.color = 'var(--text2)'; tabQR.style.borderColor = 'var(--border)'; }
    if (qrBox)    qrBox.style.display = 'none';
    if (phoneBox) phoneBox.style.display = 'block';
    if (pairBox)  pairBox.style.display = 'none';
  }
}

async function waRequestPhoneCode() {
  const inputEl = qs('#wa-phone-input');
  const rawValue = inputEl ? String(inputEl.value || '') : '';
  const phone = rawValue.replace(/[^0-9]/g, '');

  if (!phone || phone.length < 8) {
    alert('Ingresá un número válido (solo dígitos, con código de país)\nArgentina sin el 9: 543455237843');
    return;
  }

  const btn = qs('#btn-wa-phone-code');
  const statusTxt = qs('#wa-status-text');

  if (btn) { btn.disabled = true; btn.textContent = 'Iniciando...'; }
  if (statusTxt) statusTxt.textContent = 'Arrancando WhatsApp (~20s)...';

  try {
    // Detener si estaba en estado de error o QR para reiniciar en modo teléfono
    const statusRes = await fetch('/api/messaging/status', {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('oc_token') || '') }
    });
    const statusData = await statusRes.json();
    const curSt = statusData?.whatsapp?.status || 'disconnected';

    if (curSt === 'ready' || curSt === 'authenticated') {
      alert('WhatsApp ya está conectado. Desconectá primero.');
      return;
    }

    // Si estaba en modo QR o error, parar primero para empezar modo teléfono
    if (curSt === 'qr_pending' || curSt === 'error') {
      await fetch('/api/messaging/whatsapp/stop', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('oc_token') || '') }
      });
      await new Promise(r => setTimeout(r, 1000));
    }

    // Arrancar en modo teléfono (el backend pasa el número al evento qr)
    if (btn) btn.textContent = 'Cargando Chromium...';
    const startRes = await fetch('/api/messaging/whatsapp/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('oc_token') || '') },
      body: JSON.stringify({ phone: phone })
    });
    await startRes.json();

    if (btn) btn.textContent = 'Esperando código...';
    if (statusTxt) statusTxt.textContent = 'Generando código de vinculación...';

    // El poller va a detectar el pairingCode y mostrarlo automáticamente
    startWaQrPoller();
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Obtener código'; }
  }
}

async function fbStart() {
  const email = (qs('#fb-email')?.value || '').trim();
  const pass  = (qs('#fb-pass')?.value  || '').trim();
  if (!email || !pass) { alert('Ingresá email y contraseña de Facebook'); return; }

  const btn = qs('#btn-fb-start');
  if (btn) { btn.disabled = true; btn.textContent = 'Conectando...'; }
  try {
    const res = await fetch('/api/messaging/messenger/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('oc_token') || '') },
      body: JSON.stringify({ email, password: pass })
    });
    const data = await res.json();
    if (data.needs2fa) {
      const twoFa = qs('#fb-2fa-box');
      if (twoFa) twoFa.style.display = 'block';
    }
    await refreshMessagingStatus();
  } catch (e) {
    console.error('fbStart:', e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="log-in" style="width:14px;height:14px;"></i> Conectar'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
  }
}

async function fbStop() {
  await fetch('/api/messaging/messenger/stop', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('oc_token') || '') }
  });
  await refreshMessagingStatus();
}

async function fbRetry2FA() {
  const res = await fetch('/api/messaging/messenger/retry2fa', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('oc_token') || '') }
  });
  const data = await res.json();
  if (!data.ok) { alert('Error: ' + (data.error || 'No se pudo verificar')); return; }
  await refreshMessagingStatus();
}
