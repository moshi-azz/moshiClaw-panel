// server.js — Servidor principal moshiClaw Panel
require('dotenv').config();

const express = require('express');
const http    = require('http');
const https   = require('https');
const WebSocket = require('ws');
const path = require('path');
const fs   = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { login, authMiddleware, authWebSocket } = require('./modules/auth');
const monitoring = require('./modules/monitoring');
const terminal = require('./modules/terminal');
const screen = require('./modules/screen');
const ai = require('./modules/ai');
const browser = require('./modules/browser');
const files = require('./modules/files');
const webcam = require('./modules/webcam');
const scripts = require('./modules/scripts');
const statsHistory = require('./modules/stats_history');
const whatsapp = require('./modules/whatsapp');
const messenger = require('./modules/messenger');
const autoresponder = require('./modules/autoresponder');
const skills        = require('./modules/skills');


const PORT = process.env.PORT || 3000;
const app = express();

// ─── HTTPS si hay certificados, si no HTTP ────────────────────────────────────
const CERT_KEY  = path.join(__dirname, 'certs', 'key.pem');
const CERT_CERT = path.join(__dirname, 'certs', 'cert.pem');
const USE_HTTPS = fs.existsSync(CERT_KEY) && fs.existsSync(CERT_CERT);

const server = USE_HTTPS
  ? https.createServer({ key: fs.readFileSync(CERT_KEY), cert: fs.readFileSync(CERT_CERT) }, app)
  : http.createServer(app);

// ─── SEGURIDAD ────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Para permitir xterm.js desde CDN
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '1mb' }));

// Rate limiting en login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  message: { error: 'Demasiados intentos. Espera 15 minutos.' }
});

// ─── WEBSOCKET SERVERS ────────────────────────────────────────────────────────
const wsTerminal = new WebSocket.Server({ noServer: true });
const wsScreen = new WebSocket.Server({ noServer: true });
const wsEvents = new WebSocket.Server({ noServer: true });

// Routing de WebSocket según path
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://localhost`);
  const user = authWebSocket(req);

  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  if (url.pathname === '/ws/terminal') {
    wsTerminal.handleUpgrade(req, socket, head, ws => {
      wsTerminal.emit('connection', ws, req, user);
    });
  } else if (url.pathname === '/ws/screen') {
    wsScreen.handleUpgrade(req, socket, head, ws => {
      wsScreen.emit('connection', ws, req, user);
    });
  } else if (url.pathname === '/ws/events') {
    wsEvents.handleUpgrade(req, socket, head, ws => {
      wsEvents.emit('connection', ws, req, user);
    });
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

// Terminal WS
wsTerminal.on('connection', (ws, req, user) => {
  console.log(`🖥️  Terminal conectada: ${user.user}`);
  terminal.handleWebSocket(ws, req, user);
});

// Screen WS
wsScreen.on('connection', (ws) => {
  console.log('📺 Screen viewer conectado');
  screen.handleWebSocket(ws);
});

// Events WS (stats + chat + notificaciones)
wsEvents.on('connection', (ws, req, user) => {
  console.log(`📡 Events conectado: ${user.user}`);

  // Enviar stats iniciales
  monitoring.getStats().then(stats => {
    if (stats) ws.send(JSON.stringify({ type: 'stats', data: stats }));
  });

  // Stats periódicos cada 2 segundos
  const statsInterval = setInterval(async () => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(statsInterval);
      return;
    }
    const stats = await monitoring.getStats();
    if (stats) {
      try { ws.send(JSON.stringify({ type: 'stats', data: stats })); } catch {}
    }
  }, 2000);

  // Mensajes del cliente (chat IA, confirmaciones, navegador)
  ws.on('message', async (msg) => {
    let data;
    try { data = JSON.parse(msg.toString()); } catch { return; }

    if (data.type === 'chat') {
      await handleChatMessage(ws, data, user);
    } else if (data.type === 'confirm_tool') {
      await ai.executeConfirmedTool(data.confirmId, data.toolName, data.args);
    } else if (data.type === 'cancel_tool') {
      ai.cancelToolExecution(data.confirmId);
    } else if (data.type === 'clear_chat') {
        ai.clearHistory(data.sessionId || user.user);
    } else if (data.type === 'stop_chat') {
        activeAiRequests.delete(data.sessionId || user.user);
    } else if (data.type === 'browser') {
        // Acciones de navegador
        if (data.action === 'launch') await browser.launch();
        if (data.action === 'navigate') {
            const res = await browser.navigate(data.url);
            ws.send(JSON.stringify({ type: 'browser_status', data: res }));
            // Auto-screenshot tras navegar
            const b64 = await browser.screenshot();
            if (b64) ws.send(JSON.stringify({ type: 'browser_screenshot', image: b64 }));
        }
        if (data.action === 'screenshot') {
            const b64 = await browser.screenshot();
            ws.send(JSON.stringify({ type: 'browser_screenshot', image: b64 }));
        }
        if (data.action === 'scroll') {
            const delta = data.direction === 'up' ? -600 : 600;
            await browser.scroll(delta);
            const b64 = await browser.screenshot();
            if (b64) ws.send(JSON.stringify({ type: 'browser_screenshot', image: b64 }));
        }
    }
  });

  ws.on('close', () => {
    clearInterval(statsInterval);
    activeAiRequests.delete(user.user);
    console.log(`📡 Events desconectado: ${user.user}`);
  });
});

