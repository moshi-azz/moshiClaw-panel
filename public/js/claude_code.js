// ─── CLAUDE CODE — GESTOR DE AGENTES ─────────────────────────────────────────
const ccAgents     = new Map();   // id → { term, ws, fit, ro, div, chipEl, status, absPath, relPath, label, outputBuf, outputTimer, notifiedFor }
let ccActiveId     = null;
let ccAgentSeq     = 0;
let ccCurrentPath  = '/';         // ruta que se está navegando en el explorador
let ccModifiers    = { Ctrl: false };
let ccBrowserMode  = false;       // true = estamos en modo explorador para añadir agente

// ── Persistencia de agentes ───────────────────────────────────────────────
function ccSaveState() {
  const data = [...ccAgents.values()].map(a => ({
    absPath: a.absPath,
    relPath: a.relPath,
    label:   a.label
  }));
  try { localStorage.setItem('oc_cc_agents', JSON.stringify(data)); } catch {}
}

// ── Punto de entrada al panel ──────────────────────────────────────────────
// ── Punto de entrada al panel ────────────────────────────────────────────
function initClaudeCode() {
  if (ccAgents.size === 0) {
    // Restaurar agentes guardados de sesiones anteriores
    const saved = JSON.parse(localStorage.getItem('oc_cc_agents') || '[]');
    if (saved.length) {
      saved.forEach(a => ccCreateAgent(a.absPath, a.relPath));
      return; // ccCreateAgent ya muestra la vista de terminal
    }
    ccShowBrowser();
    ccLoadDir(ccCurrentPath);
  } else if (ccActiveId) {
    ccShowTerminal();
  } else {
    ccShowBrowserForNew();
  }
}

// ── Cambio de vistas ─────────────────────────────────────────────────────
function ccShowBrowserForNew() {
  ccBrowserMode = true;
  ccShowBrowser();
  ccLoadDir(ccCurrentPath);
}

function ccShowBrowser() {
  qs('#cc-browser-view').style.display = 'flex';
  qs('#cc-terminal-view').style.display = 'none';
}

function ccShowTerminal() {
  qs('#cc-browser-view').style.display = 'none';
  qs('#cc-terminal-view').style.display = 'flex';
  const agent = ccAgents.get(ccActiveId);
  if (agent) setTimeout(() => { agent.fit.fit(); agent.term.focus(); }, 80);
}

