// ─── JARVIS VOICE ASSISTANT ───────────────────────────────────────────────────
let lastQueryWasVoice = false; // true when last query was sent via microphone
let jarvisMode     = false;
let jarvisRec      = null;   // wake word SpeechRecognition instance
let jarvisCapturing = false; // true while recording a command
let jarvisReady    = false;  // browser supports SpeechRecognition
let jarvisVoice    = null;   // Selected masculine voice
const WAKE_WORDS   = ['hey jarvis', 'oye jarvis', 'jarvis'];

const isIOS = () => {
  return [
    'iPad Simulator', 'iPhone Simulator', 'iPod Simulator', 'iPad', 'iPhone', 'iPod'
  ].includes(navigator.platform) || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
};

function updateJarvisVoice() {
  if (!window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) {
    console.log("🔊 Esperando a que el navegador cargue las voces...");
    return;
  }
  
  // Buscar voces masculinas en español — ordenadas de más grave a más neutral
  // iOS/Safari: Jorge, Juan, Diego, Jordi
  const preferred = [
    'alvaro', 'raul', 'carlos', 'antonio', 'hector', 'andrés', 'andres',
    'jorge', 'juan', 'diego', 'jordi',
    'pablo', 'david', 'microsoft helio', 'google español', 'espíritu', 'enrique', 'miguel',
    'microsoft raul', 'google castilian spanish male', 'spanish (argentina) male'
  ];
  
  const esVoices = voices.filter(v => v.lang.startsWith('es'));
  if (esVoices.length === 0) {
    // Si no hay español, intentar inglés o cualquiera para no quedar mudo (fallback total)
    jarvisVoice = voices.find(v => v.default) || voices[0];
    console.log("⚠️ No se encontraron voces en español. Usando:", jarvisVoice.name);
    return;
  }

  // 1. Buscar coincidencia exacta por nombre preferido (masculinas)
  for (const name of preferred) {
    const found = esVoices.find(v => v.name.toLowerCase().includes(name));
    if (found) {
      jarvisVoice = found;
      console.log("🤖 JARVIS Voice selected (Preferred):", found.name);
      return;
    }
  }

  // 2. Heurística para evitar voces femeninas conocidas si no hay preferred
  const femaleKeywords = ['helena', 'sabina', 'zira', 'laura', 'monica', 'elsa', 'hilda', 'susan', 'stella', 'paulina', 'carmen', 'rosa', 'maria', 'isabela', 'valentina', 'lucia'];
  const maleFallback = esVoices.find(v => !femaleKeywords.some(f => v.name.toLowerCase().includes(f)));
  
  jarvisVoice = maleFallback || esVoices[0];
  console.log("🤖 JARVIS Voice selected (Fallback):", jarvisVoice.name);
}

// Cargar voces al inicio y cuando cambian
if (window.speechSynthesis) {
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = updateJarvisVoice;
  }
  updateJarvisVoice();
  // Retry: algunos navegadores tardan en poblar la lista
  setTimeout(updateJarvisVoice, 500);
  setTimeout(updateJarvisVoice, 1500);
}

// Chrome bug: speechSynthesis se pausa solo si la página lleva un rato abierta
setInterval(() => {
  if (window.speechSynthesis && window.speechSynthesis.speaking) {
    window.speechSynthesis.pause();
    window.speechSynthesis.resume();
  }
}, 10000);

function initJarvis() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return; // not supported — buttons stay hidden
  jarvisReady = true;
  const toggleBtn = qs('#btn-jarvis-toggle');
  if (toggleBtn) toggleBtn.style.display = 'flex';
}

function toggleJarvisMode() {
  if (!jarvisReady) {
    addMessage('Tu navegador no soporta reconocimiento de voz. Usá Chrome o Edge.', 'system');
    return;
  }
  jarvisMode = !jarvisMode;
  const btn = qs('#btn-jarvis-toggle');
  if (jarvisMode) {
    btn.classList.add('jarvis-on');
    btn.title = 'JARVIS activo — clic para desactivar';
    jarvisBadge('wake', 'JARVIS escuchando...');
    startKeepAlive();
    startWakeListener();
  } else {
    btn.classList.remove('jarvis-on');
    btn.title = 'Activar JARVIS (wake word)';
    stopWakeListener();
    stopKeepAlive();
    jarvisBadgeHide();
  }
}