// Initialize History
statsHistory.init(monitoring);


// ─── CHAT HANDLER ─────────────────────────────────────────────────────────────
const activeAiRequests = new Map();

async function handleChatMessage(ws, data, user) {
  const { message, provider, model, apiKey, sessionId, autoExecute, activeSkillId } = data;
  const sId = sessionId || user.user;

  if (!message || !provider || (!apiKey && provider !== 'ollama')) {
    ws.send(JSON.stringify({ type: 'chat_error', error: 'Faltan parámetros: message, provider, apiKey' }));
    return;
  }

  // El skill se lee on-demand desde ai.js cuando la IA llama read_skill()
  // Indicar que está pensando
  ws.send(JSON.stringify({ type: 'chat_thinking', sessionId: sId }));

  // Registrar solicitud activa
  activeAiRequests.set(sId, true);

  try {
    const response = await ai.chat({
      provider,
      apiKey,
      model,
      message,
      sessionId: sId,
      autoExecute: !!autoExecute,
      activeSkillId: activeSkillId || null,
      onToolCall: (toolEvent) => {
        // Verificar si la solicitud fue cancelada
        if (!activeAiRequests.has(sId)) return;

        try {
          if (toolEvent.type === 'browser_screenshot') {
            ws.send(JSON.stringify({ type: 'browser_screenshot', image: toolEvent.image }));
          } else {
            // IMPORTANTE: extraer 'type' de toolEvent para que no sobreescriba 'chat_tool'
            const { type: toolType, ...toolData } = toolEvent;
            ws.send(JSON.stringify({ type: 'chat_tool', toolType, ...toolData, sessionId: sId }));
          }
        } catch {}
      }
    });

    // Solo enviar respuesta si no fue cancelada
    if (activeAiRequests.has(sId)) {
      // Ollama devuelve { content, thinking }; otros providers devuelven string
      const content = (response && typeof response === 'object') ? response.content : (response || '');
      const thinking = (response && typeof response === 'object') ? (response.thinking || '') : '';
      ws.send(JSON.stringify({
        type: 'chat_response',
        sessionId: sId,
        content,
        thinking,
        provider
      }));
      activeAiRequests.delete(sId);
    }
  } catch (err) {
    if (activeAiRequests.has(sId)) {
      console.error('AI error:', err.message);
      ws.send(JSON.stringify({
        type: 'chat_error',
        sessionId: sId,
        error: `Error de IA: ${err.message}`
      }));
      activeAiRequests.delete(sId);
    }
  }
}

