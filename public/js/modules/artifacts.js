// public/js/modules/artifacts.js

const Artifacts = {
  activeArtifact: null,
  artifacts: [],

  init() {
    console.log('🚀 Artifacts Module Initialized');
    this.createSidebar();
    this.setupListeners();
  },

  createSidebar() {
    // This will be called if the element doesn't exist yet
    if (document.getElementById('artifacts-sidebar')) return;

    const chatPanel = document.getElementById('panel-chat');
    if (!chatPanel) return;

    // Wrap current chat content to allow sidebar
    const messages = document.getElementById('chat-messages');
    const skillBadge = document.getElementById('active-skill-badge');
    
    // Create layout container
    const layout = document.createElement('div');
    layout.id = 'chat-layout';
    layout.className = 'chat-layout';
    
    const main = document.createElement('div');
    main.id = 'chat-main';
    main.className = 'chat-main';
    
    // Move existing elements to main
    if (messages) main.appendChild(messages);
    if (skillBadge) main.appendChild(skillBadge);
    
    const sidebar = document.createElement('div');
    sidebar.id = 'artifacts-sidebar';
    sidebar.className = 'artifacts-sidebar';
    sidebar.innerHTML = `
      <div class="artifacts-header">
        <div class="artifacts-title">
          <i data-lucide="layout"></i>
          <span id="artifact-label">Artifact</span>
        </div>
        <div class="artifacts-actions">
           <button class="icon-btn sm" onclick="Artifacts.close()"><i data-lucide="x"></i></button>
        </div>
      </div>
      <div id="artifact-content" class="artifact-content">
        <div class="artifact-placeholder">
          <i data-lucide="package"></i>
          <p>No hay contenido para mostrar</p>
        </div>
      </div>
      <div class="artifacts-footer">
        <button id="btn-copy-artifact" class="btn-subtle sm"><i data-lucide="copy"></i> Copiar</button>
        <button id="btn-download-artifact" class="btn-subtle sm"><i data-lucide="download"></i> Descargar</button>
      </div>
    `;
    
    layout.appendChild(main);
    layout.appendChild(sidebar);
    
    // Insert layout before input area
    const inputArea = chatPanel.querySelector('.chat-input-area');
    chatPanel.insertBefore(layout, inputArea);
    
    // Initialize icons
    if (window.lucide) lucide.createIcons();
  },

  setupListeners() {
    // Listen for custom events or message parsing
  },

  show(id, type, title, content) {
    const sidebar = document.getElementById('artifacts-sidebar');
    const container = document.getElementById('panel-chat');
    
    if (!sidebar || !container) return;
    
    // Si el contenido viene encodeado (desde el onclick del HTML)
    let finalContent = content;
    if (content.startsWith('%')) {
       finalContent = decodeURIComponent(content);
    }
    container.classList.add('with-artifacts');
    sidebar.classList.add('open');
    
    const titleEl = document.getElementById('artifact-label');
    const contentEl = document.getElementById('artifact-content');
    
    if (titleEl) titleEl.textContent = title || 'Artifact';
    
    if (contentEl) {
      if (type === 'html' || type === 'svg') {
        contentEl.innerHTML = `<iframe id="artifact-frame" sandbox="allow-scripts" style="width:100%; height:100%; border:none; background:white;"></iframe>`;
        const frame = document.getElementById('artifact-frame');
        const doc = frame.contentWindow.document;
        doc.open();
        doc.write(finalContent);  // usar finalContent (ya decodificado si venía con encodeURIComponent)
        doc.close();
      } else {
        contentEl.innerHTML = `<pre class="artifact-code"><code>${this.escapeHtml(finalContent)}</code></pre>`;
      }
    }
    
    this.activeArtifact = { id, type, title, content };
    
    // Refresh icons in sidebar
    if (window.lucide) lucide.createIcons();
  },

  close() {
    const sidebar = document.getElementById('artifacts-sidebar');
    const container = document.getElementById('panel-chat');
    if (sidebar) sidebar.classList.remove('open');
    if (container) container.classList.remove('with-artifacts');
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

window.Artifacts = Artifacts;
