// ═══════════════════════════════════════════════════════════════════════════════
//  MOSHICLAW PANEL — App Logic
// ═══════════════════════════════════════════════════════════════════════════════

const BASE_URL = window.location.origin;
const WS_BASE = BASE_URL.replace(/^http/, 'ws');

let authToken = localStorage.getItem('oc_token') || null;
let settings       = JSON.parse(localStorage.getItem('oc_settings') || '{}');
let activeSkillId   = localStorage.getItem('oc_active_skill') || null;
let activeSkillMeta = JSON.parse(localStorage.getItem('oc_active_skill_meta') || 'null');
let _cachedSkills   = [];
let chatHistory = JSON.parse(localStorage.getItem('oc_chat') || '[]');
// chatSessionId persistido para que el servidor recuerde el contexto entre recargas
let chatSessionId = localStorage.getItem('oc_session_id') || ('session_' + Date.now());
localStorage.setItem('oc_session_id', chatSessionId);
if (!localStorage.getItem('oc_session_id')) localStorage.setItem('oc_session_id', chatSessionId);
let eventsWS = null;
let terminalWS = null;
let screenWS = null;
let xterm = null;
let fitAddon = null;
let cpuChart = null;
let ramChart = null;
let screenActive = false;
let screenFpsCounter = 0;
let screenStream = null;
let lastFpsTime = Date.now();
let autoExec = settings.autoExec || false;

// ─── UTILS ────────────────────────────────────────────────────────────────────
function qs(sel) { return document.querySelector(sel); }
function show(el) { el.style.display = ''; }
function hide(el) { el.style.display = 'none'; }

// ─── THEME ────────────────────────────────────────────────────────────────────
const TERM_THEMES = {
  dark: {
    background: '#0d0d0d', foreground: '#e2e8f0', cursor: '#00d4ff',
    black: '#000000', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#bfbfbf'
  },
  light: {
    background: '#ebe4d6', foreground: '#1c1917', cursor: '#2563eb',
    black: '#44403c', red: '#dc2626', green: '#059669', yellow: '#d97706',
    blue: '#2563eb', magenta: '#7c3aed', cyan: '#0891b2', white: '#f5f0e8'
  }
};
const CC_TERM_THEMES = {
  dark: {
    background: '#0d0d0d', foreground: '#e2e8f0', cursor: '#a855f7',
    black: '#000000', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#bfbfbf'
  },
  light: {
    background: '#ebe4d6', foreground: '#1c1917', cursor: '#7c3aed',
    black: '#44403c', red: '#dc2626', green: '#059669', yellow: '#d97706',
    blue: '#2563eb', magenta: '#7c3aed', cyan: '#0891b2', white: '#f5f0e8'
  }
};
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = qs('#btn-theme i');
  if (icon) { icon.setAttribute('data-lucide', theme === 'light' ? 'moon' : 'sun'); lucide.createIcons(); }
  localStorage.setItem('oc_theme', theme);
  // Actualizar terminales normales
  if (typeof terminals !== 'undefined') {
    Object.values(terminals).forEach(t => t.x.options.theme = TERM_THEMES[theme] || TERM_THEMES.dark);
  }
  // Actualizar terminales de Claude Code agents
  if (typeof ccAgents !== 'undefined') {
    Object.values(ccAgents).forEach(a => a.term.options.theme = CC_TERM_THEMES[theme] || CC_TERM_THEMES.dark);
  }
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'light' ? 'dark' : 'light');
}
// Aplicar tema guardado al cargar
(function() { const saved = localStorage.getItem('oc_theme'); if (saved) applyTheme(saved); })();

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function forceReloadCache() {
  if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
  }
  if (window.caches) {
    caches.keys().then(names => names.forEach(n => caches.delete(n)));
  }
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = window.location.pathname + '?reload=' + Date.now();
}

