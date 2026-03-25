// public/js/modules/subagents_ui.js

const SubagentsUI = {
  init() {
    console.log('👥 Subagents UI Initialized');
    this.refresh();
  },

  async refresh() {
    const listEl = document.getElementById('subagents-list');
    if (!listEl) return;

    listEl.innerHTML = '<div class="subagents-loading"><div class="spinner-small"></div> Cargando agentes...</div>';

    try {
      // Usamos el tool check_subagents via el backend si es posible, 
      // o una ruta directo de API si la creamos. 
      // Por ahora vamos a crear una ruta en el servidor para esto.
      const res = await fetch('/api/subagents/list', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      
      if (!data.tasks || data.tasks.length === 0) {
        listEl.innerHTML = `
          <div class="subagents-empty">
            <i data-lucide="user-plus"></i>
            <p>No hay sub-agentes activos</p>
            <span>Pedile al chat que despliegue uno para tareas largas.</span>
          </div>
        `;
      } else {
        listEl.innerHTML = data.tasks.map(t => this.renderTask(t)).join('');
      }
      
      if (window.lucide) lucide.createIcons();
    } catch (err) {
      listEl.innerHTML = `<div class="subagents-error">Error al cargar: ${err.message}</div>`;
    }
  },

  renderTask(t) {
    const statusClass = t.status.toLowerCase();
    const date = new Date(t.createdAt).toLocaleTimeString();
    
    return `
      <div class="subagent-card ${statusClass}">
        <div class="sa-header">
          <div class="sa-title">
            <span class="sa-dot"></span>
            <b>${t.name}</b>
          </div>
          <span class="sa-time">${date}</span>
        </div>
        <div class="sa-desc">${t.description}</div>
        ${t.result ? `
          <div class="sa-result">
            <div class="sa-result-header">Resultado:</div>
            <pre>${this.escapeHtml(t.result)}</pre>
          </div>
        ` : t.status === 'running' ? `
          <div class="sa-progress">
             <div class="sa-progress-bar"></div>
             <span>Ejecutando tarea autónoma...</span>
          </div>
        ` : ''}
      </div>
    `;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

window.SubagentsUI = SubagentsUI;
