// ─── SKILLS ───────────────────────────────────────────────────────────────────

async function loadSkills() {
  try {
    const r = await fetch('/api/skills', { headers: { Authorization: 'Bearer ' + authToken } });
    const data = await r.json();
    _cachedSkills = data.skills || [];
    renderSkillsList();
  } catch (e) { console.error('Error cargando skills:', e); }
}

function renderSkillsList() {
  const list = qs('#skills-list');
  if (!list) return;
  if (_cachedSkills.length === 0) {
    list.innerHTML = '<div class="skills-empty">✨ No hay skills todavía.<br>Creá el primero con el botón de abajo.</div>';
    return;
  }
  list.innerHTML = _cachedSkills.map(sk => {
    const isActive = sk.id === activeSkillId;
    const tags = (sk.tags||[]).map(t => `<span class="skill-tag">${t}</span>`).join('');
    const tagsHtml = tags ? `<div class="skill-tags">${tags}</div>` : '';
    const esc = s => (s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return `<div class="skill-card ${isActive?'active':''}">
      <div class="skill-icon">${sk.icon||'🧠'}</div>
      <div class="skill-info">
        <div class="skill-name">${sk.name}</div>
        ${sk.description?`<div class="skill-desc">${sk.description}</div>`:''}
        ${tagsHtml}
      </div>
      <div class="skill-actions">
        <button class="skill-activate-btn" onclick="toggleSkill('${esc(sk.id)}','${esc(sk.name)}','${esc(sk.icon||'🧠')}')">
          ${isActive ? '✓ Activo' : 'Activar'}
        </button>
        <button class="skill-del-btn" onclick="confirmDeleteSkill('${esc(sk.id)}','${esc(sk.name)}',event)" title="Eliminar">✕</button>
      </div>
    </div>`;
  }).join('');
}

function openSkillsPanel() {
  qs('#skills-modal').classList.add('open');
  loadSkills();
}
function closeSkillsPanel() { qs('#skills-modal').classList.remove('open'); }

function toggleSkill(id, name, icon) {
  if (activeSkillId === id) deactivateSkill(); else activateSkill(id, name, icon);
}

function activateSkill(id, name, icon) {
  activeSkillId   = id;
  activeSkillMeta = { id, name, icon };
  localStorage.setItem('oc_active_skill', id);
  localStorage.setItem('oc_active_skill_meta', JSON.stringify(activeSkillMeta));
  updateSkillBadge();
  renderSkillsList();
  closeSkillsPanel();
}

function deactivateSkill() {
  activeSkillId = null; activeSkillMeta = null;
  localStorage.removeItem('oc_active_skill');
  localStorage.removeItem('oc_active_skill_meta');
  updateSkillBadge();
  renderSkillsList();
}

function updateSkillBadge() {
  const badge = qs('#active-skill-badge');
  if (!badge) return;
  if (activeSkillMeta) {
    qs('#active-skill-badge-icon').textContent = activeSkillMeta.icon || '🧠';
    qs('#active-skill-badge-name').textContent = 'Skill: ' + activeSkillMeta.name;
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
}

function openCreateSkillModal() {
  qs('#create-skill-modal').classList.add('open');
  setTimeout(() => qs('#new-skill-name') && qs('#new-skill-name').focus(), 120);
}
function closeCreateSkillModal() { qs('#create-skill-modal').classList.remove('open'); }

async function saveNewSkill() {
  const name    = qs('#new-skill-name').value.trim();
  const icon    = qs('#new-skill-icon').value.trim() || '🧠';
  const desc    = qs('#new-skill-desc').value.trim();
  const tags    = qs('#new-skill-tags').value.trim();
  const content = qs('#new-skill-content').value.trim();
  if (!name) { qs('#new-skill-name').focus(); return; }
  if (!content) { qs('#new-skill-content').focus(); return; }
  try {
    const r = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
      body: JSON.stringify({ name, icon, description: desc, tags, content })
    });
    const data = await r.json();
    if (data.success) {
      ['#new-skill-name','#new-skill-desc','#new-skill-tags','#new-skill-content'].forEach(s => { if(qs(s)) qs(s).value=''; });
      if (qs('#new-skill-icon')) qs('#new-skill-icon').value = '🧠';
      closeCreateSkillModal();
      loadSkills();
    } else { alert('Error al guardar: ' + (data.error||'desconocido')); }
  } catch(e) { alert('Error de red: ' + e.message); }
}

async function confirmDeleteSkill(id, name, event) {
  event.stopPropagation();
  if (!confirm('¿Eliminar el skill "' + name + '"?')) return;
  try {
    await fetch('/api/skills/' + encodeURIComponent(id), {
      method: 'DELETE', headers: { Authorization: 'Bearer ' + authToken }
    });
    if (activeSkillId === id) deactivateSkill();
    loadSkills();
  } catch(e) { alert('Error: ' + e.message); }
}

async function installSkillFromGitHub() {
  const input = qs('#github-skill-url');
  const url = (input ? input.value : '').trim();
  if (!url) {
    alert('Ingresá la URL del repositorio de GitHub');
    return;
  }
  const btn = qs('#btn-install-github');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Instalando...'; }
  try {
    const res = await fetch('/api/skills/install-github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
      body: JSON.stringify({ repoUrl: url }),
    });
    // Verificar que la respuesta sea JSON antes de parsear
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (res.status === 404) {
        alert('❌ Ruta no encontrada (404).\n\nReiniciá el servidor de MoshiClaw para cargar la nueva ruta.');
      } else if (res.status === 401 || res.status === 403) {
        alert('❌ Sin autorización. Recargá la página y volvé a iniciar sesión.');
      } else {
        alert(`❌ Respuesta inesperada del servidor (HTTP ${res.status}).\n\nReiniciá el servidor.`);
      }
      return;
    }
    const data = await res.json();
    if (data.success) {
      const names = (data.installed || []).map(s => `${s.icon} ${s.name}`).join(', ');
      const skippedMsg = data.skipped && data.skipped.length ? `\n⚠️ Omitidos: ${data.skipped.length}` : '';
      alert(`✅ ${data.installed.length} skill(s) instalado(s):\n${names}${skippedMsg}`);
      if (input) input.value = '';
      loadSkills();
    } else {
      alert('Error: ' + (data.error || 'No se pudo instalar'));
    }
  } catch (e) {
    alert('Error: ' + e.message + '\n\nSi el servidor no fue reiniciado aún, hacelo ahora para cargar la nueva ruta /api/skills/install-github.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📦 Instalar'; }
  }
}

// ─── FIN SKILLS ───────────────────────────────────────────────────────────────


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
  sessionAutoExec = false; // Reset session permissions too
}

function stopChatResponse() {
  if (eventsWS && eventsWS.readyState === WebSocket.OPEN) {
    eventsWS.send(JSON.stringify({ type: 'stop_chat', sessionId: chatSessionId }));
  }
  removeThinking();
  addMessage('Respuesta detenida por el usuario.', 'system');
  qs('#btn-send-chat').disabled = false;
}