async function doLogin() {
  const user = qs('#login-user').value.trim();
  const pass = qs('#login-pass').value;
  const btn = qs('#btn-login');
  
  if (!user || !pass) {
    qs('#login-error').textContent = 'Completá ambos campos';
    return;
  }
  
  qs('#login-error').textContent = '';
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      authToken = data.token;
      localStorage.setItem('oc_token', authToken);
      showApp();
    } else {
      qs('#login-error').textContent = data.error || 'Error de login';
    }
  } catch (e) {
    qs('#login-error').textContent = 'No se pudo conectar al servidor';
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function logout() {
  authToken = null;
  localStorage.removeItem('oc_token');
  disconnectAll();
  qs('#app').classList.remove('visible');
  qs('#login-screen').style.display = 'flex';
  qs('#login-pass').value = '';
}

// ─── APP INIT ─────────────────────────────────────────────────────────────────
function showApp() {
  qs('#login-screen').style.display = 'none';
  qs('#app').classList.add('visible');
  initCharts();
  connectEvents();
  // Restaurar historial de chat (persiste al backgroundear/recargar)
  if (chatHistory.length) {
    const container = qs('#chat-messages');
    chatHistory.forEach(m => {
      const el = document.createElement('div');
      el.className = `msg ${m.role}`;
      if (m.role === 'assistant') {
        el.innerHTML = renderMarkdown(m.content);
      } else {
        el.textContent = m.content;
      }
      container.appendChild(el);
    });
    const last = container.lastChild;
    if (last) last.scrollIntoView();
  }
  if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
  }
  switchPanel('chat');
}

