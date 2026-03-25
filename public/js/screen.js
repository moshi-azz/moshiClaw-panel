// ─── SCREEN (Remote Desktop) ──────────────────────────────────────────────────
function initScreen() {
  if (screenActive) return;
  screenActive = true;
  connectScreen();
}

function pauseScreen() {
  screenActive = false;
  if (screenWS) screenWS.close();
}

function resumeScreen() {
  if (!screenActive) {
      screenActive = true;
      connectScreen();
  }
}

function connectScreen() {
  if (screenWS) screenWS.close();
  const canvas = qs('#screen-canvas');
  const ctx = canvas.getContext('2d');
  const placeholder = qs('#screen-placeholder');

  screenWS = new WebSocket(`${WS_BASE}/ws/screen?token=${authToken}`);
  screenWS.binaryType = 'arraybuffer';

  screenWS.onopen = () => {
    hide(placeholder); show(canvas);
  };

  screenWS.onmessage = (e) => {
    if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data);
        if (msg.type === 'error') {
            hide(canvas); show(placeholder);
            const isLock = msg.message.includes('bloqueó') || msg.message.includes('🔒');
            placeholder.querySelector('.ph-icon').textContent = isLock ? '🔒' : '❌';
            placeholder.querySelector('p').textContent = msg.message;
        } else if (msg.type === 'info') {
            placeholder.querySelector('.ph-icon').textContent = '🖥️';
            placeholder.querySelector('p').textContent = msg.message;
        }
        return;
    }

    // Binario (JPEG)
    const blob = new Blob([e.data], { type: 'image/jpeg' });
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      qs('#screen-res').textContent = `${img.width}×${img.height}`;
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(blob);

    screenFpsCounter++;
    const now = Date.now();
    if (now - lastFpsTime >= 1000) {
      qs('#screen-fps').textContent = screenFpsCounter + ' fps';
      screenFpsCounter = 0; lastFpsTime = now;
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

function setupCanvasInput(canvas) {
  if (canvas._hasInputSetup) return;
  canvas._hasInputSetup = true;

  const getCoords = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const sendEvent = (type, e, extra = {}) => {
    if (!screenWS || screenWS.readyState !== WebSocket.OPEN) return;
    const { x, y } = getCoords(e);
    screenWS.send(JSON.stringify({ type: 'mouse', action: type, x, y, ...extra }));
  };

  canvas.addEventListener('mousedown', e => sendEvent('mousedown', e, { button: e.button === 2 ? 'right' : 'left' }));
  canvas.addEventListener('mouseup', e => sendEvent('mouseup', e, { button: e.button === 2 ? 'right' : 'left' }));
  canvas.addEventListener('mousemove', e => { if (e.buttons > 0) sendEvent('mousemove', e); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // Teclado (si el canvas tiene foco o es global mientras el panel screen es activo)
  window.addEventListener('keydown', e => {
    if (qs('#panel-screen').classList.contains('active')) {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (screenWS && screenWS.readyState === WebSocket.OPEN) {
        screenWS.send(JSON.stringify({ type: 'key', action: 'keydown', key: e.key }));
        if (['Backspace', 'Tab', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
      }
    }
  });
}
