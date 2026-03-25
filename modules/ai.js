// modules/ai.js — Adaptador multi-proveedor: Gemini + DeepSeek
const { executeCommand } = require('./terminal');
const browser = require('./browser');
const whatsapp = require('./whatsapp');
const messenger = require('./messenger');
const canva    = require('./canva');
const fs = require('fs');
const path = require('path');

// Proveedores disponibles
const PROVIDERS = {
  gemini: 'gemini',
  deepseek: 'deepseek',
  ollama: 'ollama'
};

// ─── PERSISTENCIA DE HISTORIAL EN DISCO ───────────────────────────────────────
const SESSIONS_FILE = path.join(__dirname, '../data/chat_sessions.json');
let _saveTimer = null;

// Historial de conversación por sesión
const chatHistories = new Map();
const sessionApiKeys = new Map(); // Store API key per session for tool execution

function loadPersistedHistories() {
  try {
    if (!fs.existsSync(path.join(__dirname, '../data'))) {
      fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
    }
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      let count = 0;
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value) && value.length > 0) {
          chatHistories.set(key, value);
          count++;
        }
      }
      console.log(`📚 Historial IA cargado: ${count} sesión(es) restaurada(s)`);
    }
  } catch (e) {
    console.error('⚠️  Error cargando historial IA:', e.message);
  }
}

function saveHistories() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      const obj = {};
      for (const [key, value] of chatHistories.entries()) {
        // Serializar de forma segura: limpiar partes con datos binarios grandes (imágenes base64)
        obj[key] = JSON.parse(JSON.stringify(value, (k, v) => {
          // Reemplazar datos base64 largos con placeholder para no inflar el archivo
          if (typeof v === 'string' && v.length > 8000 && /^[A-Za-z0-9+/]+=*$/.test(v.slice(0, 100))) {
            return '[datos_binarios_omitidos]';
          }
          return v;
        }));
      }
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));
    } catch (e) {
      console.error('⚠️  Error guardando historial IA:', e.message);
    }
  }, 1500);
}

// Cargar historial al iniciar
loadPersistedHistories();

// Herramientas que la IA puede usar
const AI_TOOLS = {
  execute_command: {
    description: 'Ejecuta CUALQUIER comando bash en la PC Ubuntu. Tenés permisos de SUDO para tareas administrativas, instalaciones y control total del sistema.',
    parameters: {
      command: { type: 'string', description: 'El comando bash completo a ejecutar (usá sudo si es necesario)' }
    }
  },
  read_file: {
    description: 'Lee el contenido de cualquier archivo del sistema, incluyendo archivos protegidos si usás sudo en conjunto con herramientas de lectura.',
    parameters: {
      path: { type: 'string', description: 'Ruta absoluta del archivo' }
    }
  },
  browser_navigate: {
    description: 'Abre una URL en el navegador controlado. Usá esto para buscar en Google, abrir páginas web, etc.',
    parameters: {
      url: { type: 'string', description: 'URL completa a navegar (debe incluir https://)' }
    }
  },
  browser_get_content: {
    description: 'Obtiene el texto visible de la página actual del navegador. Usá esto para leer resultados de búsqueda, artículos, etc.',
    parameters: {}
  },
  browser_screenshot: {
    description: 'Toma una captura de pantalla del navegador y la envía al panel del usuario.',
    parameters: {}
  },
  browser_click: {
    description: 'Hace clic en un elemento de la página usando un selector CSS.',
    parameters: {
      selector: { type: 'string', description: 'Selector CSS del elemento a clickear (ej: "a.result", "#submit-btn")' }
    }
  },
  generate_image: {
    description: 'Genera una imagen a partir de una descripción de texto usando Google Imagen.',
    parameters: {
      prompt: { type: 'string', description: 'Descripción detallada de la imagen que quieres generar' }
    }
  },
  messaging_send: {
    description: 'Envía un mensaje por WhatsApp o Messenger. Para WhatsApp el destinatario es el número en formato internacional (ej: 5491112345678). Para Messenger usá la URL de conversación obtenida con messaging_get_chats.',
    parameters: {
      platform: { type: 'string', description: 'Plataforma: "whatsapp" o "messenger"' },
      to: { type: 'string', description: 'Número de WhatsApp (ej: 5491112345678) o URL de conversación de Messenger (ej: https://www.messenger.com/t/12345)' },
      message: { type: 'string', description: 'Texto del mensaje a enviar' }
    }
  },
  messaging_status: {
    description: 'Consulta el estado de conexión de WhatsApp y Messenger (conectado, desconectado, esperando QR, etc.).',
    parameters: {}
  },
  messaging_get_chats: {
    description: 'Lista las conversaciones abiertas de WhatsApp y/o Messenger con su nombre e identificador/URL. Usá esto SIEMPRE antes de messaging_send para Messenger, para obtener la URL exacta de la conversación.',
    parameters: {
      platform: { type: 'string', description: 'Plataforma a listar: "whatsapp", "messenger" o "all"' }
    }
  },
  open_in_brave: {
    description: 'Abre una URL en el navegador Brave REAL del escritorio del usuario (no en el browser headless de la IA). Usá esto cuando el usuario pida "abrí Brave", "buscá en Brave", o quiera ver algo en su navegador real.',
    parameters: {
      url: { type: 'string', description: 'URL completa a abrir en Brave (debe incluir https://)' }
    }
  },
  play_media: {
    description: 'Reproduce un archivo de audio o video, o una URL de YouTube/Spotify, usando mpv o vlc. Usá esto cuando el usuario pida poner música, reproducir una canción o un video.',
    parameters: {
      source: { type: 'string', description: 'Ruta local del archivo o URL (YouTube, Spotify, directo) a reproducir' },
      type: { type: 'string', description: 'Tipo de media: "audio" (solo audio, sin video) o "video" (con video)' }
    }
  },
  stop_media: {
    description: 'Detiene cualquier reproducción de audio o video que esté activa (mpv/vlc).',
    parameters: {}
  },
  browser_scroll: {
    description: 'Desplaza la página del navegador headless hacia arriba o abajo. Usá esto para ver más contenido de una página larga.',
    parameters: {
      direction: { type: 'string', description: '"up" para arriba o "down" para abajo' },
      amount: { type: 'string', description: 'Cantidad: "small" (300px), "medium" (600px, por defecto) o "large" (1200px)' }
    }
  },
  write_file: {
    description: 'Escribe contenido de texto directamente a un archivo del sistema. Úsalo SIEMPRE para crear o sobreescribir archivos (código, HTML, JS, CSS, JSON, configuración, etc.). Es mucho más confiable que usar heredocs en execute_command. Crea los directorios padres automáticamente.',
    parameters: {
      path: { type: 'string', description: 'Ruta absoluta del archivo a escribir (ej: /home/moshi/mi-proyecto/index.html)' },
      content: { type: 'string', description: 'Contenido completo del archivo' }
    }
  },
  step_update: {
    description: 'Envía un mensaje de progreso visible al usuario durante una tarea larga. Usá esto SIEMPRE antes de cada paso importante para que el usuario vea qué estás haciendo. Ideal para anunciar el plan inicial, cada etapa completada, y el resumen final.',
    parameters: {
      message: { type: 'string', description: 'Mensaje descriptivo del paso actual o progreso (ej: "📁 Paso 1/4: Creando estructura de carpetas del proyecto...")' }
    }
  },
  read_skill: {
    description: 'Lee el contenido completo de un skill especializado. SIEMPRE llamá este tool ANTES de responder cuando el tema del usuario coincida con un skill disponible. El skill contiene conocimiento experto que mejorará significativamente tu respuesta y que no tenés por defecto.',
    parameters: {
      id: { type: 'string', description: 'ID del skill a leer, exactamente como aparece en la lista de skills disponibles (ej: modo-conciso, experto-en-codigo)' }
    }
  },
  canva_status: {
    description: 'Verifica si Canva está conectado y muestra el perfil del usuario. Usá esto antes de cualquier operación con Canva para confirmar que la cuenta está vinculada.',
    parameters: {}
  },
  canva_list_designs: {
    description: 'Lista los diseños de Canva del usuario, opcionalmente filtrando por texto. Devuelve IDs, títulos y URLs de edición.',
    parameters: {
      query: { type: 'string', description: 'Texto opcional para filtrar diseños por nombre' },
      limit: { type: 'string', description: 'Cantidad máxima de diseños a devolver (por defecto 20)' }
    }
  },
  canva_create_design: {
    description: 'Crea un nuevo diseño en blanco en Canva. Devuelve el ID y la URL para editarlo. Tipos válidos: presentation, poster, instagram_post, flyer, youtube_thumbnail, facebook_post, resume, infographic, logo, card, etc.',
    parameters: {
      design_type: { type: 'string', description: 'Tipo de diseño (ej: "presentation", "poster", "instagram_post", "flyer", "youtube_thumbnail", "resume", "logo")' },
      title: { type: 'string', description: 'Título del nuevo diseño' }
    }
  },
  canva_export_design: {
    description: 'Exporta un diseño de Canva a PDF, PNG, JPG, PPTX, GIF o MP4. Devuelve la URL de descarga del archivo exportado.',
    parameters: {
      design_id: { type: 'string', description: 'ID del diseño a exportar (obtenido de canva_list_designs o canva_create_design)' },
      format: { type: 'string', description: 'Formato de exportación: "pdf", "png", "jpg", "pptx", "gif" o "mp4" (por defecto "pdf")' }
    }
  },
  deploy_subagent: {
    description: 'Despliega un sub-agente de IA en segundo plano para realizar una tarea compleja de forma autónoma. El sub-agente tiene acceso a todas tus herramientas. Usalo para delegar investigaciones largas o tareas repetitivas.',
    parameters: {
      task: { type: 'string', description: 'La descripción detallada de la tarea que el sub-agente debe cumplir.' },
      name: { type: 'string', description: 'Nombre corto identificativo para el sub-agente.' }
    }
  }
};