function init() {
  // Bindings
  qs('#btn-login').addEventListener('click', doLogin);
  qs('#login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  qs('#login-user').addEventListener('keydown', e => { if (e.key === 'Enter') qs('#login-pass').focus(); });
  qs('#btn-logout').addEventListener('click', logout);
  qs('#btn-settings').addEventListener('click', openSettings);
  if (activeSkillMeta) updateSkillBadge(); // Restaurar skill badge al cargar
  qs('#btn-close-settings').addEventListener('click', closeSettings);
  qs('#btn-save-settings').addEventListener('click', saveSettings);
  
  const btnSend = qs('#btn-send-chat');
  const handleSend = (e) => {
    e.preventDefault();
    if (!btnSend.disabled) sendChatMessage();
  };
  btnSend.addEventListener('click', handleSend);
  btnSend.addEventListener('mousedown', e => e.preventDefault());
  btnSend.addEventListener('touchstart', handleSend, { passive: false });
  
  qs('#chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });

  // Auto-resize textarea
  qs('#chat-input').addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // Global focus listeners to detect virtual keyboard opening
  document.addEventListener('focusin', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      document.body.classList.add('keyboard-open');
    }
  });
  document.addEventListener('focusout', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      document.body.classList.remove('keyboard-open');
    }
  });

  // Tab buttons
  document.querySelectorAll('.tab-btn[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
  });

  // More Menu Logic
  // (Logic handled below in the document click listener for outside-click support)


  // Model select logic
  qs('#cfg-model-select').addEventListener('change', (e) => {
    const isCustom = e.target.value === 'custom';
    qs('#manual-model-group').style.display = isCustom ? 'block' : 'none';
  });
  document.addEventListener('click', e => {
     const menu = qs('#more-menu');
     const btn = qs('#btn-more-menu');
     if (btn && btn.contains(e.target)) {
         menu.classList.toggle('open');
     } else if (menu && !menu.contains(e.target) && menu.classList.contains('open')) {
         menu.classList.remove('open');
     }
  });

  document.querySelectorAll('.more-item').forEach(btn => {
     btn.addEventListener('click', () => {
         switchPanel(btn.dataset.panel);
         qs('#more-menu').classList.remove('open');
     });
  });

  // Toggle autoexec
  const toggleEl = qs('#toggle-autoexec');
  if (autoExec) toggleEl.classList.add('on');
  toggleEl.addEventListener('click', () => {
    autoExec = !autoExec;
    toggleEl.classList.toggle('on', autoExec);
  });

  // Toggle Claude Code (visual only — saved on btn-save-settings)
  const toggleCC = qs('#toggle-claudecode');
  if (toggleCC) {
    toggleCC.addEventListener('click', () => {
      toggleCC.classList.toggle('on');
    });
  }

  // Aplicar setting de Claude Code al iniciar
  applyClaudeCodeSetting();

  // Restaurar settings
  if (settings.provider) qs('#cfg-provider').value = settings.provider;
  if (settings.apiKey) qs('#cfg-apikey').value = settings.apiKey;
  
  if (settings.model) {
      const modelSelect = qs('#cfg-model-select');
      let found = false;
      for (let opt of modelSelect.options) {
          if (opt.value === settings.model) {
              modelSelect.value = settings.model;
              found = true;
              break;
          }
      }
      if (!found) {
          modelSelect.value = 'custom';
          qs('#cfg-model').value = settings.model;
          qs('#manual-model-group').style.display = 'block';
      }
  }

  // Auto-login si hay token
  if (authToken) showApp();

  // SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});

    // Cuando el usuario toca una notificación de agente, el SW manda este mensaje
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'cc_notification_click') {
        const agentId = event.data.agentId;
        switchPanel('claudecode');
        if (agentId && ccAgents.has(agentId)) {
          ccSelectAgent(agentId);
          ccShowTerminal();
        }
      }
    });
  }
  
  // Create Lucide Icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // Jarvis voice
  initJarvis();

  // Reiniciar escucha JARVIS + WebSocket al volver a la app (móvil / iOS PWA)
  document.addEventListener('visibilitychange', () => {
    try {
      if (document.visibilityState === 'visible') {
        logDebug("📱 App Visible - Reiniciando...");
        if (_keepAliveCtx && _keepAliveCtx.state === 'suspended') _keepAliveCtx.resume().catch(() => {});

        // ── Reconexión inmediata del WebSocket si iOS lo cerró en segundo plano ──
        if (!eventsWS || eventsWS.readyState === WebSocket.CLOSED || eventsWS.readyState === WebSocket.CLOSING) {
          logDebug("📡 WS caído, reconectando...");
          connectEvents();
        }

        // Timeout para que el sistema operativo libere el micro si estaba en uso
        setTimeout(() => {
          if (jarvisMode && !jarvisCapturing && !jarvisRec) {
            jarvisBadge('wake', 'JARVIS escuchando...');
            startWakeListener();
          }
        }, 800);
      } else {
        logDebug("📱 App Background - Deteniendo micro...");
        stopWakeListener();
        // Forzar limpieza de cualquier instancia colgada
        if (jarvisRec) { try { jarvisRec.abort(); } catch(e){} jarvisRec = null; }
      }
    } catch (err) {
      logDebug("Visibility Error: " + err.message);
    }
  });

  // Global Error Handler for Mobile
  window.onerror = (msg, url, line) => {
    logDebug("🔥 Error: " + msg + " at line " + line);
  };
}

function logDebug(msg) {
  const dc = qs('#debug-console');
  if (!dc) return;
  const entry = document.createElement('div');
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  dc.appendChild(entry);
  dc.scrollTop = dc.scrollHeight;
  console.log("DEBUG:", msg);
}