function startWakeListener() {
  if (!jarvisReady || !jarvisMode || jarvisCapturing) return;
  try {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    jarvisRec = new SR();
    
    // iOS Safari no soporta continuous: true correctamente y puede congelar la UI
    jarvisRec.continuous = !isIOS(); 
    jarvisRec.interimResults = true;
    jarvisRec.lang = 'es-AR';

    jarvisRec.onresult = (e) => {
      if (jarvisCapturing) return;
      const full = Array.from(e.results).map(r => r[0].transcript.toLowerCase()).join(' ');
      for (const w of WAKE_WORDS) {
        if (full.includes(w)) {
          stopWakeListener();
          captureCommand();
          break;
        }
      }
    };

    jarvisRec.onend = () => {
      jarvisRec = null;
      if (jarvisMode && !jarvisCapturing) {
        // Delay más largo en iOS para evitar bloqueos por reinicio rápido
        setTimeout(() => startWakeListener(), isIOS() ? 1000 : 400);
      }
    };

    jarvisRec.onerror = (e) => {
      console.warn("🎙️ WakeListener error:", e.error);
      jarvisRec = null;
      if (e.error === 'no-speech') return;
      if (jarvisMode && !jarvisCapturing) {
        setTimeout(() => startWakeListener(), isIOS() ? 2000 : 1200);
      }
    };

    jarvisRec.start();
  } catch (err) {
    console.error("❌ Error iniciando WakeListener:", err);
    jarvisReady = false;
  }
}

function stopWakeListener() {
  if (jarvisRec) { try { jarvisRec.stop(); } catch(e) {} jarvisRec = null; }
}

function captureCommand() {
  jarvisCapturing = true;
  jarvisBadge('cmd', 'Te escucho...');
  speakJarvis('Dime');

  try {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'es-AR';

    const timeout = setTimeout(() => { try { rec.stop(); } catch(e) {} }, 8000);

    rec.onresult = (e) => {
      clearTimeout(timeout);
      const cmd = e.results[0][0].transcript.trim();
      if (cmd) {
        if (!qs('#panel-chat').classList.contains('active')) switchPanel('chat');
        lastQueryWasVoice = true;
        qs('#chat-input').value = cmd;
        sendChatMessage();
      }
    };

    const done = () => {
      clearTimeout(timeout);
      jarvisCapturing = false;
      if (jarvisMode) { 
        jarvisBadge('wake', 'JARVIS escuchando...'); 
        setTimeout(() => startWakeListener(), 500); 
      }
      else jarvisBadgeHide();
    };
    rec.onend = done;
    rec.onerror = (e) => { console.warn("🎙️ Capture error:", e.error); done(); };

    rec.start();
  } catch (err) {
    console.error("❌ Error en captureCommand:", err);
    jarvisCapturing = false;
    if (jarvisMode) startWakeListener();
  }
}