// Ejecutar herramienta real
async function runTool(toolName, args, onToolCall, apiKey) {
  if (toolName === 'execute_command') {
    const result = await executeCommand(args.command, 120000); // 2min timeout
    return `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}\nCódigo de salida: ${result.exitCode}`;
  }
  if (toolName === 'read_file') {
    const fs = require('fs');
    try {
      const content = fs.readFileSync(args.path, 'utf8');
      return content.slice(0, 4000);
    } catch (e) {
      return `Error leyendo archivo: ${e.message}`;
    }
  }
  if (toolName === 'read_skill') {
    const skillsModule = require('./skills');
    const sid = args.id || args.skill_id;
    const content = skillsModule.getSkillContent(sid);
    if (!content) {
      const available = skillsModule.listSkills().map(s => s.id).join(', ');
      return `Skill "${sid}" no encontrado. IDs disponibles: ${available}`;
    }
    return `SKILL CARGADO: ${sid}\n\n${content}\n\n---\nSeguí las instrucciones de este skill durante el resto de la conversación.`;
  }
  if (toolName === 'browser_navigate') {
    const res = await browser.navigate(args.url);
    // Tomar screenshot automáticamente y notificar al panel
    const img = await browser.screenshot();
    if (img && onToolCall) {
      onToolCall({ type: 'browser_screenshot', image: img });
    }
    if (res.error) return `Error navegando a ${args.url}: ${res.error}`;
    return `Navegando a: ${res.url}\nTítulo de la página: ${res.title}`;
  }
  if (toolName === 'browser_get_content') {
    return await browser.getContent();
  }
  if (toolName === 'browser_screenshot') {
    const img = await browser.screenshot();
    if (!img) return 'No se pudo tomar screenshot (navegador no iniciado).';
    if (onToolCall) onToolCall({ type: 'browser_screenshot', image: img });
    return 'Screenshot tomado y enviado al panel.';
  }
  if (toolName === 'browser_click') {
    const result = await browser.click(args.selector);
    // Screenshot post-clic
    const img = await browser.screenshot();
    if (img && onToolCall) onToolCall({ type: 'browser_screenshot', image: img });
    return result;
  }
  if (toolName === 'generate_image') {
    const fetch = require('node-fetch');
    const effectiveKey = apiKey || process.env.GEMINI_API_KEY || 'TU_API_KEY_AQUI';
    
    // IMPORTANTE: El SDK @google/genai usa el endpoint :predict para generateImages.
    // Sin embargo, gemini-2.5-flash-image en AI Studio (claves gratuitas/estándar) 
    // requiere el endpoint :generateContent. Por eso el SDK falla con 404.
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${effectiveKey}`;

    try {
      console.log("DEBUG: Usando fetch con :generateContent para gemini-2.5-flash-image...");
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: args.prompt }]
          }]
        })
      });

      const data = await response.json();
      
      if (data.error) {
          console.error("DEBUG: Error de API:", data.error);
          return `Error de la API de Google: ${data.error.message}`;
      }

      // El resultado de imagen en generateContent viene en inlineData
      if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts) {
          const partVisible = data.candidates[0].content.parts.find(p => p.inlineData);
          if (partVisible && partVisible.inlineData) {
              const b64 = partVisible.inlineData.data;
              console.log(`DEBUG: Imagen generada con éxito (longitud b64: ${b64.length})`);
              return `![Imagen generada](data:image/jpeg;base64,${b64})`;
          }
      }

      console.error("DEBUG: Estructura no reconocida:", JSON.stringify(data).slice(0, 500));
      return `El modelo no devolvió una imagen válida. Intente con otro prompt.`;
    } catch (err) {
      console.error("DEBUG: fallo en fetch:", err.message);
      return `Error técnico al conectar con Google: ${err.message}`;
    }
  }
  if (toolName === 'messaging_send') {
    const { platform, to, message } = args;
    try {
      if (platform === 'whatsapp') {
        const waStatus = whatsapp.getStatus();
        if (waStatus.status !== 'ready') return `WhatsApp no está conectado (estado: ${waStatus.status}). El usuario debe conectarlo primero desde el panel de Mensajería.`;
        await whatsapp.sendMessage(to, message);
        return `Mensaje enviado por WhatsApp a ${to}: "${message}"`;
      } else if (platform === 'messenger') {
        const fbStatus = messenger.getStatus();
        if (fbStatus.status !== 'ready') return `Messenger no está conectado (estado: ${fbStatus.status}). El usuario debe conectarlo primero desde el panel de Mensajería.`;
        await messenger.sendMessage(to, message);
        return `Mensaje enviado por Messenger a ${to}: "${message}"`;
      }
      return `Plataforma desconocida: ${platform}. Usá "whatsapp" o "messenger".`;
    } catch (e) {
      return `Error enviando mensaje: ${e.message}`;
    }
  }
  if (toolName === 'messaging_status') {
    const wa = whatsapp.getStatus();
    const fb = messenger.getStatus();
    return `WhatsApp: ${wa.status}${wa.error ? ' — ' + wa.error : ''}\nMessenger: ${fb.status}${fb.error ? ' — ' + fb.error : ''}`;
  }
  if (toolName === 'messaging_get_chats') {
    const { platform } = args;
    let result = '';
    if (platform === 'whatsapp' || platform === 'all') {
      const waChats = await whatsapp.getChats();
      if (waChats.length === 0) {
        result += 'WhatsApp: no hay chats disponibles o no está conectado.\n';
      } else {
        result += 'WhatsApp chats (usá el campo "id" como "to" en messaging_send):\n';
        waChats.forEach(c => { result += `  - ${c.name || c.id}: ${c.id}${c.lastMessage ? ' | Último: ' + c.lastMessage : ''}\n`; });
      }
    }
    if (platform === 'messenger' || platform === 'all') {
      const fbChats = await messenger.getChats();
      if (fbChats.length === 0) {
        result += 'Messenger: no hay chats disponibles o no está conectado.\n';
      } else {
        result += 'Messenger chats (usá la "url" como "to" en messaging_send):\n';
        fbChats.forEach(c => { result += `  - ${c.name}: ${c.url}\n`; });
      }
    }
    return result.trim() || 'No se encontraron chats.';
  }
  if (toolName === 'open_in_brave') {
    const { exec } = require('child_process');
    const url = args.url || 'https://google.com';
    const validUrl = url.startsWith('http') ? url : `https://${url}`;
    return new Promise((resolve) => {
      // Necesitamos exportar DISPLAY para que abra la GUI desde el proceso background de Node
      // FIX: usar bash -c con if/elif/else para evitar "||" inválido después de "&" en /bin/sh
      const cmd = `bash -c 'export DISPLAY=:0; if command -v brave-browser >/dev/null 2>&1; then nohup brave-browser "${validUrl}" >/dev/null 2>&1 & elif command -v brave >/dev/null 2>&1; then nohup brave "${validUrl}" >/dev/null 2>&1 & else nohup xdg-open "${validUrl}" >/dev/null 2>&1 & fi'`;
      exec(cmd, (err) => {
        if (err) resolve(`No se pudo abrir Brave: ${err.message}. URL: ${validUrl}`);
        else resolve(`✅ Brave abierto buscando: ${validUrl}`);
      });
    });
  }
  if (toolName === 'play_media') {
    const { exec } = require('child_process');
    const source = args.source || '';
    const type = args.type || 'audio';
    if (!source) return 'Falta la fuente de media (ruta o URL)';

    // Detectar si es una URL de streaming (YouTube, Spotify, SoundCloud, etc.)
    const isStreamUrl = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|spotify\.com|soundcloud\.com|music\.youtube\.com|twitch\.tv)/i.test(source);
    const isUrl = source.startsWith('http://') || source.startsWith('https://');

    // Detener cualquier reproducción previa
    exec('pkill mpv 2>/dev/null; pkill vlc 2>/dev/null', () => {});

    let mpvCmd;
    if (isStreamUrl || isUrl) {
      // Para URLs: mpv usa yt-dlp internamente (--ytdl está activo por defecto en mpv)
      if (type === 'audio') {
        // Solo audio: menor uso de ancho de banda
        mpvCmd = `nohup mpv --no-video --ytdl-format="bestaudio[ext=m4a]/bestaudio/best" "${source}" > /tmp/mpv.log 2>&1 &`;
      } else {
        // Video completo
        mpvCmd = `nohup mpv "${source}" > /tmp/mpv.log 2>&1 &`;
      }
    } else {
      // Archivo local
      const noVideoFlag = type === 'audio' ? '--no-video' : '';
      mpvCmd = `nohup mpv ${noVideoFlag} "${source}" > /tmp/mpv.log 2>&1 &`;
    }

    return new Promise((resolve) => {
      exec(mpvCmd, (err) => {
        if (err) {
          resolve(`Error iniciando mpv: ${err.message}. Verificá que mpv y yt-dlp estén instalados.`);
        } else {
          const mediaType = isStreamUrl ? 'streaming de URL' : (type === 'audio' ? 'audio' : 'video');
          resolve(`▶ Reproduciendo ${mediaType}: ${source.length > 60 ? source.substring(0, 60) + '...' : source}`);
        }
      });
    });
  }
  if (toolName === 'stop_media') {
    const { exec } = require('child_process');
    return new Promise((resolve) => {
      exec('pkill mpv; pkill vlc; pkill mplayer', () => {
        resolve('⏹ Reproducción detenida.');
      });
    });
  }
  if (toolName === 'write_file') {
    const fs = require('fs');
    const path = require('path');
    try {
      const dir = path.dirname(args.path);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(args.path, args.content, 'utf8');
      const lines = (args.content.match(/\n/g) || []).length + 1;
      return `✅ Archivo creado: ${args.path} (${lines} líneas, ${args.content.length} chars)`;
    } catch (e) {
      return `Error escribiendo archivo: ${e.message}`;
    }
  }
  if (toolName === 'step_update') {
    if (onToolCall) onToolCall({ type: 'step_update', message: args.message });
    return 'Mensaje de actualización enviado al usuario exitosamente.';
  }

  // ─── CANVA ────────────────────────────────────────────────────────────────
  if (toolName === 'canva_status') {
    if (!canva.isConnected()) return '❌ Canva no está conectado. El usuario debe ir al panel de Canva y hacer clic en "Conectar cuenta".';
    try {
      const profile = await canva.getProfile();
      const user = profile.user || profile;
      return `✅ Canva conectado. Usuario: ${user.display_name || user.email || JSON.stringify(user)}`;
    } catch (e) {
      return `Canva conectado pero error obteniendo perfil: ${e.message}`;
    }
  }

  if (toolName === 'canva_list_designs') {
    if (!canva.isConnected()) return '❌ Canva no conectado. Solicite al usuario que inicie sesión en el panel.';
    try {
      const resp = await canva.getFolders(); // canva.js usa getFolders para listar diseños en root
      let items = resp.items || [];
      if (args.query) items = items.filter(i => (i.title || i.name).toLowerCase().includes(args.query.toLowerCase()));
      const limit = parseInt(args.limit) || 20;
      items = items.slice(0, limit);
      if (items.length === 0) return 'No se encontraron diseños.';
      return items.map(i => `- [${i.id}] ${i.title || i.name} (Edit: ${i.urls?.edit_url || 'N/A'})`).join('\n');
    } catch (e) {
      return `Error listando diseños: ${e.message}`;
    }
  }

  if (toolName === 'canva_create_design') {
    if (!canva.isConnected()) return '❌ Canva no conectado.';
    try {
      // Usamos el endpoint de designs para crear. canva.js tiene createDesign
      const result = await canva.createDesign(args.design_type, args.title);
      return `✅ Diseño creado exitosamente.\nID: ${result.design.id}\nURL para editar: ${result.design.urls?.edit_url}`;
    } catch (e) {
      return `Error creando diseño: ${e.message}`;
    }
  }

  if (toolName === 'canva_export_design') {
    if (!canva.isConnected()) return '❌ Canva no conectado.';
    try {
      const format = (args.format || 'pdf').toLowerCase();
      const result = await canva.exportDesign(args.design_id, format);
      return `✅ Exportación iniciada. En unos momentos estará lista en los trabajos de exportación (Job ID: ${result.job.id}).`;
    } catch (e) {
      return `Error exportando diseño: ${e.message}`;
    }
  }

  // ─── SUB-AGENTES ─────────────────────────────────────────────────────────
  if (toolName === 'deploy_subagent') {
    const subAgentName = args.name || `Sub-Agent-${Math.floor(Math.random()*1000)}`;
    if (onToolCall) onToolCall({ type: 'step_update', message: `🚀 Desplegando sub-agente: ${subAgentName} para tarea compleja...` });
    
    // Spawn a background process or promise
    // To avoid blocking, we will just call processChat asynchronously and return immediately.
    setTimeout(async () => {
      try {
        const result = await processChat("SYSTEM-SUBAGENT", args.task, "sub-agente");
        // Enviar el resultado de vuelta al root session (hacky pero efectivo para demostración)
        const history = chatHistories.get(apiKey) || []; // apiKey holds session id in this context
        history.push({ role: 'user', content: `[RESULTADO DEL SUB-AGENTE '${subAgentName}']: ${result}` });
      } catch (err) {
        console.error(`Error en sub-agente ${subAgentName}:`, err);
      }
    }, 100);

    return `✅ Sub-agente '${subAgentName}' desplegado en segundo plano. Te informará el resultado cuando termine.`;
  }

  if (toolName === 'browser_scroll') {
    const amountMap = { small: 300, medium: 600, large: 1200 };
    const delta = (args.direction === 'up' ? -1 : 1) * (amountMap[args.amount] || 600);
    await browser.scroll(delta);
    const img = await browser.screenshot();
    if (img && onToolCall) onToolCall({ type: 'browser_screenshot', image: img });
    return `Página desplazada ${args.direction === 'up' ? 'arriba' : 'abajo'} ${Math.abs(delta)}px.`;
  }
  return `Herramienta desconocida: ${toolName}`;
}