// ─── RUTAS REST ───────────────────────────────────────────────────────────────

// Login
app.post('/api/login', loginLimiter, (req, res) => {
  console.log('--- LOGIN ATTEMPT ---');
  console.log('IP:', req.ip);
  console.log('Body:', req.body);
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Faltan credenciales' });
  }
  const result = login(username, password);
  if (result.success) {
    console.log(`✅ Login exitoso: ${username}`);
    res.json({ token: result.token });
  } else {
    console.log(`❌ Login fallido para: ${username}`);
    res.status(401).json({ error: result.error });
  }
});

// Stats (REST, para PWA offline)
app.get('/api/stats', authMiddleware, async (req, res) => {
  const stats = await monitoring.getStats();
  if (stats) res.json(stats);
  else res.status(500).json({ error: 'Error obteniendo estadísticas' });
});

app.get('/api/stats/history', authMiddleware, (req, res) => {
  res.json({ history: statsHistory.getHistory() });
});


// Lista de procesos
app.get('/api/processes', authMiddleware, async (req, res) => {
  const procs = await monitoring.getProcesses();
  res.json({ processes: procs });
});

app.post('/api/processes/kill', authMiddleware, (req, res) => {
  const { pid } = req.body;
  if (!pid || isNaN(parseInt(pid))) {
    return res.status(400).json({ error: 'PID inválido' });
  }
  const { exec } = require('child_process');
  const targetPid = parseInt(pid);

  // Estrategia mejorada: matar proceso + todo su grupo de procesos (árbol de hijos)
  // 1. Obtener PGID del proceso
  exec(`ps -o pgid= -p ${targetPid} 2>/dev/null`, (pgidErr, pgidOut) => {
    const pgid = parseInt(pgidOut.trim()) || targetPid;

    // 2. Enviar SIGTERM al grupo completo (mata hijos también)
    const killGroupCmd = pgid > 1
      ? `kill -TERM -${pgid} 2>/dev/null || kill -TERM ${targetPid}`
      : `kill -TERM ${targetPid}`;

    exec(killGroupCmd, (err) => {
      if (err) {
        // 3. Si TERM falla, forzar con SIGKILL
        exec(`kill -KILL ${targetPid} 2>/dev/null || sudo kill -KILL ${targetPid}`, (err2) => {
          if (err2) return res.status(500).json({ success: false, error: err2.message });
          res.json({ success: true, message: `Proceso ${targetPid} terminado (KILL).` });
        });
        return;
      }
      res.json({ success: true, message: `Proceso ${targetPid} y su grupo terminados.` });
    });
  });
});

// ─── SCRIPTS (Phase 4) ────────────────────────────────────────────────────────
app.get('/api/scripts', authMiddleware, (req, res) => {
  res.json({ scripts: scripts.getScripts() });
});