function toggleDebugConsole() {
  const dc = qs('#debug-console');
  dc.classList.toggle('visible');
  if (dc.classList.contains('visible') && !qs('#btn-test-sound')) {
    const btn = document.createElement('button');
    btn.id = 'btn-test-sound';
    btn.textContent = '🔊 PROBAR SONIDO (BEEP)';
    btn.style = 'background:#10b981; color:white; border:none; padding:8px 12px; border-radius:6px; font-size:12px; margin-bottom:6px; cursor:pointer; font-weight:bold; width:100%; display:block;';
    btn.onclick = () => {
      playTestBeep();
      _doSpeak("Probando sistema de voz.", 1.0, 1.0);
    };

    const btnVoices = document.createElement('button');
    btnVoices.id = 'btn-list-voices';
    btnVoices.textContent = '🎙️ VER VOCES DISPONIBLES';
    btnVoices.style = 'background:#6366f1; color:white; border:none; padding:8px 12px; border-radius:6px; font-size:12px; margin-bottom:6px; cursor:pointer; font-weight:bold; width:100%; display:block;';
    btnVoices.onclick = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) { logDebug("⚠️ Sin voces cargadas aún"); return; }
      logDebug("── VOCES EN ESTE DISPOSITIVO ──");
      voices.forEach((v, i) => logDebug(`${i+1}. ${v.name} [${v.lang}]${v.default ? ' ★' : ''}`));
      logDebug(`── VOZ JARVIS ACTUAL: ${jarvisVoice ? jarvisVoice.name : 'ninguna'} ──`);
    };

    const btnCopyVoices = document.createElement('button');
    btnCopyVoices.id = 'btn-copy-voices';
    btnCopyVoices.textContent = '📋 COPIAR LISTA DE VOCES';
    btnCopyVoices.style = 'background:#f59e0b; color:white; border:none; padding:8px 12px; border-radius:6px; font-size:12px; margin-bottom:12px; cursor:pointer; font-weight:bold; width:100%; display:block;';
    btnCopyVoices.onclick = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) { logDebug("⚠️ Sin voces cargadas aún"); return; }
      const txt = voices.map((v, i) => `${i+1}. ${v.name} [${v.lang}]${v.default ? ' ★' : ''}`).join('\n')
        + `\n\nJARVIS usa: ${jarvisVoice ? jarvisVoice.name : 'ninguna'}`;
      navigator.clipboard.writeText(txt)
        .then(() => logDebug("✅ Lista copiada al portapapeles"))
        .catch(() => logDebug("❌ No se pudo copiar (permiso denegado)"));
    };

    dc.prepend(btnCopyVoices);
    dc.prepend(btnVoices);
    dc.prepend(btn);
  }
}

function playTestBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    logDebug("🎵 Beep de prueba enviado...");
  } catch (err) {
    logDebug("❌ Beep Error: " + err.message);
  }
}

// ─── PANEL SWITCHING ──────────────────────────────────────────────────────────
function switchPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn[data-panel]').forEach(b => {
    b.classList.toggle('active', b.dataset.panel === name);
  });
  
  // Highlight the More Menu button if a hidden panel is active
  const isHiddenPanel = ['terminal', 'screen', 'browser', 'webcam', 'messaging', 'canva'].includes(name);
  qs('#btn-more-menu').classList.toggle('active', isHiddenPanel);

  const panel = qs(`#panel-${name}`);
  if (panel) panel.classList.add('active');

  if (name === 'terminal') initTerminal();
  if (name === 'claudecode') initClaudeCode();
  if (name === 'screen') initScreen();
  if (name === 'monitor') {
      loadProcesses();
      loadHealthHistory();
  }
  if (name === 'scripts') loadScripts();
  if (name === 'messaging') refreshMessagingStatus();
  if (name === 'canva') refreshCanvaStatus();
  if (name === 'files') {
      if (!fmInitialized) {
          qs('#fm-path').value = '/';
          fmLoad();
          fmInitialized = true;
      } else {
          fmLoad(); // Refresh on every visit
      }
  }
  if (name === 'webcam') {
      if (typeof initWebcam === 'function') initWebcam();
  }
  if (name !== 'screen' && typeof screenActive !== 'undefined' && screenActive) {
      if (typeof pauseScreen === 'function') pauseScreen();
  }
  if (name !== 'webcam' && typeof webcamActive !== 'undefined' && webcamActive) {
      if (typeof pauseWebcam === 'function') pauseWebcam();
  }
}