// ─── GEMINI ───────────────────────────────────────────────────────────────────
async function chatWithGemini(apiKey, selectedModel, message, sessionId, autoExecute, onToolCall, activeSkillId = null) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);

  console.log('DEBUG: Usando modelo:', selectedModel || process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite');
  const model = genAI.getGenerativeModel({
    model: selectedModel || process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite',
    systemInstruction: getSystemPrompt(activeSkillId),
    tools: [{
      functionDeclarations: [
        {
          name: 'execute_command',
          description: AI_TOOLS.execute_command.description,
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Comando bash a ejecutar' }
            },
            required: ['command']
          }
        },
        {
          name: 'read_file',
          description: AI_TOOLS.read_file.description,
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Ruta del archivo' }
            },
            required: ['path']
          }
        },
        {
          name: 'browser_navigate',
          description: AI_TOOLS.browser_navigate.description,
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL completa a navegar' }
            },
            required: ['url']
          }
        },
        {
          name: 'browser_get_content',
          description: AI_TOOLS.browser_get_content.description,
          parameters: { type: 'object', properties: {} }
        },
        {
          name: 'browser_screenshot',
          description: AI_TOOLS.browser_screenshot.description,
          parameters: { type: 'object', properties: {} }
        },
        {
          name: 'browser_click',
          description: AI_TOOLS.browser_click.description,
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'Selector CSS del elemento' }
            },
            required: ['selector']
          }
        },
        {
          name: 'generate_image',
          description: AI_TOOLS.generate_image.description,
          parameters: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'Descripción detallada' }
            },
            required: ['prompt']
          }
        },
        {
          name: 'messaging_send',
          description: AI_TOOLS.messaging_send.description,
          parameters: {
            type: 'object',
            properties: {
              platform: { type: 'string', description: 'Plataforma: "whatsapp" o "messenger"' },
              to: { type: 'string', description: 'Número o URL de conversación' },
              message: { type: 'string', description: 'Texto del mensaje' }
            },
            required: ['platform', 'to', 'message']
          }
        },
        {
          name: 'messaging_status',
          description: AI_TOOLS.messaging_status.description,
          parameters: { type: 'object', properties: {} }
        },
        {
          name: 'messaging_get_chats',
          description: AI_TOOLS.messaging_get_chats.description,
          parameters: {
            type: 'object',
            properties: {
              platform: { type: 'string', description: '"whatsapp", "messenger" o "all"' }
            },
            required: ['platform']
          }
        },
        {
          name: 'open_in_brave',
          description: AI_TOOLS.open_in_brave.description,
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL completa a abrir en Brave' }
            },
            required: ['url']
          }
        },
        {
          name: 'play_media',
          description: AI_TOOLS.play_media.description,
          parameters: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'Ruta local o URL a reproducir' },
              type: { type: 'string', description: '"audio" o "video"' }
            },
            required: ['source']
          }
        },
        {
          name: 'stop_media',
          description: AI_TOOLS.stop_media.description,
          parameters: { type: 'object', properties: {} }
        },
        {
          name: 'browser_scroll',
          description: AI_TOOLS.browser_scroll.description,
          parameters: {
            type: 'object',
            properties: {
              direction: { type: 'string', description: '"up" o "down"' },
              amount: { type: 'string', description: '"small", "medium" o "large"' }
            },
            required: ['direction']
          }
        },
        {
          name: 'write_file',
          description: AI_TOOLS.write_file.description,
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Ruta absoluta del archivo' },
              content: { type: 'string', description: 'Contenido completo del archivo' }
            },
            required: ['path', 'content']
          }
        },
        {
          name: 'step_update',
          description: AI_TOOLS.step_update.description,
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Mensaje de progreso para el usuario' }
            },
            required: ['message']
          }
        },
        { name: 'canva_status', description: AI_TOOLS.canva_status.description, parameters: { type: 'object', properties: {} } },
        { name: 'canva_list_designs', description: AI_TOOLS.canva_list_designs.description, parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'string' } } } },
        { name: 'canva_create_design', description: AI_TOOLS.canva_create_design.description, parameters: { type: 'object', properties: { design_type: { type: 'string' }, title: { type: 'string' } }, required: ['design_type'] } },
        { name: 'canva_export_design', description: AI_TOOLS.canva_export_design.description, parameters: { type: 'object', properties: { design_id: { type: 'string' }, format: { type: 'string' } }, required: ['design_id'] } },
        { name: 'deploy_subagent', description: AI_TOOLS.deploy_subagent.description, parameters: { type: 'object', properties: { task: { type: 'string' }, name: { type: 'string' } }, required: ['task', 'name'] } }
      ]
    }]
  });

  if (!chatHistories.has(sessionId)) chatHistories.set(sessionId, []);
  const history = chatHistories.get(sessionId);

  const chat = model.startChat({ history });

  let result = await chat.sendMessage(message);
  let response = result.response;

  // Manejar function calls en loop
  let calls = (typeof response.functionCalls === 'function') ? response.functionCalls() : [];
  let _toolCounter = 0;
  while (calls && calls.length > 0) {
    const functionResponses = [];

    for (const call of calls) {
      let toolResult;
      const isAutoTool = call.name.startsWith('browser_') || call.name === 'generate_image' || call.name.startsWith('messaging_') || call.name === 'open_in_brave' || call.name === 'play_media' || call.name === 'stop_media' || call.name === 'write_file' || call.name === 'step_update' || call.name === 'read_file' || call.name === 'read_skill' || call.name.startsWith('canva_') || call.name === 'deploy_subagent';
      const toolId = `tc_${Date.now()}_${_toolCounter++}`;
      if (autoExecute || isAutoTool) {
        onToolCall && onToolCall({ type: 'executing', name: call.name, args: call.args, toolId });
        toolResult = await runTool(call.name, call.args, onToolCall, apiKey);
        onToolCall && onToolCall({ type: 'result', name: call.name, result: toolResult, toolId });
      } else {
        // Modo confirmación: pausar y esperar
        toolResult = await waitForConfirmation(sessionId, call.name, call.args, onToolCall, toolId);
        onToolCall && onToolCall({ type: 'result', name: call.name, result: toolResult, toolId });
      }
      functionResponses.push({
        functionResponse: {
          name: call.name,
          response: { result: toolResult }
        }
      });
    }

    result = await chat.sendMessage(functionResponses);
    response = result.response;
    calls = (typeof response.functionCalls === 'function') ? response.functionCalls() : [];
  }

  // Guardar historial COMPLETO (incluye tool calls y resultados) para que el AI recuerde todo
  try {
    const fullHistory = chat.getHistory();
    // Mantener máximo 60 turnos (30 intercambios user/model)
    const trimmed = fullHistory.length > 60 ? fullHistory.slice(fullHistory.length - 60) : fullHistory;
    chatHistories.set(sessionId, trimmed);
  } catch (e) {
    // Fallback: guardar solo texto si getHistory() falla
    history.push({ role: 'user', parts: [{ text: message }] });
    history.push({ role: 'model', parts: [{ text: response.text() }] });
    if (history.length > 40) history.splice(0, 2);
  }
  saveHistories();

  return response.text();
}