app.post('/api/scripts/run', authMiddleware, async (req, res) => {
  const { id } = req.body;
  try {
    const result = await scripts.runScript(id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/scripts/add', authMiddleware, (req, res) => {
  const { name, cmd } = req.body;
  if (!name || !cmd) return res.status(400).json({ error: 'Faltan datos' });
  const newScript = scripts.addScript(name, cmd);
  res.json({ success: true, script: newScript });
});

app.delete('/api/scripts/:id', authMiddleware, (req, res) => {
  scripts.deleteScript(req.params.id);
  res.json({ success: true });
});
// ─── SISTEMA (Reboot/Shutdown/Cleanup) ─────────────────────────────────────────
app.post('/api/system/:action', authMiddleware, (req, res) => {
  const { action } = req.params;
  const { exec } = require('child_process');
  
  let cmd = '';
  let msg = '';

  if (action === 'reboot') {
    cmd = 'sudo reboot';
    msg = 'Reiniciando el sistema...';
  } else if (action === 'shutdown') {
    cmd = 'sudo shutdown -h now';
    msg = 'Apagando el sistema...';
  } else if (action === 'cleanup') {
    // Limpieza agresiva de temporales y logs de apt
    cmd = 'sudo rm -rf /tmp/* && sudo apt-get clean';
    msg = 'Limpieza de temporales completada.';
  } else {
    return res.status(400).json({ error: 'Acción no reconocida' });
  }

  console.log(`⚠️  SYSTEM ACTION: ${action} by authorized user`);
  
  exec(cmd, (err, stdout, stderr) => {
    if (action === 'cleanup') {
       if (err) {
           return res.status(500).json({ success: false, error: err.message });
       }
       return res.json({ success: true, message: msg });
    }
  });

  if (action !== 'cleanup') {
    res.json({ success: true, message: msg });
  }
});

// Captura de pantalla individual
app.get('/api/screenshot', authMiddleware, async (req, res) => {
  try {
    const b64 = await screen.takeSnapshot();
    res.json({ image: b64, timestamp: Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Captura de webcam (Phase 2)
app.get('/api/webcam-snap', authMiddleware, async (req, res) => {
  try {
    const b64 = await webcam.takeWebcamSnapshot();
    res.json({ image: b64, timestamp: Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── RUTAS DE FILES ───────────────────────────────────────────────────────────
const multer = require('multer');
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
      try {
          const base = '/home/moshi';
          const p = (req.body.path || '').replace(/^\/+/, '');
          const target = path.resolve(base, p);
          if (!target.startsWith(path.resolve(base))) throw new Error("Acción denegada");
          cb(null, target);
      } catch (err) {
          cb(err);
      }
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage: storage });

app.get('/api/files/list', authMiddleware, async (req, res) => {
    try {
        const items = await files.listFiles(req.query.path || '/');
        res.json({ success: true, items });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/files/download', authMiddleware, (req, res) => {
    try {
        const target = files.getDownloadPath(req.query.path);
        res.download(target);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get('/api/files/preview', authMiddleware, (req, res) => {
    try {
        const target = files.getDownloadPath(req.query.path);
        res.sendFile(target);
    } catch (err) {
        res.status(500).send(err.message);
    }
});


app.post('/api/files/upload', authMiddleware, upload.array('files'), (req, res) => {
    res.json({ success: true, message: "Archivos subidos correctamente." });
});

app.post('/api/files/rename', authMiddleware, async (req, res) => {
    try {
        await files.renameFile(req.body.path, req.body.newName);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/files/delete', authMiddleware, async (req, res) => {
    try {
         await files.deleteFileOrFolder(req.body.path);
         res.json({ success: true });
    } catch(err) {
         res.status(500).json({ success: false, error: err.message });
    }
});

// ─── MENSAJERÍA AUTO-RESPONDER ────────────────────────────────────────────────

// Función unificada de envío usada por autoresponder
async function sendReply(msg, text) {
  if (msg.platform === 'whatsapp') {
    await whatsapp.sendMessage(msg.from, text);
  } else if (msg.platform === 'messenger') {
    await messenger.sendMessage(msg.conversationUrl || msg.from, text);
  }
}

// Conectar eventos de WhatsApp y Messenger al autoresponder
whatsapp.emitter.on('message', async (msg) => {
  await autoresponder.processIncomingMessage(msg, sendReply);
});
messenger.emitter.on('message', async (msg) => {
  await autoresponder.processIncomingMessage(msg, sendReply);
});

// Emitir eventos de autoresponder a todos los WS conectados
autoresponder.emitter.on('pending_response', (pending) => {
  wsEvents.clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ar_pending', data: pending }));
  });
});
autoresponder.emitter.on('message_handled', (entry) => {
  wsEvents.clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ar_handled', data: entry }));
  });
});
autoresponder.emitter.on('mode_changed', (mode) => {
  wsEvents.clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ar_mode', mode }));
  });
});

// Estado general de mensajería
app.get('/api/messaging/status', authMiddleware, (req, res) => {
  res.json({
    whatsapp: whatsapp.getStatus(),
    messenger: messenger.getStatus(),
    autoresponder: autoresponder.getConfig(),
  });
});

// ─── MUTEX: evitar conflicto WA ↔ Messenger (ambos usan Chromium) ─────────────
let chromiumLock = null; // 'whatsapp' | 'messenger' | null

// Auto-liberar el mutex si el proceso termina inesperadamente
whatsapp.emitter.on('status', (s) => {
  if ((s === 'disconnected' || s === 'error') && chromiumLock === 'whatsapp') chromiumLock = null;
});
messenger.emitter.on('status', (ev) => {
  const s = typeof ev === 'string' ? ev : ev?.status;
  if ((s === 'disconnected' || s === 'error') && chromiumLock === 'messenger') chromiumLock = null;
});

// WhatsApp: iniciar (genera QR o código de teléfono)
app.post('/api/messaging/whatsapp/start', authMiddleware, async (req, res) => {
  if (chromiumLock === 'messenger') {
    return res.status(409).json({
      ok: false,
      error: '⚠️ Messenger está activo. Desconectá Messenger primero antes de conectar WhatsApp.'
    });
  }
  const phone = (req.body && req.body.phone) ? String(req.body.phone).replace(/\D/g, '') : null;
  chromiumLock = 'whatsapp';
  const result = await whatsapp.start(null, phone || null);
  if (!result.ok) chromiumLock = null;
  res.json(result);
});

// WhatsApp: estado actual (QR o pairing code)
app.get('/api/messaging/whatsapp/qr', authMiddleware, (req, res) => {
  const { qr, status, pairingCode } = whatsapp.getStatus();
  if (pairingCode) res.json({ pairingCode, status });
  else if (qr) res.json({ qr, status });
  else res.json({ status, msg: 'Sin QR disponible (ya conectado o no iniciado)' });
});

// WhatsApp: detener
app.post('/api/messaging/whatsapp/stop', authMiddleware, async (req, res) => {
  await whatsapp.stop();
  if (chromiumLock === 'whatsapp') chromiumLock = null;
  res.json({ ok: true });
});

// Messenger: iniciar (email + password)
app.post('/api/messaging/messenger/start', authMiddleware, async (req, res) => {
  if (chromiumLock === 'whatsapp') {
    return res.status(409).json({
      ok: false,
      error: '⚠️ WhatsApp está activo. Desconectá WhatsApp primero antes de conectar Messenger.'
    });
  }
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan email y password' });
  chromiumLock = 'messenger';
  const result = await messenger.start(email, password);
  if (!result.ok) chromiumLock = null;
  res.json(result);
});

// Messenger: reintentar después de 2FA manual
app.post('/api/messaging/messenger/retry2fa', authMiddleware, async (req, res) => {
  const result = await messenger.retryAfter2FA();
  res.json(result);
});

// Messenger: detener
app.post('/api/messaging/messenger/stop', authMiddleware, async (req, res) => {
  await messenger.stop();
  if (chromiumLock === 'messenger') chromiumLock = null;
  res.json({ ok: true });
});

// Enviar mensaje manual
app.post('/api/messaging/send', authMiddleware, async (req, res) => {
  const { platform, to, text } = req.body;
  try {
    if (platform === 'whatsapp') await whatsapp.sendMessage(to, text);
    else if (platform === 'messenger') await messenger.sendMessage(to, text);
    else return res.status(400).json({ error: 'Plataforma inválida' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Pendientes (modo SEMI)
app.get('/api/messaging/pending', authMiddleware, (req, res) => {
  res.json({ pending: autoresponder.getPending() });
});

// Aprobar respuesta pendiente
app.post('/api/messaging/approve/:pendingId', authMiddleware, async (req, res) => {
  const result = await autoresponder.approveResponse(req.params.pendingId, sendReply);
  res.json(result);
});

// Rechazar respuesta pendiente
app.post('/api/messaging/reject/:pendingId', authMiddleware, (req, res) => {
  res.json(autoresponder.rejectResponse(req.params.pendingId));
});

// Historial
app.get('/api/messaging/history', authMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ history: autoresponder.getHistory(limit) });
});

// Modo global
app.post('/api/messaging/mode', authMiddleware, (req, res) => {
  const { mode } = req.body;
  res.json(autoresponder.setMode(mode));
});

// Modo por plataforma
app.post('/api/messaging/platform-mode', authMiddleware, (req, res) => {
  const { platform, mode } = req.body;
  res.json(autoresponder.setPlatformMode(platform, mode));
});

// Bloquear / desbloquear contacto
app.post('/api/messaging/block', authMiddleware, (req, res) => {
  const { identifier } = req.body;
  res.json(autoresponder.blockContact(identifier));
});
app.post('/api/messaging/unblock', authMiddleware, (req, res) => {
  const { identifier } = req.body;
  res.json(autoresponder.unblockContact(identifier));
});

// Actualizar parámetro en tiempo real
app.post('/api/messaging/config', authMiddleware, (req, res) => {
  const { key, value } = req.body;
  res.json(autoresponder.setConfig(key, value));
});

// ─── SKILLS (SKILL.md ecosystem) ─────────────────────────────────────────────

// Listar todos los skills
app.get('/api/skills', authMiddleware, (req, res) => {
  res.json({ skills: skills.listSkills() });
});

// Obtener contenido raw de un skill
app.get('/api/skills/:id', authMiddleware, (req, res) => {
  const content = skills.getSkillContent(req.params.id);
  if (!content) return res.status(404).json({ error: 'Skill no encontrado' });
  res.json({ content });
});

// Crear o actualizar un skill
app.post('/api/skills', authMiddleware, (req, res) => {
  const { id, name, description, icon, tags, content } = req.body;
  if (!name) return res.status(400).json({ error: 'name es requerido' });
  try {
    const finalId = skills.createSkill({ id, name, description, icon, tags, content });
    res.json({ success: true, id: finalId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar un skill
app.delete('/api/skills/:id', authMiddleware, (req, res) => {
  const ok = skills.deleteSkill(req.params.id);
  res.json({ success: ok });
});

// Instalar skill desde GitHub
app.post('/api/skills/install-github', authMiddleware, async (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl) return res.status(400).json({ error: 'repoUrl es requerido' });
  try {
    const result = await skills.installFromGitHub(repoUrl);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check (sin auth)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

// ─── FRONTEND ESTÁTICO ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Service-Worker-Allowed', '/');
    }
  }
}));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── INICIO ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  const protocol = USE_HTTPS ? 'https' : 'http';
  // Obtener IP local
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  const localIP = Object.values(nets).flat().find(n => n.family === 'IPv4' && !n.internal)?.address || 'TU_IP';

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║       🦅  MOSHICLAW PANEL  🦅            ║');
  console.log('╚════════════════════════════════════════╝');
  if (USE_HTTPS) {
    console.log(`\n🔒 Modo HTTPS activo (certificado autofirmado)`);
    console.log(`✅ getDisplayMedia() funcionará desde cualquier dispositivo`);
  } else {
    console.log(`\n⚠️  Modo HTTP — getDisplayMedia() solo funciona en localhost`);
    console.log(`   Para habilitarlo en red local, generá certificados con: ./setup.sh`);
  }
  console.log(`\n🚀 Local:     ${protocol}://localhost:${PORT}`);
  console.log(`🌐 Red local: ${protocol}://${localIP}:${PORT}`);
  console.log(`📡 WebSockets: /ws/terminal  /ws/screen  /ws/events`);
  if (USE_HTTPS) console.log(`\n⚠️  Primera vez: el navegador mostrará advertencia de cert. → Aceptá y continuá.`);
  console.log(`\n⚡ Para acceso desde internet: ngrok http ${PORT}`);
  console.log('\n🔑 Credenciales guardadas en .env\n');
});

// Graceful shutdown
process.on('SIGTERM', () => { screen.stopStream(); server.close(); });
process.on('SIGINT', () => { screen.stopStream(); server.close(); process.exit(0); });
