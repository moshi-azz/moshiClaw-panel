// ─── SCREEN SHARE (getDisplayMedia) ──────────────────────────────────────────
// ─── SCREEN STREAM ────────────────────────────────────────────────────────────
function initScreen() {
  if (screenActive) return;
  screenActive = true;
  connectScreen();
}

function pauseScreen() {
  screenActive = false;
  if (screenWS) { screenWS.close(); screenWS = null; }
  window.removeEventListener('keydown', handleScreenKeydown);
}

function connectScreen() {
  if (!screenActive) return;
  if (screenWS) screenWS.close();

  // Escuchar inputs en ventana completa (si panel está activo)
  window.addEventListener('keydown', handleScreenKeydown);

  screenWS = new WebSocket(`${WS_BASE}/ws/screen?token=${authToken}`);
  const canvas = qs('#screen-canvas');
  const ctx = canvas.getContext('2d');
  const placeholder = qs('#screen-placeholder');

  screenWS.onopen = () => {
    show(canvas); hide(placeholder);
    screenFpsCounter = 0; lastFpsTime = Date.now();
  };

  screenWS.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'frame') {
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        qs('#screen-res').textContent = `${img.width}×${img.height}`;
      };
      img.src = 'data:image/jpeg;base64,' + msg.data;

      screenFpsCounter++;
      const now = Date.now();
      if (now - lastFpsTime >= 1000) {
        qs('#screen-fps').textContent = screenFpsCounter + ' fps';
        screenFpsCounter = 0; lastFpsTime = now;
      }
    } else if (msg.type === 'error') {
      hide(canvas); show(placeholder);
      const isLock = msg.message.includes('bloqueó') || msg.message.includes('🔒');
      placeholder.querySelector('.ph-icon').textContent = isLock ? '🔒' : '❌';
      placeholder.querySelector('p').textContent = msg.message;
    } else if (msg.type === 'info') {
      placeholder.querySelector('.ph-icon').textContent = '🖥️';
      placeholder.querySelector('p').textContent = msg.message;
    }
  };

  screenWS.onclose = () => {
    hide(canvas); show(placeholder);
    placeholder.querySelector('.ph-icon').textContent = '🖥️';
    placeholder.querySelector('p').textContent = 'Reconectando...';
    if (screenActive) setTimeout(connectScreen, 3000);
  };

  setupCanvasInput(canvas);
}

// ─── Control Remoto ──────────

function setupCanvasInput(canvas) {
  // Evitar que se asocien múltiples listeners
  if (canvas._hasInputSetup) return;
  canvas._hasInputSetup = true;

  // Calculador de offset a tamaño real de pantalla
  const getCoords = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  let dragging = false;

  canvas.addEventListener('mousedown', e => {
    if (!screenWS || screenWS.readyState !== WebSocket.OPEN) return;
    dragging = true;
    const { x, y } = getCoords(e);
    // Mousemove previo al click para ubicarnos, y luego click
    screenWS.send(JSON.stringify({ type: 'mousemove', x, y }));
    screenWS.send(JSON.stringify({ type: 'mousedown', button: processButton(e.button) }));
  });

  canvas.addEventListener('mousemove', e => {
    if (!dragging || !screenWS || screenWS.readyState !== WebSocket.OPEN) return;
    const { x, y } = getCoords(e);
    screenWS.send(JSON.stringify({ type: 'mousemove', x, y }));
  });

  canvas.addEventListener('mouseup', e => {
    if (!screenWS || screenWS.readyState !== WebSocket.OPEN) return;
    dragging = false;
    const { x, y } = getCoords(e);
    screenWS.send(JSON.stringify({ type: 'mousemove', x, y }));
    screenWS.send(JSON.stringify({ type: 'mouseup', button: processButton(e.button) }));
  });

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // Soporte básico para Touch (Mobile)
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    if (!screenWS || screenWS.readyState !== WebSocket.OPEN) return;
    dragging = true;
    const touch = e.touches[0];
    const { x, y } = getCoords(touch);
    screenWS.send(JSON.stringify({ type: 'mousemove', x, y }));
    screenWS.send(JSON.stringify({ type: 'mousedown', button: 1 }));
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!dragging || !screenWS || screenWS.readyState !== WebSocket.OPEN) return;
    const touch = e.touches[0];
    const { x, y } = getCoords(touch);
    screenWS.send(JSON.stringify({ type: 'mousemove', x, y }));
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    if (!screenWS || screenWS.readyState !== WebSocket.OPEN) return;
    dragging = false;
    screenWS.send(JSON.stringify({ type: 'mouseup', button: 1 }));
  }, { passive: false });
}

function processButton(b) {
  if (b === 0) return 1; // Left
  if (b === 1) return 2; // Middle
  if (b === 2) return 3; // Right
  return 1;
}

function handleScreenKeydown(e) {
  if (!screenActive || !screenWS || screenWS.readyState !== WebSocket.OPEN) return;
  // No capturar teclas si estás escribiendo en input (ej: navegador URL)
  if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

  e.preventDefault();
  screenWS.send(JSON.stringify({ type: 'keydown', key: e.key }));
}

// ─── BROWSER ──────────────────────────────────────────────────────────────────
function navBrowser() {
    let url = qs('#browser-url').value;
    if (!url.startsWith('http')) url = 'https://' + url;
    eventsWS.send(JSON.stringify({ type: 'browser', action: 'navigate', url }));
}

function browserRefresh() {
    const url = qs('#browser-url').value;
    if (url) navBrowser();
    else eventsWS && eventsWS.send(JSON.stringify({ type: 'browser', action: 'screenshot' }));
}

function browserScroll(dir) {
    // Scroll usando evaluate en el navegador headless
    eventsWS && eventsWS.send(JSON.stringify({
        type: 'browser', action: 'scroll', direction: dir
    }));
}

function browserManualScreenshot() {
    eventsWS && eventsWS.send(JSON.stringify({ type: 'browser', action: 'screenshot' }));
}

function updateBrowserScreenshot(imgB64) {
    const img = qs('#browser-img');
    if (img) img.src = 'data:image/jpeg;base64,' + imgB64;
    const placeholder = qs('#browser-placeholder');
    if (placeholder) placeholder.style.display = 'none';
    if (img) img.style.display = 'block';
}

// ─── WEBCAM ───────────────────────────────────────────────────────────────────
let webcamActive = false;
function initWebcam() { webcamActive = true; }
function pauseWebcam() { webcamActive = false; }
async function takeWebcamSnap() {
    qs('#webcam-msg').style.display = 'block';
    qs('#webcam-msg').textContent = 'Capturando...';
    qs('#webcam-img').style.display = 'none';

    try {
        const res = await fetch(`/api/webcam-snap?token=${authToken}`);
        const data = await res.json();
        if (data.image) {
            qs('#webcam-img').src = 'data:image/jpeg;base64,' + data.image;
            qs('#webcam-img').style.display = 'block';
            qs('#webcam-msg').style.display = 'none';
        } else {
            qs('#webcam-msg').textContent = data.error || 'Error al capturar webcam';
        }
    } catch(err) {
        qs('#webcam-msg').textContent = 'Error de conexión';
    }
}