// ─── DEEPSEEK ─────────────────────────────────────────────────────────────────
async function chatWithDeepSeek(apiKey, selectedModel, message, sessionId, autoExecute, onToolCall, activeSkillId = null) {
  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com'
  });

  if (!chatHistories.has(sessionId)) chatHistories.set(sessionId, []);
  const history = chatHistories.get(sessionId);

  const messages = [
    { role: 'system', content: getSystemPrompt(activeSkillId) },
    ...history,
    { role: 'user', content: message }
  ];

  const tools = [
    {
      type: 'function',
      function: {
        name: 'execute_command',
        description: AI_TOOLS.execute_command.description,
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Comando bash a ejecutar' }
          },
          required: ['command']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: AI_TOOLS.read_file.description,
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Ruta del archivo' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_navigate',
        description: AI_TOOLS.browser_navigate.description,
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL completa a navegar' }
          },
          required: ['url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_get_content',
        description: AI_TOOLS.browser_get_content.description,
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_screenshot',
        description: AI_TOOLS.browser_screenshot.description,
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_click',
        description: AI_TOOLS.browser_click.description,
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'Selector CSS del elemento' }
          },
          required: ['selector']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'generate_image',
        description: AI_TOOLS.generate_image.description,
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Descripción detallada' }
          },
          required: ['prompt']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'messaging_send',
        description: AI_TOOLS.messaging_send.description,
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string', description: 'Plataforma: "whatsapp" o "messenger"' },
            to: { type: 'string', description: 'Número o URL de conversación' },
            message: { type: 'string', description: 'Texto del mensaje' }
          },
          required: ['platform', 'to', 'message']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'messaging_status',
        description: AI_TOOLS.messaging_status.description,
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'messaging_get_chats',
        description: AI_TOOLS.messaging_get_chats.description,
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string', description: '"whatsapp", "messenger" o "all"' }
          },
          required: ['platform']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: AI_TOOLS.write_file.description,
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Ruta absoluta del archivo' },
            content: { type: 'string', description: 'Contenido completo del archivo' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'step_update',
        description: AI_TOOLS.step_update.description,
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Mensaje de progreso para el usuario' }
          },
          required: ['message']
        }
      }
    }
  ];

  let response = await client.chat.completions.create({
    model: selectedModel || 'deepseek-chat',
    messages,
    tools,
    tool_choice: 'auto'
  });

  let assistantMessage = response.choices[0].message;

  // Loop de tool calls
  let _dsToolCounter = 0;
  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    messages.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);
      let toolResult;
      const isAutoTool = toolCall.function.name.startsWith('browser_') || toolCall.function.name === 'generate_image' || toolCall.function.name.startsWith('messaging_') || toolCall.function.name === 'open_in_brave' || toolCall.function.name === 'play_media' || toolCall.function.name === 'stop_media' || toolCall.function.name === 'write_file' || toolCall.function.name === 'step_update' || toolCall.function.name === 'read_file' || toolCall.function.name === 'read_skill' || toolCall.function.name.startsWith('canva_') || toolCall.function.name === 'deploy_subagent';
      const toolId = `tc_${Date.now()}_${_dsToolCounter++}`;

      if (autoExecute || isAutoTool) {
        onToolCall && onToolCall({ type: 'executing', name: toolCall.function.name, args, toolId });
        toolResult = await runTool(toolCall.function.name, args, onToolCall, apiKey);
        onToolCall && onToolCall({ type: 'result', name: toolCall.function.name, result: toolResult, toolId });
      } else {
        toolResult = await waitForConfirmation(sessionId, toolCall.function.name, args, onToolCall, toolId);
        onToolCall && onToolCall({ type: 'result', name: toolCall.function.name, result: toolResult, toolId });
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult
      });
    }

    response = await client.chat.completions.create({
      model: selectedModel || 'deepseek-chat',
      messages,
      tools,
      tool_choice: 'auto'
    });
    assistantMessage = response.choices[0].message;
  }

  const finalText = assistantMessage.content || '';

  // Guardar historial COMPLETO incluyendo tool calls (messages[0] es el system prompt, lo omitimos)
  const fullHistory = messages.slice(1);
  if (fullHistory.length > 80) fullHistory.splice(0, fullHistory.length - 80);
  chatHistories.set(sessionId, fullHistory);
  saveHistories();

  return finalText;
}

