// modules/screen.js — Streaming de pantalla via WebSocket
// Soporta: ffmpeg x11grab (X11), grim (Wayland wlroots), gnome-screenshot (GNOME Wayland)
const { spawn, execSync, exec } = require('child_process');
const fs = require('fs');

let ffmpegProcess   = null;
let waylandInterval = null;
const screenSubscribers = new Set();

// ─── Detección de entorno ────────────────────────────────────────────────────

function isWayland() {
  const sessionType = process.env.XDG_SESSION_TYPE || '';
  const waylandDisp = process.env.WAYLAND_DISPLAY  || '';
  return sessionType.toLowerCase() === 'wayland' || waylandDisp !== '';
}

function getValidDisplay() {
  const raw = process.env.DISPLAY || ':0';
  if (/^\:[0-9]+(\.[0-9]+)?$/.test(raw)) return raw;
  console.warn(`⚠️  DISPLAY inválido "${raw}", usando :0`);
  return ':0';
}

function has(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; }
}

// ─── Captura en modo WAYLAND ─────────────────────────────────────────────────

// Detectar desktop environment
function desktopEnv() {
  const d = (process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '').toLowerCase();
  if (d.includes('gnome') || process.env.GNOME_DESKTOP_SESSION_ID) return 'gnome';
  if (d.includes('kde')   || d.includes('plasma'))                  return 'kde';
  if (d.includes('sway')  || d.includes('hyprland') || d.includes('wlroots')) return 'wlroots';
  return 'unknown';
}

function captureWayland(outPath, cb) {
  const env = { ...process.env };
  const de  = desktopEnv();

  if (de === 'gnome') {
    // GNOME Wayland: llamar D-Bus de GNOME Shell DIRECTAMENTE.
    // gnome-screenshot falla porque con DISPLAY seteado usa backend X11 (negro).
    // gdbus llama al compositor Wayland real, igual que PrtSc.
    const pngPath = '/tmp/_gnome_raw.png';
    const dbusCmd = `gdbus call --session \
      --dest org.gnome.Shell \
      --object-path /org/gnome/Shell/Screenshot \
      --method org.gnome.Shell.Screenshot.Screenshot \
      false false "${pngPath}"`;

    exec(dbusCmd, { env }, (err, stdout, stderr) => {
      if (err) {
        const isAccessDenied = (stderr || err.message || '').includes('AccessDenied');
        if (isAccessDenied) {
          // GNOME 42+ bloquea screenshots de procesos no privilegiados.
          // No hay workaround limpio en Wayland. Informar al usuario.
          console.error('❌ GNOME bloqueó el screenshot (AccessDenied).');
          console.error('   Solución: cerrá sesión → elegí "Ubuntu on Xorg" → reiniciá el servidor.');
          cb(new Error('GNOME_ACCESS_DENIED'));
        } else {
          // Otro error (D-Bus no disponible, etc.): intentar gnome-screenshot con backend forzado
          const wayland_env = { ...env, GDK_BACKEND: 'wayland', DISPLAY: '' };
          exec(`gnome-screenshot -f ${outPath}`, { env: wayland_env }, cb);
        }
      } else {
        // Convertir PNG → JPEG (gdbus siempre guarda PNG)
        exec(`ffmpeg -y -i ${pngPath} -q:v 4 ${outPath} -loglevel quiet`, { env }, cb);
      }
    });

  } else if (de === 'kde' && has('spectacle')) {
    exec(`spectacle -b -n -o ${outPath}`, { env }, cb);
  } else if (has('grim')) {
    // wlroots (Sway, Hyprland) — NO funciona en GNOME
    exec(`grim -t jpeg -q 80 ${outPath}`, { env }, cb);
  } else if (has('gnome-screenshot')) {
    exec(`gnome-screenshot -f ${outPath}`, { env }, cb);
  } else {
    cb(new Error('Sin capturador Wayland. Instalá: sudo apt install gnome-screenshot'));
  }
}

// Elegir mejor herramienta para el DE actual
function bestWaylandTool() {
  const de = desktopEnv();
  if (de === 'gnome')                         return 'gdbus→GNOME Shell';
  if (de === 'kde'   && has('spectacle'))     return 'spectacle';
  if (has('grim'))                            return 'grim (wlroots)';
  if (has('gnome-screenshot'))                return 'gnome-screenshot';
  if (has('spectacle'))                       return 'spectacle';
  return null;
}