// ─── WEBSOCKET: EVENTS ────────────────────────────────────────────────────────
function connectEvents() {
  if (eventsWS) eventsWS.close();
  const dot = qs('#conn-dot');

  eventsWS = new WebSocket(`${WS_BASE}/ws/events?token=${authToken}`);

  eventsWS.onopen = () => {
    dot.classList.remove('offline');
    console.log('Events WS connected');
    // Si la UI quedó atascada en "pensando" (por desconexión), resetearla
    if (pendingThinkingEl) {
      removeThinking();
      qs('#btn-send-chat').disabled = false;
      addMessage('🔄 Reconectado. Si esperabas una respuesta, el agente puede haber terminado mientras estabas desconectado. Podés preguntar "¿qué hiciste?" para continuar.', 'system');
    }
  };

  eventsWS.onclose = () => {
    dot.classList.add('offline');
    setTimeout(connectEvents, 3000); // Reconectar
  };

  eventsWS.onerror = () => { dot.classList.add('offline'); };

  eventsWS.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'stats') updateStats(msg.data);
    else if (msg.type === 'chat_thinking') showThinking(msg.sessionId);
    else if (msg.type === 'chat_response') showResponse(msg.content, msg.provider, msg.thinking);
    else if (msg.type === 'chat_error') showChatError(msg.error);
    else if (msg.type === 'chat_tool') { removeThinking(); handleToolEvent(msg); }
    else if (msg.type === 'browser_status') {
        eventsWS.send(JSON.stringify({ type: 'browser', action: 'screenshot' }));
    }
    else if (msg.type === 'browser_screenshot') {
        updateBrowserScreenshot(msg.image);
    }
  };
}

let lastNotifTime = 0;

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function updateApiKeyHint() {
  const prov = qs('#cfg-provider').value;
  const apikeyInput = qs('#cfg-apikey');
  if (prov === 'ollama') {
    apikeyInput.placeholder = 'No requerida (Ollama corre local)';
    apikeyInput.disabled = true;
    apikeyInput.value = '';
  } else {
    apikeyInput.placeholder = 'Pegá tu API key aquí';
    apikeyInput.disabled = false;
  }
}

function openSettings() {
  qs('#cfg-provider').value = settings.provider || 'gemini';
  qs('#cfg-apikey').value = settings.apiKey || '';
  updateApiKeyHint();
  qs('#cfg-provider').onchange = updateApiKeyHint;
  
  // Sync model dropdown
  const modelSelect = qs('#cfg-model-select');
  const manualInput = qs('#cfg-model');
  const currentModel = settings.model || 'gemini-2.0-flash';
  
  let found = false;
  for (let opt of modelSelect.options) {
      if (opt.value === currentModel) {
          modelSelect.value = currentModel;
          found = true;
          break;
      }
  }
  
  if (!found) {
      modelSelect.value = 'custom';
      manualInput.value = currentModel;
      qs('#manual-model-group').style.display = 'block';
  } else {
      qs('#manual-model-group').style.display = 'none';
  }

  const toggle = qs('#toggle-autoexec');
  toggle.classList.toggle('on', !!settings.autoExec);
  const toggleCC = qs('#toggle-claudecode');
  if (toggleCC) toggleCC.classList.toggle('on', !!settings.claudeCode);
  const toggleExp = qs('#toggle-expertmode');
  if (toggleExp) toggleExp.classList.toggle('on', !!settings.expertMode);
  qs('#settings-modal').classList.add('open');
}

function closeSettings() {
  qs('#settings-modal').classList.remove('open');
}

function saveSettings() {
  settings.provider = qs('#cfg-provider').value;
  
  const modelSelect = qs('#cfg-model-select');
  if (modelSelect.value === 'custom') {
      settings.model = qs('#cfg-model').value.trim();
  } else {
      settings.model = modelSelect.value;
  }

  settings.apiKey = qs('#cfg-apikey').value.trim();
  settings.autoExec = qs('#toggle-autoexec').classList.contains('on');
  autoExec = settings.autoExec;
  settings.claudeCode = qs('#toggle-claudecode').classList.contains('on');
  const toggleExp = qs('#toggle-expertmode');
  if (toggleExp) settings.expertMode = toggleExp.classList.contains('on');
  localStorage.setItem('oc_settings', JSON.stringify(settings));
  applyClaudeCodeSetting();
  closeSettings();
  addMessage('✓ Configuración guardada.', 'system');
}

