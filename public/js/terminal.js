// ─── TERMINAL ─────────────────────────────────────────────────────────────────
let terminals = {};
let activeTermId = null;
let termModifiers = { Ctrl: false, Alt: false };

function newTerminal() {
  const id = 'term_' + Date.now();
  const container = qs('#terminal-container');
  const div = document.createElement('div');
  div.id = 'term-view-' + id;
  div.style.display = 'none';
  div.style.height = '100%';
  div.style.width = '100%';
  container.appendChild(div);

  const x = new Terminal({
    theme: TERM_THEMES[document.documentElement.getAttribute('data-theme')] || TERM_THEMES.dark,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 14,
    cursorBlink: true,
    padding: 10
  });
  const fit = new FitAddon.FitAddon();
  x.loadAddon(fit);
  x.open(div);
  
  setTimeout(() => fit.fit(), 100);

  const ws = new WebSocket(`${WS_BASE}/ws/terminal?token=${authToken}`);
  
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'init', cols: x.cols, rows: x.rows }));
  };
  
  ws.onmessage = (e) => x.write(e.data);
  ws.onclose = () => x.write('\r\n\x1b[33m[Conexión perdida]\x1b[0m\r\n');

  x.onData(d => {
    if (ws.readyState === WebSocket.OPEN) {
      let data = d;
      if (termModifiers.Ctrl && d.length === 1) {
        const charCode = d.toUpperCase().charCodeAt(0);
        if (charCode >= 64 && charCode <= 95) data = String.fromCharCode(charCode - 64);
      } else if (termModifiers.Alt && d.length === 1) {
        data = '\x1b' + d;
      }
      ws.send(data);
      
      // Auto-off for modifiers after one key
      if (termModifiers.Ctrl || termModifiers.Alt) {
          termModifiers.Ctrl = false;
          termModifiers.Alt = false;
          document.querySelectorAll('.key-btn').forEach(b => {
              if (['CTRL', 'ALT'].includes(b.textContent)) b.classList.remove('active');
          });
      }
    }
  });

  x.onResize(size => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
    }
  });

  // Observation for auto-fit
  const ro = new ResizeObserver(() => {
    if (div.style.display !== 'none') fit.fit();
  });
  ro.observe(container);
  
  terminals[id] = { x, fit, ws, div, ro };

  const tab = document.createElement('div');
  tab.className = 'term-tab';
  tab.innerHTML = `<i data-lucide="terminal" style="width:12px; margin-right:4px;"></i> T${Object.keys(terminals).length} <span class="close-tab" style="margin-left:8px; opacity:0.5;">✕</span>`;
  tab.onclick = (e) => {
      if (e.target.classList.contains('close-tab')) {
          closeTerminal(id, tab);
          return;
      }
      switchTerminal(id);
  };
  
  qs('#terminal-nav').appendChild(tab);
  if (typeof lucide !== 'undefined') lucide.createIcons();
  
  switchTerminal(id);
}

function closeTerminal(id, tabEl) {
    const t = terminals[id];
    if (!t) return;
    t.ws.close();
    t.ro.disconnect();
    t.div.remove();
    tabEl.remove();
    delete terminals[id];
    const keys = Object.keys(terminals);
    if (keys.length > 0) switchTerminal(keys[keys.length - 1]);
    else activeTermId = null;
}

function switchTerminal(id) {
  activeTermId = id;
  Object.keys(terminals).forEach(k => {
    terminals[k].div.style.display = (k === id) ? 'block' : 'none';
    if (k === id) {
        setTimeout(() => {
            terminals[k].fit.fit();
            terminals[k].x.focus();
        }, 50);
    }
  });
  document.querySelectorAll('.term-tab').forEach((t, i) => {
    t.classList.toggle('active', Object.keys(terminals)[i] === id);
  });
}

function toggleTermKey(btn, key) {
    termModifiers[key] = !termModifiers[key];
    btn.classList.toggle('active', termModifiers[key]);
}

function sendTermKey(key) {
    if (!activeTermId) return;
    const t = terminals[activeTermId];
    let code = '';
    if (key === 'Esc') code = '\x1b';
    else if (key === 'Tab') code = '\t';
    else if (key === 'Up') code = '\x1b[A';
    else if (key === 'Down') code = '\x1b[B';
    else if (key === 'Right') code = '\x1b[C';
    else if (key === 'Left') code = '\x1b[D';
    else code = key;

    if (t.ws.readyState === WebSocket.OPEN) t.ws.send(code);
    t.x.focus();
}

async function copyTerm() {
  if (!activeTermId) return;
  const text = terminals[activeTermId].x.getSelection();
  if (text) await navigator.clipboard.writeText(text);
}

async function pasteTerm() {
  const text = await navigator.clipboard.readText();
  if (activeTermId && text) terminals[activeTermId].ws.send(text);
}

// Inicialización de tabs al abrir panel terminal
let terminalInitialized = false;
function initTerminal() {
  if (terminalInitialized) return;
  terminalInitialized = true;
  newTerminal();
}