function startWaylandStream() {
  if (waylandInterval) return;

  const tool = bestWaylandTool();

  if (!tool) {
    console.error('❌ Wayland detectado pero sin herramienta de captura.');
    console.error('   Instalá: sudo apt install grim  (wlroots) o gnome-screenshot (GNOME)');
    screenSubscribers.forEach(ws => ws.send(JSON.stringify({
      type: 'error',
      message: 'Wayland detectado. Instalá "grim" (sudo apt install grim) o cambiá a sesión X11.'
    })));
    return;
  }

  console.log(`📺 Wayland detectado — usando ${tool} para captura (~5fps)`);

  const outPath = '/tmp/_panel_wayland.jpg';
  let capturing = false;

  let accessDeniedSent = false;

  waylandInterval = setInterval(() => {
    if (screenSubscribers.size === 0) { clearInterval(waylandInterval); waylandInterval = null; return; }
    if (capturing) return;
    capturing = true;

    captureWayland(outPath, (err) => {
      capturing = false;
      if (err) {
        if (err.message === 'GNOME_ACCESS_DENIED' && !accessDeniedSent) {
          accessDeniedSent = true;
          clearInterval(waylandInterval);
          waylandInterval = null;
          const msg = JSON.stringify({
            type: 'error',
            message: '🔒 GNOME bloqueó la captura de pantalla.\n\nSolución: cerrá sesión → en la pantalla de login hacé clic en ⚙️ → elegí "Ubuntu on Xorg" → iniciá sesión → reiniciá el servidor con ./start.sh'
          });
          screenSubscribers.forEach(ws => {
            if (ws.readyState === 1) try { ws.send(msg); } catch {}
          });
        }
        return;
      }
      try {
        const data = fs.readFileSync(outPath);
        broadcastFrame(data);
      } catch {}
    });
  }, 200); // ~5fps
}

// ─── Stream MJPEG con ffmpeg (X11) ──────────────────────────────────────────

function getScreenSize() {
  try {
    const display = getValidDisplay();
    const out = execSync("xdpyinfo | grep dimensions | awk '{print $2}'", {
      env: { ...process.env, DISPLAY: display }
    }).toString().trim();
    return out || '1920x1080';
  } catch { return '1920x1080'; }
}

function startFFmpegStream() {
  if (ffmpegProcess) return;

  const display    = getValidDisplay();
  const screenSize = getScreenSize();
  const fps        = 10;

  console.log(`📺 Iniciando stream X11 (${screenSize} @ ${fps}fps, DISPLAY=${display})`);

  ffmpegProcess = spawn('ffmpeg', [
    '-loglevel', 'quiet',
    '-f', 'x11grab',
    '-video_size', screenSize,
    '-framerate', String(fps),
    '-i', display,
    '-vf', 'scale=1280:-2',
    '-vcodec', 'mjpeg',
    '-q:v', '4',
    '-f', 'image2pipe',
    'pipe:1'
  ], { env: { ...process.env, DISPLAY: display } });

  let buffer = Buffer.alloc(0);

  ffmpegProcess.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let start = 0;
    while (true) {
      const soiIdx = buffer.indexOf(Buffer.from([0xFF, 0xD8]), start);
      if (soiIdx === -1) break;
      const eoiIdx = buffer.indexOf(Buffer.from([0xFF, 0xD9]), soiIdx + 2);
      if (eoiIdx === -1) break;
      broadcastFrame(buffer.slice(soiIdx, eoiIdx + 2));
      start = eoiIdx + 2;
    }
    if (start > 0) buffer = buffer.slice(start);
  });

  ffmpegProcess.stderr.on('data', () => {});

  ffmpegProcess.on('exit', (code) => {
    ffmpegProcess = null;
    if (screenSubscribers.size === 0) return;

    // Si falla rápido varias veces, podría ser Wayland no detectado
    if (code !== 0) {
      console.warn(`⚠️  ffmpeg terminó (código ${code}). ¿Estás en Wayland? Reiniciando en 3s...`);
      setTimeout(startFFmpegStream, 3000);
    }
  });

  ffmpegProcess.on('error', (err) => {
    console.error('ffmpeg error:', err.message);
    ffmpegProcess = null;
  });
}

// ─── Broadcast ────────────────────────────────────────────────────────────────