// ── Manual mic button ──
let manualRec = null;
function toggleManualMic() {
  if (!jarvisReady) {
    addMessage('Tu navegador no soporta reconocimiento de voz. Usá Chrome o Edge.', 'system');
    return;
  }
  const btn = qs('#btn-mic');
  if (manualRec) {
    try { manualRec.stop(); } catch(e) {}
    manualRec = null;
    btn.classList.remove('listening');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  manualRec = new SR();
  manualRec.continuous = false;
  manualRec.interimResults = false;
  manualRec.lang = 'es-AR';
  btn.classList.add('listening');

  manualRec.onresult = (e) => {
    const text = e.results[0][0].transcript.trim();
    if (text) { lastQueryWasVoice = true; qs('#chat-input').value = text; sendChatMessage(); }
  };
  const stopManual = () => { btn.classList.remove('listening'); manualRec = null; };
  manualRec.onend = stopManual;
  manualRec.onerror = stopManual;
  try { manualRec.start(); } catch(e) { stopManual(); }
}

// ── Background keepalive — audio silencioso para evitar suspensión (Android) ──
let _keepAliveCtx = null;
let _keepAliveSrc = null;
function startKeepAlive() {
  if (_keepAliveCtx) return;
  try {
    _keepAliveCtx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = _keepAliveCtx.createBuffer(1, _keepAliveCtx.sampleRate, _keepAliveCtx.sampleRate);
    _keepAliveSrc = _keepAliveCtx.createBufferSource();
    _keepAliveSrc.buffer = buf;
    _keepAliveSrc.loop = true;
    _keepAliveSrc.connect(_keepAliveCtx.destination);
    _keepAliveSrc.start();
  } catch(e) {}
}
function stopKeepAlive() {
  try { _keepAliveSrc && _keepAliveSrc.stop(); } catch(e) {}
  try { _keepAliveCtx && _keepAliveCtx.close(); } catch(e) {}
  _keepAliveSrc = null;
  _keepAliveCtx = null;
}

// ── Notificación de respuesta JARVIS ──
function jarvisNotify(text) {
  const clean = text
    .replace(/```[\s\S]*?```/g, '[código]')
    .replace(/`[^`]+`/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/#+\s/g, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .trim()
    .slice(0, 200);
  if (clean) ccNotify('🤖 JARVIS', clean, 'jarvis-response');
}

// ── TTS ──
function _doSpeak(text, rate, pitch) {
  if (!window.speechSynthesis) return;
  if (!text) return;
  logDebug("TTS: Intentando hablar... " + text.slice(0, 20));

  if (!jarvisVoice) updateJarvisVoice();
  window.speechSynthesis.cancel();
  
  // Extra help for Safari: try to resume just before speaking
  if (window.speechSynthesis.paused) window.speechSynthesis.resume();

  setTimeout(() => {
    try {
      window.speechSynthesis.resume();
      if (!jarvisVoice) updateJarvisVoice();

      const utt = new SpeechSynthesisUtterance(text);
      if (jarvisVoice) {
        utt.voice = jarvisVoice;
        utt.lang = jarvisVoice.lang;
      } else {
        utt.lang = 'es-AR';
      }

      utt.rate = rate;
      utt.pitch = pitch;
      utt.volume = 1.0;

      utt.onstart = () => logDebug("🗣️ JARVIS hablando...");
      utt.onerror = (e) => {
        logDebug("🔇 TTS Error: " + e.error);
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
           window.speechSynthesis.cancel();
           window.speechSynthesis.resume();
        }
      };
      
      window.speechSynthesis.speak(utt);
    } catch (err) {
      logDebug("TTS Fatal Error: " + err.message);
    }
  }, 100);
}

function speakJarvis(text) {
  if (!window.speechSynthesis || !jarvisMode) return;
  // Jarvis: tono formal, un poco más grave y pausado
  _doSpeak(text, 0.9, 0.5);
}

function speakResponse(text) {
  if (!window.speechSynthesis || (!jarvisMode && !lastQueryWasVoice)) return;
  
  // Limpiar texto para lectura
  const clean = text
    .replace(/```[\s\S]*?```/g, 'Aquí tienes el código.')
    .replace(/`[^`]+`/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/#+\s/g, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();

  if (clean.length === 0) return;

  if (jarvisMode) {
    speakJarvis(clean);
  } else {
    lastQueryWasVoice = false;
    _doSpeak(clean.slice(0, 500), 0.9, 0.55);
  }
}

// ── Badge helpers ──
function jarvisBadge(mode, text) {
  const b = qs('#jarvis-badge');
  b.className = 'active' + (mode === 'cmd' ? ' cmd' : '');
  qs('#jarvis-badge-text').textContent = text;
}
function jarvisBadgeHide() { qs('#jarvis-badge').className = ''; }