// ─── OLLAMA (OpenAI-compatible, local) ────────────────────────────────────────
async function chatWithOllama(selectedModel, message, sessionId, autoExecute, onToolCall, activeSkillId = null) {
  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey: 'ollama',                        // Ollama no valida la key
    baseURL: 'http://localhost:11434/v1'
  });

  if (!chatHistories.has(sessionId)) chatHistories.set(sessionId, []);
  const history = chatHistories.get(sessionId);

  const messages = [
    { role: 'system', content: getSystemPrompt(activeSkillId) },
    ...history,
    { role: 'user', content: message }
  ];

  // Ollama soporta tool_calls en modelos recientes; si falla, se degrada a sin tools
  const tools = [
    {
      type: 'function',
      function: {
        name: 'execute_command',
        description: AI_TOOLS.execute_command.description,
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: 'Comando bash a ejecutar' } },
          required: ['command']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: AI_TOOLS.read_file.description,
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Ruta del archivo' } },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_navigate',
        description: AI_TOOLS.browser_navigate.description,
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', description: 'URL completa a navegar' } },
          required: ['url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_get_content',
        description: AI_TOOLS.browser_get_content.description,
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_screenshot',
        description: AI_TOOLS.browser_screenshot.description,
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'messaging_send',
        description: AI_TOOLS.messaging_send.description,
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string', description: 'Plataforma: "whatsapp" o "messenger"' },
            to: { type: 'string', description: 'Número o URL de conversación' },
            message: { type: 'string', description: 'Texto del mensaje' }
          },
          required: ['platform', 'to', 'message']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'messaging_status',
        description: AI_TOOLS.messaging_status.description,
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'messaging_get_chats',
        description: AI_TOOLS.messaging_get_chats.description,
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string', description: '"whatsapp", "messenger" o "all"' }
          },
          required: ['platform']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'open_in_brave',
        description: AI_TOOLS.open_in_brave.description,
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', description: 'URL a abrir en Brave' } },
          required: ['url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'play_media',
        description: AI_TOOLS.play_media.description,
        parameters: {
          type: 'object',
          properties: {
            source: { type: 'string', description: 'Ruta o URL a reproducir' },
            type: { type: 'string', description: '"audio" o "video"' }
          },
          required: ['source']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'stop_media',
        description: AI_TOOLS.stop_media.description,
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_scroll',
        description: AI_TOOLS.browser_scroll.description,
        parameters: {
          type: 'object',
          properties: {
            direction: { type: 'string', description: '"up" o "down"' },
            amount: { type: 'string', description: '"small", "medium" o "large"' }
          },
          required: ['direction']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: AI_TOOLS.write_file.description,
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Ruta absoluta del archivo' },
            content: { type: 'string', description: 'Contenido completo del archivo' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'step_update',
        description: AI_TOOLS.step_update.description,
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Mensaje de progreso para el usuario' }
          },
          required: ['message']
        }
      }
    }
  ];

  let response;
  try {
    response = await client.chat.completions.create({
      model: selectedModel || 'qwen3:latest',
      messages,
      tools,
      tool_choice: 'auto'
    });
  } catch (err) {
    // Si el modelo no soporta tools, reintentar sin ellas
    console.warn('Ollama: tool_calls no soportados, reintentando sin tools:', err.message);
    response = await client.chat.completions.create({
      model: selectedModel || 'qwen3:latest',
      messages
    });
  }

  let assistantMessage = response.choices[0].message;

  // Loop de tool calls
  let _ollamaToolCounter = 0;
  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    messages.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);
      let toolResult;
      const isAutoTool = toolCall.function.name.startsWith('browser_') || toolCall.function.name.startsWith('messaging_') || toolCall.function.name === 'open_in_brave' || toolCall.function.name === 'play_media' || toolCall.function.name === 'stop_media' || toolCall.function.name === 'write_file' || toolCall.function.name === 'step_update' || toolCall.function.name === 'read_file' || toolCall.function.name === 'read_skill' || toolCall.function.name.startsWith('canva_') || toolCall.function.name === 'deploy_subagent';
      const toolId = `tc_${Date.now()}_${_ollamaToolCounter++}`;

      if (autoExecute || isAutoTool) {
        onToolCall && onToolCall({ type: 'executing', name: toolCall.function.name, args, toolId });
        toolResult = await runTool(toolCall.function.name, args, onToolCall, null);
        onToolCall && onToolCall({ type: 'result', name: toolCall.function.name, result: toolResult, toolId });
      } else {
        toolResult = await waitForConfirmation(sessionId, toolCall.function.name, args, onToolCall, toolId);
        onToolCall && onToolCall({ type: 'result', name: toolCall.function.name, result: toolResult, toolId });
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult
      });
    }

    response = await client.chat.completions.create({
      model: selectedModel || 'qwen3:latest',
      messages,
      tools,
      tool_choice: 'auto'
    });
    assistantMessage = response.choices[0].message;
  }

  const finalText = assistantMessage.content || '';

  // Extraer bloque <think>...</think> si el modelo lo incluye (qwen3, deepseek-r1, etc.)
  let thinkContent = '';
  let cleanContent = finalText;
  const thinkMatch = finalText.match(/<think>([\s\S]*?)<\/think>/i);
  if (thinkMatch) {
    thinkContent = thinkMatch[1].trim();
    cleanContent = finalText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  // Guardar historial COMPLETO incluyendo tool calls (sin bloques <think> para no contaminar)
  // Reemplazar la última respuesta del asistente con la versión limpia (sin <think>)
  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.role === 'assistant' && cleanContent !== finalText) {
    messages[messages.length - 1] = { ...lastMsg, content: cleanContent };
  }
  const fullHistory = messages.slice(1); // omitir system prompt
  if (fullHistory.length > 80) fullHistory.splice(0, fullHistory.length - 80);
  chatHistories.set(sessionId, fullHistory);
  saveHistories();

  return { content: cleanContent, thinking: thinkContent };
}