// ── Explorador de directorios ────────────────────────────────────────────
async function ccLoadDir(relPath) {
  ccCurrentPath = relPath;

  // Breadcrumb
  const parts = relPath.split('/').filter(Boolean);
  let html = `<span onclick="ccLoadDir('/')">~</span>`;
  let built = '';
  parts.forEach(p => {
    built += '/' + p;
    const cap = built;
    html += ` / <span onclick="ccLoadDir('${cap.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')"> ${p}</span>`;
  });
  const bcEl = qs('#cc-breadcrumb');
  if (bcEl) bcEl.innerHTML = html;
  const bb = qs('#cc-back-btn');
  if (bb) bb.disabled = (relPath === '/');

  const grid = qs('#cc-dir-grid');
  if (!grid) return;
  grid.innerHTML = `<div class="cc-empty"><i data-lucide="loader-2" style="width:22px;height:22px;display:block;margin:0 auto 10px;animation:spin 0.9s linear infinite;"></i>Cargando...</div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();

  try {
    const res  = await fetch(`/api/files/list?path=${encodeURIComponent(relPath)}`,
                             { headers: { Authorization: `Bearer ${authToken}` } });
    const data = await res.json();
    const dirs = (data.items || []).filter(i => i.isDirectory);

    if (!dirs.length) {
      grid.innerHTML = `<div class="cc-empty"><i data-lucide="folder-x" style="width:28px;height:28px;display:block;margin:0 auto 10px;opacity:0.4;"></i>Sin subcarpetas aquí</div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }
    grid.innerHTML = dirs.map(d => {
      const sp = d.path.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      return `<div class="cc-dir-card" onclick="ccNavigate('${sp}')">
        <i data-lucide="folder" style="width:30px;height:30px;color:#f59e0b;flex-shrink:0;"></i>
        <div class="cc-dir-name">${d.name}</div>
        <button class="cc-open-dir-btn" title="Abrir Claude Code aquí" onclick="event.stopPropagation();ccOpenInDir('${sp}')">
          <i data-lucide="zap" style="width:11px;height:11px;"></i>
        </button>
      </div>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch {
    grid.innerHTML = `<div class="cc-empty" style="color:var(--red);">Error al cargar directorio</div>`;
  }
}

function ccGoBack() {
  const parts = ccCurrentPath.split('/').filter(Boolean);
  if (!parts.length) return;
  parts.pop();
  ccLoadDir(parts.length ? '/' + parts.join('/') : '/');
}
function ccNavigate(relPath) { ccLoadDir(relPath); }
function ccOpenHere()        { ccOpenInDir(ccCurrentPath); }

function ccOpenInDir(relPath) {
  const absPath = '/home/moshi' + (relPath === '/' ? '' : relPath);
  ccBrowserMode = false;
  ccCreateAgent(absPath, relPath);
}

// ── Gestor de agentes ────────────────────────────────────────────────────
function ccCreateAgent(absPath, relPath) {
  const id    = 'cca_' + (++ccAgentSeq) + '_' + Date.now();
  const label = relPath.split('/').filter(Boolean).pop() || '~';

  // Crear div de terminal
  const div = document.createElement('div');
  div.className = 'cc-term-view';
  div.id = 'cc-term-' + id;
  qs('#cc-terms-container').appendChild(div);

  // xterm
  const x = new Terminal({
    theme: CC_TERM_THEMES[document.documentElement.getAttribute('data-theme')] || CC_TERM_THEMES.dark,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 13, cursorBlink: true, padding: 8
  });
  const fit = new FitAddon.FitAddon();
  x.loadAddon(fit);
  x.open(div);
  setTimeout(() => fit.fit(), 100);

  const agent = {
    id, label, absPath, relPath,
    term: x, fit, div,
    ws: null, ro: null,
    status: 'connecting',
    outputBuf: '', outputTimer: null, notifiedFor: null,
    chipEl: null
  };

  // Keyboard input (referencia a agent.ws para poder reemplazarla en restart)
  x.onData(d => {
    if (!agent.ws || agent.ws.readyState !== WebSocket.OPEN) return;
    let data = d;
    if (ccModifiers.Ctrl && d.length === 1) {
      const cc = d.toUpperCase().charCodeAt(0);
      if (cc >= 64 && cc <= 95) data = String.fromCharCode(cc - 64);
      ccModifiers.Ctrl = false;
      const ctrlBtn = qs('#claude-ctrl-btn');
      if (ctrlBtn) ctrlBtn.classList.remove('active');
    }
    agent.ws.send(data);
  });

  x.onResize(size => {
    if (agent.ws && agent.ws.readyState === WebSocket.OPEN)
      agent.ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
  });

  const ro = new ResizeObserver(() => { if (agent.fit) agent.fit.fit(); });
  ro.observe(div);
  agent.ro = ro;

  ccAgents.set(id, agent);
  ccSaveState();       // persistir lista de agentes
  _ccConnect(agent);   // abre WebSocket y lanza Claude Code
  ccSelectAgent(id);
  ccShowTerminal();
  _ccRenderAgentsBar();
}

function _ccConnect(agent) {
  const ws = new WebSocket(`${WS_BASE}/ws/terminal?token=${authToken}`);
  agent.ws = ws;
  agent.status = 'connecting';
  _ccUpdateChip(agent.id);

  ws.onopen = () => {
    agent.status = 'running';
    _ccUpdateChip(agent.id);
    ws.send(JSON.stringify({ type: 'init', cols: agent.term.cols, rows: agent.term.rows }));
    const safeP = agent.absPath.replace(/"/g, '\\"');
    setTimeout(() => ws.send(`cd "${safeP}"\r`), 300);
    setTimeout(() => ws.send(`npx claude --dangerously-skip-permissions\r`), 700);
  };

  ws.onmessage = (e) => {
    agent.term.write(e.data);
    const stripped = _ccStripAnsi(e.data);

    // Si Claude estaba esperando y llega output real → está trabajando de nuevo
    if ((agent.status === 'waiting' || agent.status === 'done') &&
        stripped.replace(/[\s\r\n]/g, '').length > 3) {
      agent.status = 'running';
      agent.notifiedFor = null;
      _ccUpdateChip(agent.id);
    }

    agent.outputBuf = (agent.outputBuf + stripped).slice(-1200);
    clearTimeout(agent.outputTimer);
    agent.outputTimer = setTimeout(() => _ccDetect(agent), 1800);
  };

  ws.onclose = () => {
    agent.status = 'error';
    _ccUpdateChip(agent.id);
    agent.term.write('\r\n\x1b[31m[Sesión cerrada — presiona ↻ para reiniciar]\x1b[0m\r\n');
    if (agent.id === ccActiveId) _setClaudeStatus('desconectado');
  };
}

function ccSelectAgent(id) {
  ccActiveId = id;
  // Mostrar/ocultar terminales
  ccAgents.forEach((a, aid) => {
    a.div.classList.toggle('cc-term-active', aid === id);
  });
  // Actualizar topbar
  const agent = ccAgents.get(id);
  if (agent) {
    const pathEl = qs('#cc-active-path');
    if (pathEl) pathEl.textContent = '~' + (agent.relPath === '/' ? '' : agent.relPath);
    _setClaudeStatus(_ccStatusLabel(agent.status));
    // Resetear notificación al enfocar
    agent.notifiedFor = null;
    setTimeout(() => { agent.fit.fit(); agent.term.focus(); }, 80);
  }
  _ccRenderAgentsBar();
}

function ccCloseAgent(id) {
  const agent = ccAgents.get(id);
  if (!agent) return;
  clearTimeout(agent.outputTimer);
  try { agent.ws.close();     } catch {}
  try { agent.term.dispose(); } catch {}
  try { agent.ro.disconnect(); } catch {}
  agent.div.remove();
  ccAgents.delete(id);
  ccSaveState();       // actualizar lista persistida

  if (ccActiveId === id) {
    const remaining = [...ccAgents.keys()];
    if (remaining.length) {
      ccSelectAgent(remaining[remaining.length - 1]);
      ccShowTerminal();
    } else {
      ccActiveId = null;
      ccShowBrowserForNew();
    }
  }
  _ccRenderAgentsBar();
}

function ccRestartActive() {
  const agent = ccAgents.get(ccActiveId);
  if (!agent) return;
  clearTimeout(agent.outputTimer);
  try { agent.ws.close(); } catch {}
  agent.term.clear();
  agent.outputBuf = '';
  agent.notifiedFor = null;
  _ccConnect(agent);
}

// ── Renderizado de chips ──────────────────────────────────────────────────
function _ccRenderAgentsBar() {
  const bar = qs('#cc-agents-bar');
  if (!bar) return;
  bar.style.display = ccAgents.size ? 'flex' : 'none';

  // Quitar chips viejos (no el botón +)
  bar.querySelectorAll('.cc-agent-chip').forEach(el => el.remove());

  const addBtn = qs('#cc-add-agent-btn');
  ccAgents.forEach((agent, id) => {
    const chip = document.createElement('div');
    chip.className = `cc-agent-chip s-${agent.status}${id === ccActiveId ? ' cc-active' : ''}`;
    chip.id = 'cc-chip-' + id;
    chip.innerHTML = `
      <span class="cc-agent-dot"></span>
      <span class="cc-chip-label">${agent.label}</span>
      <button class="cc-chip-close" onclick="event.stopPropagation();ccCloseAgent('${id}')" title="Cerrar agente">✕</button>`;
    chip.addEventListener('click', () => {
      ccSelectAgent(id);
      ccShowTerminal();
    });
    agent.chipEl = chip;
    bar.insertBefore(chip, addBtn);
  });
}

function _ccUpdateChip(id) {
  const agent = ccAgents.get(id);
  if (!agent || !agent.chipEl) { _ccRenderAgentsBar(); return; }
  agent.chipEl.className = `cc-agent-chip s-${agent.status}${id === ccActiveId ? ' cc-active' : ''}`;
  if (id === ccActiveId) _setClaudeStatus(_ccStatusLabel(agent.status));
}

function _ccStatusLabel(s) {
  return { connecting:'conectando...', running:'activo', waiting:'esperando', done:'listo', error:'error' }[s] || s;
}

// ── Detección de estado por output ───────────────────────────────────────
function _ccStripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][012AB]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function _ccDetect(agent) {
  // Solo actuar si Claude está trabajando (running)
  if (agent.status !== 'running') return;

  const tail = agent.outputBuf.slice(-700);

  // Detectar prompt ❯ de Claude Code (indica que terminó y espera input)
  const atPrompt =
    /[❯›][\s\r\n]{0,8}$/.test(tail);

  // Detectar si necesita confirmación del usuario
  const needsConfirm =
    /\(y\/n\)/i.test(tail) ||
    /\[yes\/no\]/i.test(tail) ||
    /Do you want/i.test(tail.slice(-400)) ||
    /Allow this/i.test(tail.slice(-400)) ||
    /proceed\?/i.test(tail.slice(-300)) ||
    /Are you sure/i.test(tail.slice(-300));

  if (!atPrompt && !needsConfirm) return;

  // Transicionar a waiting
  agent.status = 'waiting';
  _ccUpdateChip(agent.id);

  // Notificar a menos que el usuario esté mirando exactamente este agente
  const isWatching =
    !document.hidden &&
    agent.id === ccActiveId &&
    !!document.querySelector('#panel-claudecode.active');

  if (!isWatching && agent.notifiedFor !== 'waiting') {
    agent.notifiedFor = 'waiting';
    const title = needsConfirm
      ? '⚠️ Agente necesita tu confirmación'
      : '✅ Agente completó la tarea';
    const body = needsConfirm
      ? `${agent.label} está esperando una respuesta`
      : `${agent.label} terminó y espera tu próxima instrucción`;
    ccNotify(title, body, agent.id);
  }
  // El buffer NO se limpia — ventana deslizante de 1200 chars
}

// ── Notificaciones PWA ────────────────────────────────────────────────────
async function ccNotify(title, body, agentId) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      icon:      '/icons/icon-192.png',
      badge:     '/icons/icon-192.png',
      tag:       'cc-' + agentId,   // reemplaza notif anterior del mismo agente
      renotify:  true,
      data:      { agentId }
    });
  } catch {
    // Fallback si el SW no soporta showNotification
    try { new Notification(title, { body, icon: '/icons/icon-192.png' }); } catch {}
  }
}

// ── Teclado móvil ────────────────────────────────────────────────────────
function toggleClaudeKey(btn, key) {
  ccModifiers[key] = !ccModifiers[key];
  btn.classList.toggle('active', ccModifiers[key]);
}

function sendClaudeKey(key) {
  const agent = ccAgents.get(ccActiveId);
  if (!agent || !agent.ws || agent.ws.readyState !== WebSocket.OPEN) return;
  const map = { Esc:'\x1b', Tab:'\t', Up:'\x1b[A', Down:'\x1b[B', Right:'\x1b[C', Left:'\x1b[D' };
  agent.ws.send(map[key] || key);
  agent.term.focus();
}

async function copyClaudeTerm() {
  const agent = ccAgents.get(ccActiveId);
  if (!agent) return;
  const text = agent.term.getSelection();
  if (text) await navigator.clipboard.writeText(text);
}

async function pasteClaudeTerm() {
  const agent = ccAgents.get(ccActiveId);
  if (!agent || !agent.ws || agent.ws.readyState !== WebSocket.OPEN) return;
  const text = await navigator.clipboard.readText();
  if (text) agent.ws.send(text);
}

// ── Helpers compartidos ──────────────────────────────────────────────────
function _setClaudeStatus(txt) {
  const el = qs('#claudecode-status');
  if (!el) return;
  el.textContent = txt;
  const colors = { activo:'var(--green)', listo:'var(--green)', esperando:'var(--orange)', error:'var(--red)', desconectado:'var(--red)' };
  el.style.color = colors[txt] || 'var(--text3)';
}

// ── Setting on/off ────────────────────────────────────────────────────────
function applyClaudeCodeSetting() {
  const tab = qs('#tab-claudecode');
  if (!tab) return;
  const enabled = !!settings.claudeCode;
  tab.style.display = enabled ? '' : 'none';
  if (!enabled && document.querySelector('#panel-claudecode.active')) {
    switchPanel('chat');
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