// ─── MARKDOWN SIMPLE ──────────────────────────────────────────────────────────
function renderMarkdown(text) {
  // Procesar bloques de artifact primero para evitar que el markdown los rompa
  let processed = text;
  const artifacts = [];
  processed = processed.replace(/<artifact\s+title="(.*?)"\s+type="(.*?)"(?:\s+id="(.*?)")?>([\s\S]*?)<\/artifact>/gi, (match, title, type, id, content) => {
    const artId = id || `art_${Date.now()}_${Math.floor(Math.random()*1000)}`;
    artifacts.push({ id: artId, title, type, content: content.trim() });
    return `<div class="artifact-card-incall" onclick="Artifacts.show('${artId}', '${type}', '${title}', \`${content.trim().replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)">
      <div class="art-icon"><i data-lucide="package"></i></div>
      <div class="art-info">
        <div class="art-title">${title}</div>
        <div class="art-subtitle">Presiona para ver ${type}</div>
      </div>
    </div>`;
  });

  const html = processed
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Restaurar nuestras tarjetas de artifact que fueron escapadas accidentalmente (si el replace anterior falló por orden)
    // Pero lo ideal es que el replace de artifact genere algo que NO se escape.
    // Vamos a hacerlo con un placeholder.
    ;

  // Re-procesar con placeholders para evitar escape de HTML en las tarjetas
  const placeholders = [];

  function makeArtifactPlaceholder(content, type, title) {
    const artId = `art_${Date.now()}_${Math.floor(Math.random()*1000)}`;
    const idx = placeholders.length;
    const encodedContent = encodeURIComponent(content.trim());
    const safeTitle = (title || type).replace(/'/g, "\\'");
    placeholders.push(`<div class="artifact-card-incall" onclick="Artifacts.show('${artId}', '${type}', '${safeTitle}', '${encodedContent}')">
      <div class="art-icon"><i data-lucide="layout"></i></div>
      <div class="art-info">
        <div class="art-title">${title || type.toUpperCase()}</div>
        <div class="art-subtitle">Ver ${type}</div>
      </div>
    </div>`);
    return `__ARTIFACT_PLACEHOLDER_${idx}__`;
  }

  // 1. Tags <artifact> explícitos
  processed = text.replace(/<artifact\s+title="(.*?)"\s+type="(.*?)"(?:\s+id="(.*?)")?>([\s\S]*?)<\/artifact>/gi, (match, title, type, id, content) => {
    return makeArtifactPlaceholder(content, type, title);
  });

  // 2. Bloques ```html``` y ```svg``` → auto-convertir a artifact
  processed = processed.replace(/```(html|svg)\s*\n([\s\S]*?)```/gi, (match, lang, content) => {
    const type = lang.toLowerCase();
    const title = type === 'html' ? 'HTML' : 'SVG';
    return makeArtifactPlaceholder(content, type, title);
  });

  let rendered = processed
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1"><a href="$2" download class="download-link">Descargar imagen</a>')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/\n/g, '<br>');

  // Restaurar placeholders
  placeholders.forEach((html, i) => {
    rendered = rendered.replace(`__ARTIFACT_PLACEHOLDER_${i}__`, html);
  });

  return rendered;
}

// ─── DISCONNECT ───────────────────────────────────────────────────────────────
function disconnectAll() {
  [eventsWS, terminalWS, screenWS].forEach(ws => { if (ws) ws.close(); });
  eventsWS = terminalWS = screenWS = null;
}

// ─── VISUAL VIEWPORT (keyboard avoidance) ─────────────────────────────────────
function setupViewportFix() {
  const app = qs('#app');
  if (!window.visualViewport) return;

  let rafId = null;
  function onViewportChange() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const vv = window.visualViewport;
      const offsetTop = vv.offsetTop || 0;
      const kbHeight = Math.max(0, window.innerHeight - vv.height - offsetTop);
      const isKeyboardOpen = kbHeight > 50;

      if (isKeyboardOpen) {
        app.style.top    = offsetTop + 'px';
        app.style.height = vv.height + 'px';
      } else {
        app.style.top    = '';
        app.style.height = '';
      }

      app.classList.toggle('keyboard-open', isKeyboardOpen);
      if (activeTermId && terminals[activeTermId]) {
        try { terminals[activeTermId].fit.fit(); } catch {}
      }
    });
  }

  window.visualViewport.addEventListener('resize', onViewportChange);
  window.visualViewport.addEventListener('scroll', onViewportChange);
  onViewportChange();
}