// ─── SISTEMA DE CONFIRMACIÓN ──────────────────────────────────────────────────
const pendingConfirmations = new Map();

async function waitForConfirmation(sessionId, toolName, args, onToolCall, toolId) {
  return new Promise((resolve) => {
    const confirmId = `${sessionId}_${Date.now()}`;
    pendingConfirmations.set(confirmId, resolve);
    onToolCall && onToolCall({
      type: 'needs_confirmation',
      confirmId,
      toolId,  // para vincular la tarjeta con el resultado posterior
      name: toolName,
      args
    });
    // Timeout de 60s si no confirma
    setTimeout(() => {
      if (pendingConfirmations.has(confirmId)) {
        pendingConfirmations.delete(confirmId);
        resolve('Usuario no confirmó la ejecución (timeout).');
      }
    }, 60000);
  });
}

function confirmToolExecution(confirmId) {
  const resolve = pendingConfirmations.get(confirmId);
  if (resolve) {
    pendingConfirmations.delete(confirmId);
    return true;
  }
  return false;
}

async function executeConfirmedTool(confirmId, toolName, args) {
  const resolve = pendingConfirmations.get(confirmId);
  if (!resolve) return false;
  
  // Try to find the apiKey for this session
  const sessionId = confirmId.split('_')[0];
  const apiKey = sessionApiKeys.get(sessionId);
  
  pendingConfirmations.delete(confirmId);
  const result = await runTool(toolName, args, null, apiKey);
  resolve(result);
  return true;
}

