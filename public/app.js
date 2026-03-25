// ═══════════════════════════════════════════════════════════════════════════════
//  MOSHICLAW PANEL — Main entry point
// ═══════════════════════════════════════════════════════════════════════════════

// ─── APP INIT ─────────────────────────────────────────────────────────────────
function showApp() {
  qs('#login-screen').style.display = 'none';
  qs('#app').classList.add('visible');
  initCharts();
  connectEvents();
  
  // Restaurar historial de chat
  const container = qs('#chat-messages');
  if (chatHistory.length) {
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
  // Global Bindings
  qs('#btn-login').addEventListener('click', doLogin);
  qs('#login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  qs('#login-user').addEventListener('keydown', e => { if (e.key === 'Enter') qs('#login-pass').focus(); });
  qs('#btn-logout').addEventListener('click', logout);
  qs('#btn-settings').addEventListener('click', openSettings);
  qs('#btn-close-settings').addEventListener('click', closeSettings);
  qs('#btn-save-settings').addEventListener('click', saveSettings);
  
  if (activeSkillMeta) updateSkillBadge();

  // Chat Bindings
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

  qs('#chat-input').addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // UI Listeners
  document.addEventListener('focusin', e => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) document.body.classList.add('keyboard-open');
  });
  document.addEventListener('focusout', e => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) document.body.classList.remove('keyboard-open');
  });

  document.querySelectorAll('.tab-btn[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
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

  qs('#cfg-model-select').addEventListener('change', (e) => {
    qs('#manual-model-group').style.display = (e.target.value === 'custom') ? 'block' : 'none';
  });

  const toggleAuto = qs('#toggle-autoexec');
  if (autoExec) toggleAuto.classList.add('on');
  toggleAuto.addEventListener('click', () => {
    autoExec = !autoExec;
    toggleAuto.classList.toggle('on', autoExec);
  });

  const toggleCC = qs('#toggle-claudecode');
  if (toggleCC) {
    toggleCC.addEventListener('click', () => toggleCC.classList.toggle('on'));
  }

  const toggleExp = qs('#toggle-expertmode');
  if (toggleExp) {
    toggleExp.addEventListener('click', () => toggleExp.classList.toggle('on'));
  }

  // Restore state
  applyClaudeCodeSetting();
  if (authToken) showApp();

  // SW / Notifications
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'cc_notification_click') {
        const agentId = event.data.agentId;
        switchPanel('claudecode');
        if (agentId && ccAgents.has(agentId)) { ccSelectAgent(agentId); ccShowTerminal(); }
      }
    });
  }
  
  if (typeof lucide !== 'undefined') lucide.createIcons();
  if (typeof Artifacts !== 'undefined') Artifacts.init();
  if (typeof SubagentsUI !== 'undefined') SubagentsUI.init();

  initJarvis();

  // Visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (_keepAliveCtx && _keepAliveCtx.state === 'suspended') _keepAliveCtx.resume().catch(() => {});
      if (!eventsWS || eventsWS.readyState === WebSocket.CLOSED) connectEvents();
      setTimeout(() => { if (jarvisMode && !jarvisCapturing) startWakeListener(); }, 800);
    } else {
      stopWakeListener();
    }
  });
}

// ─── PANEL SWITCHING ──────────────────────────────────────────────────────────
function switchPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn[data-panel]').forEach(b => {
    b.classList.toggle('active', b.dataset.panel === name);
  });
  
  const isHiddenPanel = ['terminal', 'screen', 'browser', 'webcam', 'messaging', 'canva'].includes(name);
  qs('#btn-more-menu').classList.toggle('active', isHiddenPanel);

  const panel = qs(`#panel-${name}`);
  if (panel) panel.classList.add('active');

  // Lazy Init
  if (name === 'terminal') initTerminal();
  if (name === 'claudecode') initClaudeCode();
  if (name === 'screen') initScreen();
  if (name === 'monitor') { loadProcesses(); loadHealthHistory(); }
  if (name === 'scripts') loadScripts();
  if (name === 'messaging') refreshMessagingStatus();
  if (name === 'canva') refreshCanvaStatus();
  if (name === 'files') fmLoad();
  if (name === 'subagents') SubagentsUI.refresh();
  if (name === 'webcam') if (typeof initWebcam === 'function') initWebcam();

  // Pause background streams
  if (name !== 'screen' && screenActive) pauseScreen();
  if (name !== 'webcam' && typeof webcamActive !== 'undefined' && webcamActive) pauseWebcam();
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => { 
  init(); 
  setupViewportFix(); 
  
  // iOS Audio Unlocker
  const unlockAudio = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(' '));
    }
    if (!_keepAliveCtx) startKeepAlive();
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
  };
  document.addEventListener('click', unlockAudio);
  document.addEventListener('touchstart', unlockAudio);
});