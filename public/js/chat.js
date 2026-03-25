// ─── CHAT IA ──────────────────────────────────────────────────────────────────
let pendingThinkingEl = null;

function addMessage(text, role, thinkingText = '') {
  const container = qs('#chat-messages');
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  
  if (role === 'assistant') {
    let html = '';
    if (thinkingText) {
      html += `<div class="thinking-block"><div class="thinking-header">Pensamiento</div><div class="thinking-content">${renderMarkdown(thinkingText)}</div></div>`;
    }
    html += renderMarkdown(text);
    el.innerHTML = html;
  } else {
    el.textContent = text;
  }
  
  container.appendChild(el);
  el.scrollIntoView({ behavior: 'smooth' });
  
  // Persistir en local (limitado a 50 msgs)
  chatHistory.push({ role, content: text, thinking: thinkingText });
  if (chatHistory.length > 50) chatHistory.shift();
  localStorage.setItem('oc_chat', JSON.stringify(chatHistory));
}

function showThinking(sId) {
  if (sId !== chatSessionId) return;
  if (pendingThinkingEl) return;
  const container = qs('#chat-messages');
  pendingThinkingEl = document.createElement('div');
  pendingThinkingEl.className = 'msg assistant thinking';
  pendingThinkingEl.innerHTML = '<div class="spinner-small"></div> <span>Analizando...</span>';
  container.appendChild(pendingThinkingEl);
  pendingThinkingEl.scrollIntoView({ behavior: 'smooth' });
}

function removeThinking() {
  if (pendingThinkingEl) {
    pendingThinkingEl.remove();
    pendingThinkingEl = null;
  }
}

function showResponse(content, provider, thinking = '') {
  removeThinking();
  addMessage(content, 'assistant', thinking);
  qs('#btn-send-chat').disabled = false;
  if ('Notification' in window && document.hidden) {
      new Notification('🤖 moshiClaw', { body: content.substring(0, 100) + '...' });
  }
}

function showChatError(err) {
  removeThinking();
  addMessage('❌ Error: ' + err, 'system');
  qs('#btn-send-chat').disabled = false;
}

function clearChatHistory() {
  if (!confirm('¿Seguro que querés limpiar el historial de este chat?')) return;
  if (eventsWS && eventsWS.readyState === WebSocket.OPEN) {
    eventsWS.send(JSON.stringify({ type: 'clear_chat', sessionId: chatSessionId }));
  }
  // Limpiar estado persistente
  chatHistory = [];
  localStorage.removeItem('oc_chat');
  chatSessionId = 'session_' + Date.now();
  localStorage.setItem('oc_session_id', chatSessionId);
  qs('#chat-messages').innerHTML = '<div class="msg system">Historial limpiado.</div>';
  if (typeof sessionAutoExec !== 'undefined') sessionAutoExec = false;
}

function stopChatResponse() {
  if (eventsWS && eventsWS.readyState === WebSocket.OPEN) {
    eventsWS.send(JSON.stringify({ type: 'stop_chat', sessionId: chatSessionId }));
  }
  removeThinking();
  addMessage('Respuesta detenida por el usuario.', 'system');
  qs('#btn-send-chat').disabled = false;
}

async function sendChatMessage() {
  const input = qs('#chat-input');
  const btn = qs('#btn-send-chat');
  const text = input.value.trim();
  if (!text || btn.disabled) return;

  const prov = settings.provider || 'gemini';
  const apikey = settings.apiKey || '';
  const model = settings.model || (prov === 'gemini' ? 'gemini-2.0-flash' : '');
  const isExpert = !!settings.expertMode;

  addMessage(text, 'user');
  input.value = '';
  input.style.height = 'auto';
  btn.disabled = true;

  if (eventsWS && eventsWS.readyState === WebSocket.OPEN) {
    eventsWS.send(JSON.stringify({
      type: 'chat',
      message: text,
      provider: prov,
      model: model,
      apiKey: apikey,
      sessionId: chatSessionId,
      autoExecute: autoExec,
      isExpert: isExpert,
      activeSkillId: activeSkillId
    }));
  } else {
    showChatError('No hay conexión con el servidor (WebSocket)');
  }
}

function handleToolEvent(msg) {
  const container = qs('#chat-messages');
  const toolId = msg.toolId || msg.confirmId;
  const { toolName, args, result, needsConfirmation, isAuto, status, stepMsg } = msg;

  // Si es un update de paso (step_update), mostramos un mensaje sutil
  if (toolName === 'step_update' || stepMsg) {
      const stepEl = document.createElement('div');
      stepEl.className = 'msg system tool-step';
      stepEl.innerHTML = `<i data-lucide="info" style="width:12px;height:12px;margin-right:6px"></i> ${stepMsg || args.message}`;
      container.appendChild(stepEl);
      stepEl.scrollIntoView({ behavior: 'smooth' });
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
  }

  // Buscar tarjeta existente para actualización de estado
  let card = document.getElementById(`tool-${toolId}`);
  if (!card) {
    card = document.createElement('div');
    card.id = `tool-${toolId}`;
    card.className = 'tool-card';
    container.appendChild(card);
  }

  let html = `
    <div class="tool-header">
      <span class="tool-name"><i data-lucide="wrench"></i> ${toolName}</span>
      <span class="tool-status ${status}">${status==='pending'?'Ejecutando...':status==='error'?'Error':'Ok'}</span>
    </div>
    <div class="tool-args"><code>${JSON.stringify(args, null, 1)}</code></div>
  `;

  if (needsConfirmation) {
    html += `
      <div class="tool-confirm" id="confirm-${toolId}">
        <p>¿Autorizar ejecución de esta herramienta?</p>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="btn-tool ok" onclick="executeConfirmedTool('${toolId}')">SÍ, EJECUTAR</button>
          <button class="btn-tool no" onclick="cancelToolExecution('${toolId}')">NO</button>
        </div>
      </div>
    `;
  }

  if (result) {
    const resString = typeof result === 'string' ? result : JSON.stringify(result, null, 1);
    html += `<div class="tool-res"><b>Resultado:</b><pre>${resString}</pre></div>`;
  }

  card.innerHTML = html;
  card.scrollIntoView({ behavior: 'smooth' });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function executeConfirmedTool(id) {
  const confirmBox = document.getElementById(`confirm-${id}`);
  if (confirmBox) confirmBox.remove();
  if (eventsWS) eventsWS.send(JSON.stringify({ type: 'confirm_tool', confirmId: id }));
}

function cancelToolExecution(id) {
  const confirmBox = document.getElementById(`confirm-${id}`);
  if (confirmBox) confirmBox.remove();
  if (eventsWS) eventsWS.send(JSON.stringify({ type: 'cancel_tool', confirmId: id }));
}