function cancelToolExecution(confirmId) {
  const resolve = pendingConfirmations.get(confirmId);
  if (!resolve) return false;
  pendingConfirmations.delete(confirmId);
  resolve('El usuario canceló la ejecución del comando.');
  return true;
}

// ─── API PRINCIPAL ─────────────────────────────────────────────────────────────
async function chat({ provider, apiKey, model, message, sessionId, autoExecute = false, activeSkillId = null, onToolCall }) {
  sessionApiKeys.set(sessionId, apiKey); // Update saved key
  if (provider === 'gemini') {
    return chatWithGemini(apiKey, model, message, sessionId, autoExecute, onToolCall, activeSkillId);
  } else if (provider === 'deepseek') {
    return chatWithDeepSeek(apiKey, model, message, sessionId, autoExecute, onToolCall, activeSkillId);
  } else if (provider === 'ollama') {
    return chatWithOllama(model, message, sessionId, autoExecute, onToolCall, activeSkillId);
  }
  throw new Error(`Proveedor desconocido: ${provider}`);
}

function clearHistory(sessionId) {
  chatHistories.delete(sessionId);
  saveHistories(); // Persiste la eliminación en disco
}

function getSystemPrompt(activeSkillId = null) {
  const os = require('os');
  let prompt = `Sos moshiClaw, un agente de IA autónomo y avanzado con ACCESO TOTAL (SUDO) al sistema Linux del usuario.
Sistema: Ubuntu Linux. Hostname: ${os.hostname()}. Home: ${os.homedir()}.

══════════════════════════════════════════════════
MODO AGENTE — COMPORTAMIENTO PARA TAREAS COMPLEJAS
══════════════════════════════════════════════════

Cuando el usuario te pide construir algo (un proyecto, una app, un sistema, un script, etc.), seguí SIEMPRE este flujo:

1. ANUNCIÁ EL PLAN con step_update:
   Antes de hacer CUALQUIER cosa, llamá step_update con un resumen del plan completo.
   Ejemplo: "📋 Plan: Voy a crear una app Node.js con Express. Pasos: 1) Crear carpeta, 2) Inicializar proyecto, 3) Instalar dependencias, 4) Crear archivos, 5) Probarlo."

2. EJECUTÁ PASO A PASO anunciando cada uno con step_update:
   Llamá step_update ANTES de cada paso. Ejemplo: "📁 Paso 1/5: Creando estructura de carpetas..."
   Luego ejecutá el paso. Luego el siguiente step_update, etc.
   REGLA CRÍTICA: Nunca hagas más de 2 herramientas (execute_command, write_file, read_file) seguidas sin llamar step_update entre ellas.
   Si estás creando varios archivos seguidos, avisá antes de cada grupo: "📝 Creando archivos del frontend (index.html, style.css, app.js)..."

3. USÁ write_file PARA CREAR ARCHIVOS — NUNCA heredocs en bash:
   ✅ CORRECTO: write_file({ path: '/home/moshi/proyecto/index.js', content: '...' })
   ❌ INCORRECTO: execute_command("cat > index.js << 'EOF'\n...\nEOF")
   Los heredocs en bash fallan con caracteres especiales y bloquean el proceso.
   write_file es instantáneo, confiable, y crea el directorio padre automáticamente.

4. COMANDOS BASH: uno solo a la vez, cortos y enfocados:
   ✅ CORRECTO: execute_command("cd /home/moshi/proyecto && npm install express")
   ❌ INCORRECTO: execute_command("mkdir p && cd p && npm init -y && npm install ... && cat > ... && node ...")
   Los comandos encadenados enormes se bloquean, fallan silenciosamente y son imposibles de debuggear.
   Hacé una sola cosa por vez.

5. SIEMPRE usá flags no-interactivos en bash:
   - apt: sudo apt install -y paquete
   - npm init: npm init -y
   - cp/mkdir: mkdir -p, cp -r
   Nunca uses comandos que esperen input del usuario (el proceso se cuelga indefinidamente).

6. VERIFICÁ el resultado de cada paso antes de continuar:
   Si execute_command devuelve un error, analizalo y corregilo antes de seguir.
   Reportá el error al usuario con step_update.

7. FINALIZÁ con un resumen:
   Al terminar, llamá step_update con: "✅ Tarea completada. [Resumen de lo que se hizo]"
   Luego respondé normalmente al usuario explicando qué se creó y cómo usarlo.

══════════════════════════════════
GUÍA RÁPIDA DE HERRAMIENTAS
══════════════════════════════════

step_update(message)     → Mensaje de progreso visible al usuario. USARLO SIEMPRE en tareas de más de 1 paso.
write_file(path,content) → Crear/sobreescribir archivos. PREFERIR SIEMPRE sobre heredocs bash.
execute_command(cmd)     → Comandos bash. Uno por vez. Sin interactividad. Timeout: 2 min.
read_file(path)          → Leer archivo del sistema.
generate_image(prompt)   → Generar imágenes con Gemini. OBLIGATORIO cuando el usuario pide imágenes.
browser_navigate(url)    → Navegar en browser headless.
browser_get_content()    → Leer contenido de la página actual.
browser_screenshot()     → Captura de pantalla del browser.
browser_click(selector)  → Hacer clic en la página.
browser_scroll(dir,amt)  → Desplazar la página.
open_in_brave(url)       → Abrir URL en el Brave REAL del usuario (no headless).
play_media(source,type)  → Reproducir audio/video con mpv.
stop_media()             → Detener reproducción.
messaging_status()       → Estado de WhatsApp/Messenger.
messaging_get_chats(p)   → Listar chats de WhatsApp o Messenger.
messaging_send(p,to,msg) → Enviar mensaje por WhatsApp o Messenger.

══════════════════════════════════
REGLAS SIEMPRE VIGENTES
══════════════════════════════════

- IMÁGENES: Cuando el usuario pida imágenes, fotos, arte, logos → usá generate_image OBLIGATORIAMENTE. Nunca Python ni bash para esto.
- MENSAJERÍA: Para Messenger, SIEMPRE listá chats con messaging_get_chats antes de enviar. Nunca adivines URLs.
- BRAVE: Para "abrir Brave", "buscar en Brave" → open_in_brave. Para YouTube: open_in_brave("https://www.youtube.com/results?search_query=BUSQUEDA")
- BÚSQUEDA WEB (headless): browser_navigate("https://html.duckduckgo.com/html/?q=BUSQUEDA") → browser_get_content()
- SUDO: Usá sudo para instalar paquetes, modificar sistema, gestionar servicios.
- IDIOMA: Respondé en el mismo idioma del usuario (español o inglés).

══════════════════════════════════
ESTILO DE RESPUESTA
══════════════════════════════════

CONCISIÓN — Tu regla base:
- Respondé de forma directa y breve. Si la respuesta cabe en 2 oraciones, usá 2 oraciones.
- No rellenes con frases de introducción ("Claro, con gusto...", "Por supuesto, te explico...").
- No hagas resúmenes al final si ya dijiste todo arriba.
- Solo desarrollá en detalle cuando el usuario pida explícitamente: "explicame", "desarrollá", "pensá más en esto", "dame un análisis completo", o similar.

EMOJIS — Usalos con moderación:
- En step_update está bien usarlos para marcar progreso (✅, 📁, ⚠️).
- En las respuestas de chat: evitalos salvo que el usuario los use o el contexto sea claramente informal/festivo.
- Nunca los uses como decoración vacía al inicio de cada párrafo o ítem de lista.

══════════════════════════════════
MODO JARVIS (VOZ)
══════════════════════════════════

Cuando el usuario habla por micrófono, tus respuestas son leídas en voz alta (TTS).
En ese modo: respuestas MUY cortas (1-2 oraciones máximo). Sin markdown, sin listas.
Solo para tareas técnicas respondé con contenido largo.`;

  // ── Skills: catálogo on-demand (la IA decide cuándo leer cada skill) ─────
  try {
    const skillsModule = require('./skills');
    const catalog = skillsModule.listSkills();

    if (catalog.length > 0) {
      const catalogList = catalog.map(s =>
        `  • ${s.id} — ${s.icon} ${s.name}: ${s.description}`
      ).join('\n');

      const preselectedHint = activeSkillId
        ? `\n\n\u2b50 El usuario pre-seleccion\u00f3 el skill "${activeSkillId}". Le\u00e9lo con read_skill("${activeSkillId}") antes de responder a su primer mensaje.`
        : '';

      prompt += `

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
\u26a1 SKILLS DISPONIBLES
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

Ten\u00e9s acceso a skills con conocimiento experto que NO ten\u00e9s por defecto.
Cuando el pedido del usuario coincida con alguno, us\u00e1 read_skill(id) ANTES de responder.

${catalogList}

Reglas:
- Tema coincide con un skill \u2192 llam\u00e1 read_skill(id) PRIMERO, luego respond\u00e9 aplicando esas instrucciones
- Pods usar m\u00faltiples skills en la misma sesi\u00f3n si el tema cambia
- Sin skill relevante \u2192 respond\u00e9 normalmente sin llamar read_skill${preselectedHint}

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`;
    }
  } catch (e) {
    // Sin skills disponibles, continuar sin catálogo
  }

  return prompt;
}

module.exports = { chat, clearHistory, executeConfirmedTool, cancelToolExecution, PROVIDERS };