function broadcastFrame(frameBuffer) {
  if (screenSubscribers.size === 0) return;
  const msg = JSON.stringify({ type: 'frame', data: frameBuffer.toString('base64') });
  screenSubscribers.forEach(ws => {
    if (ws.readyState === 1) {
      try { ws.send(msg); } catch {}
    } else {
      screenSubscribers.delete(ws);
    }
  });
}

// ─── Control ─────────────────────────────────────────────────────────────────

function stopStream() {
  if (ffmpegProcess) { ffmpegProcess.kill('SIGTERM'); ffmpegProcess = null; }
  if (waylandInterval) { clearInterval(waylandInterval); waylandInterval = null; }
}

function handleWebSocket(ws) {
  screenSubscribers.add(ws);

  // Enviar info de sesión al conectar
  const sessionInfo = isWayland()
    ? '🌊 Sesión Wayland detectada (capturas ~5fps)'
    : '🖥️  Sesión X11 — stream MJPEG activo';
  ws.send(JSON.stringify({ type: 'info', message: sessionInfo }));

  if (screenSubscribers.size === 1) {
    if (isWayland()) {
      startWaylandStream();
    } else if (has('ffmpeg')) {
      startFFmpegStream();
    } else if (has('scrot')) {
      startScrotFallback();
    } else {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Sin herramienta de captura. Corré setup.sh primero.'
      }));
    }
  }

  ws.on('close', () => {
    screenSubscribers.delete(ws);
    if (screenSubscribers.size === 0) stopStream();
  });

  ws.on('error', () => screenSubscribers.delete(ws));

  // Recibir eventos de control (solo funcionan en X11 con xdotool)
  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      if (!has('xdotool') || isWayland()) return; // Solo X11 soportado por ahora
      
      const env = { ...process.env, DISPLAY: getValidDisplay() };
      
      if (data.type === 'mousemove') {
        const cmd = `xdotool mousemove ${Math.round(data.x)} ${Math.round(data.y)}`;
        exec(cmd, { env }, () => {}); // Ejecución asíncrona rápida sin callback
      } else if (data.type === 'mousedown') {
        exec(`xdotool mousedown ${data.button}`, { env }, () => {});
      } else if (data.type === 'mouseup') {
        exec(`xdotool mouseup ${data.button}`, { env }, () => {});
      } else if (data.type === 'keydown') {
        let key = data.key;
        if (key === 'Enter') key = 'Return';
        if (key === 'Backspace') key = 'BackSpace';
        if (key === 'Control') key = 'ctrl';
        if (key === 'Alt') key = 'alt';
        if (key === 'Shift') key = 'shift';
        if (key === 'Escape') key = 'Escape';
        if (key.length === 1 || key === 'Return' || key === 'BackSpace' || key === 'Escape' || key === 'Tab') {
           exec(`xdotool key "${key}"`, { env }, () => {});
        }
      }
    } catch (e) {}
  });
}

// Fallback scrot (X11)
function startScrotFallback() {
  console.log('📺 Usando scrot para capturas (fallback X11)');
  const outPath = '/tmp/_panel_screen.jpg';
  let capturing = false;

  const interval = setInterval(() => {
    if (screenSubscribers.size === 0) { clearInterval(interval); return; }
    if (capturing) return;
    capturing = true;
    exec(`scrot -o ${outPath} -q 75`, { env: { ...process.env, DISPLAY: getValidDisplay() } }, (err) => {
      capturing = false;
      if (err) return;
      try { broadcastFrame(fs.readFileSync(outPath)); } catch {}
    });
  }, 200);
}

// Snapshot único (REST endpoint)
function takeSnapshot() {
  return new Promise((resolve, reject) => {
    const outPath = '/tmp/_snap.jpg';

    const done = (err) => {
      if (err) return reject(err);
      try { resolve(fs.readFileSync(outPath).toString('base64')); }
      catch (e) { reject(e); }
    };

    if (isWayland()) {
      captureWayland(outPath, done);
    } else {
      const display = getValidDisplay();
      const cmd = has('ffmpeg')
        ? `ffmpeg -loglevel quiet -f x11grab -video_size $(xdpyinfo|grep dimensions|awk '{print $2}') -frames:v 1 -i ${display} -vf scale=1280:-2 ${outPath} -y`
        : `scrot ${outPath} -q 80 -o`;
      exec(cmd, { env: { ...process.env, DISPLAY: display } }, done);
    }
  });
}

module.exports = { handleWebSocket, takeSnapshot, stopStream, isWayland };