// ─── LOGGING ──────────────────────────────────────────────────────────────────
function logDebug(msg) {
  const dc = qs('#debug-console');
  if (!dc) return;
  const entry = document.createElement('div');
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  dc.appendChild(entry);
  dc.scrollTop = dc.scrollHeight;
  console.log("DEBUG:", msg);
}

function toggleDebugConsole() {
  const dc = qs('#debug-console');
  dc.classList.toggle('visible');
  if (dc.classList.contains('visible') && !qs('#btn-test-sound')) {
    const btn = document.createElement('button');
    btn.id = 'btn-test-sound';
    btn.textContent = '🔊 PROBAR SONIDO (BEEP)';
    btn.style = 'background:#10b981; color:white; border:none; padding:8px 12px; border-radius:6px; font-size:12px; margin-bottom:6px; cursor:pointer; font-weight:bold; width:100%; display:block;';
    btn.onclick = () => {
      playTestBeep();
      _doSpeak("Probando sistema de voz.", 1.0, 1.0);
    };

    const btnVoices = document.createElement('button');
    btnVoices.id = 'btn-list-voices';
    btnVoices.textContent = '🎙️ VER VOCES DISPONIBLES';
    btnVoices.style = 'background:#6366f1; color:white; border:none; padding:8px 12px; border-radius:6px; font-size:12px; margin-bottom:6px; cursor:pointer; font-weight:bold; width:100%; display:block;';
    btnVoices.onclick = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) { logDebug("⚠️ Sin voces cargadas aún"); return; }
      logDebug("── VOCES EN ESTE DISPOSITIVO ──");
      voices.forEach((v, i) => logDebug(`${i+1}. ${v.name} [${v.lang}]${v.default ? ' ★' : ''}`));
      logDebug(`── VOZ JARVIS ACTUAL: ${jarvisVoice ? jarvisVoice.name : 'ninguna'} ──`);
    };

    const btnCopyVoices = document.createElement('button');
    btnCopyVoices.id = 'btn-copy-voices';
    btnCopyVoices.textContent = '📋 COPIAR LISTA DE VOCES';
    btnCopyVoices.style = 'background:#f59e0b; color:white; border:none; padding:8px 12px; border-radius:6px; font-size:12px; margin-bottom:12px; cursor:pointer; font-weight:bold; width:100%; display:block;';
    btnCopyVoices.onclick = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) { logDebug("⚠️ Sin voces cargadas aún"); return; }
      const txt = voices.map((v, i) => `${i+1}. ${v.name} [${v.lang}]${v.default ? ' ★' : ''}`).join('\n')
        + `\n\nJARVIS usa: ${jarvisVoice ? jarvisVoice.name : 'ninguna'}`;
      navigator.clipboard.writeText(txt)
        .then(() => logDebug("✅ Lista copiada al portapapeles"))
        .catch(() => logDebug("❌ No se pudo copiar (permiso denegado)"));
    };

    dc.prepend(btnCopyVoices);
    dc.prepend(btnVoices);
    dc.prepend(btn);
  }
}

function playTestBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    logDebug("🎵 Beep de prueba enviado...");
  } catch (err) {
    logDebug("❌ Beep Error: " + err.message);
  }
}
