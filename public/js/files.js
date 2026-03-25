// ─── FILES MANAGER ────────────────────────────────────────────────────────────
let fmInitialized = false;

async function fmLoad() {
    const path = qs('#fm-path').value || '/';
    try {
        const res = await fetch(`/api/files/list?path=${encodeURIComponent(path)}`, {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const data = await res.json();
        if (data.success) {
            renderFileList(data.items);
            qs('#fm-path').value = path.endsWith('/') && path.length > 1 ? path.slice(0,-1) : path;
        } else {
            alert('Error cargando directorio: ' + data.error);
        }
    } catch (err) {
        alert('Error conectando con el servidor para archivos.');
    }
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'], i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function renderFileList(items) {
    const list = qs('#fm-list');
    list.innerHTML = '';
    
    if (items.length === 0) {
        list.innerHTML = '<div style="color:var(--text3);text-align:center;padding:20px;">Carpeta vacía</div>';
        return;
    }

    items.forEach(item => {
        const el = document.createElement('div');
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.background = 'var(--surface)';
        el.style.padding = '10px 14px';
        el.style.borderRadius = '8px';
        el.style.border = '1px solid var(--border)';
        el.style.gap = '10px';
        
        const iconName = item.isDirectory ? 'folder' : 'file';
        const color = item.isDirectory ? 'var(--accent)' : 'var(--text2)';
        const ext = item.name.split('.').pop().toLowerCase();
        const isMedia = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'ogg'].includes(ext);
        
        el.innerHTML = `
            <div style="font-size: 20px;"><i data-lucide="${iconName}" style="color:${color}"></i></div>
            <div style="flex:1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; color: ${color}; cursor: pointer;" onclick="fmItemClick('${item.path}', ${item.isDirectory})">${item.name}</div>
            <div style="font-size: 11px; color: var(--text3); width: 60px; text-align: right;">${item.isDirectory ? '' : formatBytes(item.size)}</div>
            <div style="display:flex; gap: 4px;">
                ${isMedia ? `<button class="icon-btn" style="width:30px;height:30px;font-size:12px;color:var(--accent);" onclick="showPreview('${item.path}', '${ext}')" title="Previsualizar"><i data-lucide="eye"></i></button>` : ''}
                ${!item.isDirectory ? `<button class="icon-btn" style="width:30px;height:30px;font-size:12px" onclick="fmDownload('${item.path}')" title="Descargar"><i data-lucide="download"></i></button>` : ''}
                <button class="icon-btn" style="width:30px;height:30px;font-size:12px" onclick="fmRename('${item.path}', '${item.name}')" title="Renombrar"><i data-lucide="edit-3"></i></button>
                <button class="icon-btn" style="width:30px;height:30px;font-size:12px;color:var(--red);" onclick="fmDelete('${item.path}')" title="Borrar"><i data-lucide="trash-2"></i></button>
            </div>
        `;
        list.appendChild(el);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function fmItemClick(path, isDir) {
    if (isDir) {
        qs('#fm-path').value = path;
        fmLoad();
    } else {
        const ext = path.split('.').pop().toLowerCase();
        const media = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'ogg'];
        if (media.includes(ext)) {
            showPreview(path, ext);
        }
    }
}

function showPreview(path, ext) {
    const modal = qs('#preview-modal');
    const body = qs('#preview-body');
    const filename = qs('#preview-filename');
    
    filename.textContent = path.split('/').pop();
    body.innerHTML = '<div style="color:var(--text3)">Cargando vista previa...</div>';
    modal.classList.add('open');
    
    const url = `/api/files/preview?path=${encodeURIComponent(path)}&token=${authToken}`;
    
    if (['mp4', 'webm', 'ogg'].includes(ext)) {
        body.innerHTML = `<video src="${url}" controls autoplay style="max-width:100%; max-height:70vh;"></video>`;
    } else {
        const img = new Image();
        img.onload = () => { body.innerHTML = ''; body.appendChild(img); };
        img.onerror = () => { body.innerHTML = '<div style="color:var(--red)">No se pudo cargar la imagen</div>'; };
        img.src = url;
    }
}

function closePreview() {
    qs('#preview-modal').classList.remove('open');
    qs('#preview-body').innerHTML = '';
}

function fmGoUp() {
    let p = qs('#fm-path').value;
    if (p === '/' || p === '') return;
    let parts = p.split('/').filter(Boolean);
    parts.pop();
    qs('#fm-path').value = '/' + parts.join('/');
    fmLoad();
}

function fmDownload(path) {
    const a = document.createElement('a');
    a.href = `/api/files/download?path=${encodeURIComponent(path)}&token=${authToken}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function fmDelete(path) {
    if (!confirm('¿Seguro que quieres borrar: ' + path + '?')) return;
    try {
        const res = await fetch('/api/files/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
            body: JSON.stringify({ path })
        });
        const data = await res.json();
        if (data.success) fmLoad();
        else alert('Error: ' + data.error);
    } catch(err) { alert('Request error'); }
}

async function fmRename(oldPath, oldName) {
    const newName = prompt('Nuevo nombre:', oldName);
    if (!newName || newName === oldName) return;
    try {
        const res = await fetch('/api/files/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
            body: JSON.stringify({ path: oldPath, newName })
        });
        const data = await res.json();
        if (data.success) fmLoad();
        else alert('Error: ' + data.error);
    } catch(err) { alert('Request error'); }
}

async function fmUpload(e) {
    const files = e.target.files;
    if (!files.length) return;
    const path = qs('#fm-path').value || '/';
    
    const formData = new FormData();
    formData.append('path', path);
    for(let i=0; i<files.length; i++) {
        formData.append('files', files[i]);
    }

    try {
        const res = await fetch('/api/files/upload', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken },
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            fmLoad();
        } else alert('Error: ' + data.error);
    } catch (err) {
        alert('Upload failed');
    }
    e.target.value = ''; // clear
}


let pendingThinkingEl = null;
let pendingToolCards = {};     // confirmId → { el, toolName, args }
let pendingToolData = {};      // confirmId → { toolName, args } para confirmación segura
let sessionAutoExec = false;   // Permiso temporal para esta sesión

function addMessage(content, role) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  if (role === 'assistant') {
    el.innerHTML = renderMarkdown(content);
  } else {
    el.textContent = content;
  }
  qs('#chat-messages').appendChild(el);
  el.scrollIntoView({ behavior: 'smooth' });
  // Persistir mensajes de usuario y asistente (no mensajes de sistema transitorio)
  if (role === 'user' || role === 'assistant') {
    chatHistory.push({ role, content });
    try { localStorage.setItem('oc_chat', JSON.stringify(chatHistory)); } catch {}
  }
  return el;
}

function showThinking() {
  removeThinking();
  const el = document.createElement('div');
  el.className = 'msg thinking';
  el.innerHTML = `moshiClaw está pensando <span class="thinking-dots"><span style="--i:0">.</span><span style="--i:1">.</span><span style="--i:2">.</span></span>`;
  qs('#chat-messages').appendChild(el);
  el.scrollIntoView({ behavior: 'smooth' });
  pendingThinkingEl = el;
  
  // Transform send button to stop button
  const btn = qs('#btn-send-chat');
  btn.style.background = 'var(--red)';
  btn.innerHTML = '<i data-lucide="square" style="width:18px; height:18px;"></i>';
  btn.title = 'Detener respuesta';
  btn.disabled = false;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function removeThinking() {
  if (pendingThinkingEl) { pendingThinkingEl.remove(); pendingThinkingEl = null; }
  
  // Reset send button
  const btn = qs('#btn-send-chat');
  btn.style.background = 'var(--accent)';
  btn.innerHTML = '➤';
  btn.title = 'Enviar mensaje';
}

function toggleThinking(btn) {
  btn.classList.toggle('open');
  btn.nextElementSibling.classList.toggle('open');
}

function showResponse(text, provider, thinking) {
  removeThinking();
  if (thinking) {
    const words = thinking.trim().split(/\s+/).length;
    const thinkEl = document.createElement('div');
    thinkEl.className = 'thinking-block';
    thinkEl.innerHTML = `
      <div class="thinking-toggle" onclick="toggleThinking(this)">
        <span class="t-arrow">▶</span>
        <span>💭 Pensamiento interno</span>
        <span style="margin-left:auto;opacity:0.45;font-size:11px">${words} palabras</span>
      </div>
      <div class="thinking-body">${renderMarkdown(thinking)}</div>`;
    qs('#chat-messages').appendChild(thinkEl);
    thinkEl.scrollIntoView({ behavior: 'smooth' });
  }
  const el = addMessage(text, 'assistant');
  qs('#btn-send-chat').disabled = false;
  if (lastQueryWasVoice || jarvisMode) jarvisNotify(text);
  speakResponse(text);
}

function showChatError(err) {
  removeThinking();
  addMessage(`⚠️ ${err}`, 'system');
  qs('#btn-send-chat').disabled = false;
}

// Mapa para vincular tarjetas de herramientas con sus resultados por toolId único
const _toolCardMap = new Map();

function handleToolEvent(event) {
  // 'toolType' es el tipo real del evento (server.js lo separa para no pisar msg.type='chat_tool')
  const evtType = event.toolType || event.type;

  if (evtType === 'step') {
    // Mensajes de progreso del agente (step_update tool)
    const stepEl = document.createElement('div');
    stepEl.className = 'msg step-update';
    stepEl.textContent = event.message;
    qs('#chat-messages').appendChild(stepEl);
    stepEl.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  if (evtType === 'executing') {
    // step_update se muestra solo como mensaje de progreso (evento 'step'), no como tarjeta
    if (event.name === 'step_update') return;
    const toolId = event.toolId || `tc_${Date.now()}_${Math.random()}`;
    // Formatear args según el tipo de herramienta
    let cmdDisplay = '';
    if (event.name === 'write_file') {
      const lines = (event.args && event.args.content || '').split('\n').length;
      cmdDisplay = `📄 ${escapeHtml(event.args.path || '')} (${lines} líneas)`;
    } else if (event.name === 'step_update') {
      cmdDisplay = escapeHtml(event.args && event.args.message || '');
    } else if (event.args && event.args.command) {
      cmdDisplay = `${escapeHtml(event.args.command)}`;
    } else {
      cmdDisplay = escapeHtml(JSON.stringify(event.args || {}));
    }
    
    let ocVerb = event.name;
    if (ocVerb === 'execute_command') ocVerb = 'exec';
    else if (ocVerb === 'read_file') ocVerb = 'read';
    else if (ocVerb === 'write_file') ocVerb = 'write';
    else if (ocVerb === 'browser_navigate') ocVerb = 'nav';
    else if (ocVerb === 'generate_image') ocVerb = 'image';

    const card = document.createElement('div');
    card.className = 'tool-card-oc closed';
    card.dataset.toolId = toolId;
    card.innerHTML = `
      <div class="oc-header" onclick="this.parentElement.classList.toggle('closed')">
        <span class="oc-arrow">▼</span>
        <span class="oc-icon">⚡</span>
        <span class="oc-title"><b>1 tool</b> ${escapeHtml(ocVerb)}</span>
      </div>
      <div class="oc-body">
        <div class="oc-tool-name" style="margin-bottom: 8px;">
           <i data-lucide="file-code-2" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"></i> 
           <span style="font-weight:bold; color:var(--text1)">${escapeHtml(event.name.replace(/_/g,' ').replace(/\b\w/g, c=>c.toUpperCase()))}</span>
        </div>
        <div class="oc-cmd" style="font-family:monospace; color:var(--text2); margin-bottom: 12px;">with ${cmdDisplay}</div>
        <div class="oc-result running" style="color:var(--text3); font-size:12px;">⏳ Ejecutando...</div>
      </div>
    `;
    qs('#chat-messages').appendChild(card);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    card.scrollIntoView({ behavior: 'smooth' });
    _toolCardMap.set(toolId, card);
  } else if (evtType === 'result') {
    if (event.name === 'step_update') return; // ya manejado por el evento 'step'
    const toolId = event.toolId;
    const card = toolId ? _toolCardMap.get(toolId) : null;
    if (card) {
      const resultEl = card.querySelector('.oc-result');
      if (resultEl) {
        resultEl.classList.remove('running');
        const resultText = String(event.result || '');
        const isError = /\berror\b/i.test(resultText) && !resultText.startsWith('✅');
        
        resultEl.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; color: var(--text3); font-size: 11px;">
             <span>${isError ? 'Failed' : 'Completed'}</span>
             <span>${isError ? '<i data-lucide="x" style="color:var(--red);width:14px;height:14px;"></i>' : '<i data-lucide="check" style="color:var(--green);width:14px;height:14px;"></i>'}</span>
          </div>
          <div class="oc-output-log" style="display:none; margin-top:8px; white-space:pre-wrap; font-family:monospace; font-size:11px; color:var(--text2); background:var(--bg); border: 1px solid var(--border); padding:8px; border-radius:4px;"></div>
        `;
        const logEl = resultEl.querySelector('.oc-output-log');
        logEl.textContent = resultText;
        if(isError || resultText.length < 300) {
            logEl.style.display = 'block';
        } else {
            const btn = document.createElement('button');
            btn.textContent = 'Ver output completo';
            btn.style.cssText = 'background:none; border:none; color:var(--accent); cursor:pointer; font-size:11px; margin-top:4px; padding:0;';
            btn.onclick = () => { logEl.style.display = logEl.style.display==='none' ? 'block' : 'none'; };
            resultEl.appendChild(btn);
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
      _toolCardMap.delete(toolId);
    }
  } else if (evtType === 'needs_confirmation') {
    // Si ya aceptamos todo esta sesión, confirmamos automáticamente
    if (sessionAutoExec) {
        confirmTool(event.confirmId);
        return;
    }

    // Guardar args de forma segura en memoria, no en HTML
    pendingToolData[event.confirmId] = { toolName: event.name, args: event.args };

    const card = document.createElement('div');
    card.className = 'tool-card';
    card.dataset.confirmId = event.confirmId;
    card.innerHTML = `
      <div class="tool-header">🤖 moshiClaw quiere ejecutar:</div>
      <div class="tool-cmd">$ ${escapeHtml(event.args.command || JSON.stringify(event.args))}</div>
      <div class="tool-actions">
        <button class="btn-confirm btn-confirm-action" title="Aceptar esta vez">✓ Aceptar</button>
        <button class="btn-confirm btn-confirm-all" style="background:var(--accent2); color:white" title="Aceptar todos los comandos de esta sesión">✓ Aceptar Todo</button>
        <button class="btn-cancel-tool btn-cancel-action" title="Denegar">✕ Negar</button>
      </div>
      <div class="tool-result" style="display:none"></div>
    `;
    card.querySelector('.btn-confirm-action').addEventListener('click', () => {
      confirmTool(event.confirmId);
    });
    card.querySelector('.btn-confirm-all').addEventListener('click', () => {
      if (confirm('¿Seguro que querés permitir todos los comandos de esta sesión sin preguntar?')) {
          sessionAutoExec = true;
          confirmTool(event.confirmId);
      }
    });
    card.querySelector('.btn-cancel-action').addEventListener('click', () => {
      cancelTool(event.confirmId);
    });
    qs('#chat-messages').appendChild(card);
    card.scrollIntoView({ behavior: 'smooth' });
    pendingToolCards[event.confirmId] = card;
    // Registrar en _toolCardMap para que el resultado actualice la tarjeta
    if (event.toolId) _toolCardMap.set(event.toolId, card);
  }
}

function confirmTool(confirmId) {
  const data = pendingToolData[confirmId];
  if (!data) return;
  if (eventsWS && eventsWS.readyState === WebSocket.OPEN) {
    eventsWS.send(JSON.stringify({ type: 'confirm_tool', confirmId, toolName: data.toolName, args: data.args }));
    if (pendingToolCards[confirmId]) {
      const actionsEl = pendingToolCards[confirmId].querySelector('.tool-actions');
      if (actionsEl) actionsEl.innerHTML = '<span style="color:var(--green);font-size:12px">✓ Aceptado</span>';
      const resultEl = pendingToolCards[confirmId].querySelector('.tool-result');
      if (resultEl) { resultEl.style.display = ''; resultEl.classList.add('running'); resultEl.textContent = '⏳ Ejecutando...'; }
    }
    delete pendingToolData[confirmId];
  }
}

function cancelTool(confirmId) {
  if (eventsWS && eventsWS.readyState === WebSocket.OPEN) {
    eventsWS.send(JSON.stringify({ type: 'cancel_tool', confirmId }));
    if (pendingToolCards[confirmId]) {
      pendingToolCards[confirmId].querySelector('.tool-actions').innerHTML = '<span style="color:var(--red);font-size:12px">✕ Cancelado</span>';
    }
    delete pendingToolData[confirmId];
  }
}

function escapeHtml(text) {
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function sendChatMessage() {
  const input = qs('#chat-input');
  
  // If we are thinking, the button acts as STOP
  if (pendingThinkingEl) {
    stopChatResponse();
    return;
  }

  const msg = input.value.trim();
  if (!msg) return;

  if (!settings.apiKey && settings.provider !== 'ollama') {
    addMessage('Configurá tu API key en ⚙️ primero.', 'system');
    return;
  }

  addMessage(msg, 'user');
  input.value = '';
  input.style.height = 'auto';
  // Note: We don't disable it here because it will be transformed/handled by showThinking

  if (eventsWS && eventsWS.readyState === WebSocket.OPEN) {
    eventsWS.send(JSON.stringify({
      type: 'chat',
      message: msg,
      provider: settings.provider || 'gemini',
      model: settings.model,
      apiKey: settings.apiKey,
      sessionId: chatSessionId,
      autoExecute: autoExec || sessionAutoExec,
      activeSkillId: activeSkillId || null
    }));
  } else {
    addMessage('Sin conexión al servidor.', 'system');
    qs('#btn-send-chat').disabled = false;
  }
}
