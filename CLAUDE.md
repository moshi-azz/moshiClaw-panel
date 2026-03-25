# MoshiClaw Panel — Notas para Claude Code

## Proyecto
Panel de administración web (Node.js + Express + vanilla JS) con:
- Chat con IA (Gemini / Anthropic)
- Módulos: WhatsApp, Messenger, Autoresponder
- JARVIS: asistente de voz integrado en el navegador (Web Speech API)

### Nueva Arquitectura (Refactor 2026-03)
- **Backend Modularizado:** `server.js` (punto de entrada) maneja WebSockets y la Inicialización, delegando todos los endpoints a la carpeta `routes/` (`system.js`, `files.js`, `messaging.js`, `scripts.js`, `canva_routes.js`, `skills.js`).
- **Frontend Separado:** `public/index.html` es el esqueleto estructural. Los estilos globales residen en `public/styles.css` y la lógica JavaScript en `public/app.js` para optimizar caché y carga.

---

## JARVIS Voice Assistant (`public/index.html`)

### Arquitectura
- **Wake word**: SpeechRecognition escucha continuamente; detecta "hey jarvis", "oye jarvis", "jarvis"
- **Captura de comando**: al detectar wake word, abre un segundo SpeechRecognition para capturar el pedido
- **TTS**: Web Speech API (`speechSynthesis`) para responder en voz. Función central: `_doSpeak(text, rate, pitch)`
- **Mic manual**: botón `#btn-mic` para hablar sin wake word (`toggleManualMic`)
- **Badge**: `#jarvis-badge` muestra estado visual (escuchando / te escucho)

### Bugs conocidos del Web Speech API en Chrome (RESUELTOS 2026-03-17)

| Bug | Síntoma | Fix aplicado |
|-----|---------|--------------|
| Chrome pausa `speechSynthesis` solo | TTS deja de hablar después de un rato | `setInterval` cada 10s hace `pause()+resume()` si está speaking |
| `cancel()` + `speak()` inmediato | La utterance se descarta silenciosamente | `setTimeout(..., 100)` entre `cancel()` y `speak()` para mayor seguridad |
| `onvoiceschanged` no dispara a tiempo | `jarvisVoice` queda null, TTS usa voz por defecto o falla | Retries con `setTimeout` y fallback a voces generales si no hay preferidas |
| Sincronización de idioma | Voz y texto con distintos langs pueden fallar | `utt.lang` se fuerza al mismo `lang` de `jarvisVoice` seleccionado |
| `onerror` en utterances | Fallos silenciosos, difícil de debuggear | `utt.onerror` y `utt.onstart` para trazar ejecución en consola |
| Safari iOS (PWA) | Bloquea audio/TTS sin gesto previo | Audio Unlocker: `speak('')` en el primer `touchstart/click` |
| Voces en iOS | Distintos nombres que en Chrome PC | Candidatos extra: `Juan`, `Jorge`, `Diego`, `Jordi` |
| UI Freeze en iOS | `continuous: true` cuelga el hilo principal | Se desactiva `continuous` en iOS; reinicio manual con delay de 1s |
| Pantalla Negra iOS | `visibilitychange` mal manejado con mic | Se detiene `WakeListener` al ir a background y se reinicia al volver |
| Bloqueo táctil | Badge o overlays capturando eventos | `pointer-events: none` en `#jarvis-badge` para asegurar clics en la UI |

### Cómo testear
1. Abrir el panel en Chrome/Edge
2. Activar JARVIS con el botón (ícono de robot)
3. Decir "hey jarvis" → debe responder "Dime" en voz
4. Hacer una pregunta → debe leer la respuesta en voz
5. Si no habla o falla: Tocar el ícono de 🐛 (escarabajo/bug) en el panel de chat para abrir el **Debug Console** en iOS y ver los errores en tiempo real.

### Estado actual
- **Funciona**: selección de voz masculina en español, wake word, mic manual, limpieza de markdown antes de TTS
- **Limitación conocida**: Chrome no habla si la pestaña está en segundo plano (política del navegador, no solucionable)
- El keepalive de AudioContext silencioso (`startKeepAlive`) evita que Android suspenda el reconocimiento de voz

---

## Módulos de Mensajería
- `modules/autoresponder.js` — Auto-responder IA para WhatsApp y Messenger (modos: OFF / SEMI / AUTO)
- `modules/messenger.js` — Integración Messenger vía Puppeteer (envío, recepción, chats)
- `modules/whatsapp.js` — Integración WhatsApp vía whatsapp-web.js (QR / pairing code)

---

## Sistema de Skills (`modules/skills.js`)

### Filosofía
Skills = paquetes de conocimiento experto en formato SKILL.md (estándar compatible con Claude Code, OpenCode, Cursor, Codex, Gemini CLI). La IA decide cuándo necesita un skill y lo lee bajo demanda via `read_skill`. No se pre-inyectan en el contexto para conservar tokens. "Concise is Key."

### Formato SKILL.md
```
---
name: Nombre del skill
description: Una línea describiendo cuándo usarlo
icon: 🧠
tags: [tag1, tag2]
---
# Instrucciones
Contenido en markdown...
```

### Arquitectura
- **Catálogo**: `listSkills()` escanea `data/skills/*/SKILL.md` y extrae el frontmatter (id, name, description, icon, tags).
- **Contenido**: `getSkillContent(id)` devuelve el SKILL.md completo cuando la IA lo solicita.
- **System prompt**: el catálogo (solo metadata liviana) se inyecta en cada prompt. La IA llama `read_skill(id)` para cargar el contenido completo.
- **Pre-selección manual**: UI en el panel ⚡ permite sugerir un skill a la IA; se agrega una hint `⭐ El usuario pre-seleccionó...` en el system prompt.

### Instalador GitHub (`installFromGitHub(repoUrl)`)
- `git clone --depth 1` a directorio temporal
- `find -L` para encontrar todos los SKILL.md (sigue symlinks)
- Deduplicación por `fs.realpathSync` (evita instalar el mismo archivo dos veces vía symlinks)
- `cp -rL` para copiar cada skill a `data/skills/<id>/` (desreferencia symlinks)
- Parcheo de SKILL.md: inyecta `<!-- MOSHICLAW_INSTALL: BASE_DIR=... -->` y reemplaza rutas relativas `python3 skills/<name>/` y `python3 src/<name>/` con rutas absolutas
- Retorna `{ success, installed[], skipped[], total }`

### API REST (`routes/skills.js`)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/skills` | Lista todos los skills (metadata) |
| GET | `/api/skills/:id` | Contenido raw del SKILL.md |
| POST | `/api/skills` | Crear/actualizar skill |
| DELETE | `/api/skills/:id` | Eliminar skill |
| POST | `/api/skills/install-github` | Instalar desde URL de GitHub |

### Herramienta IA
```
read_skill(id)  → Retorna el SKILL.md completo. Auto-ejecutada (no pide confirmación).
```
En el system prompt: `read_skill` y `read_file` están en `isAutoTool` para los tres providers (Gemini, DeepSeek, Ollama).

### Bug conocido y resuelto
| Bug | Síntoma | Fix |
|-----|---------|-----|
| Param mismatch en `read_skill` | `args.skill_id` era undefined cuando la IA llamaba con `{"id":"..."}` | Param renombrado a `id` en AI_TOOLS + fallback `args.id \|\| args.skill_id` |

### Skills instalados (2026-03)
- **Locales**: experto-en-codigo, modo-conciso, experto-excel, asistente-linux
- **GitHub (nextlevelbuilder/ui-ux-pro-max-skill)**: ui-ux-pro-max, ui-styling, slides, design, design-system, brand, banner-design

---

## Agente IA (`modules/ai.js`)

### Arquitectura Agentica (desde 2026-03)
El módulo `ai.js` implementa un loop de tool calls multi-proveedor (Gemini, DeepSeek, Ollama).

### Herramientas disponibles para la IA
| Herramienta | Descripción |
|-------------|-------------|
| `execute_command` | Bash con timeout 2min, buffer 10MB |
| `write_file` | Escritura directa de archivos (sin heredocs). Crea dirs padres automáticamente |
| `step_update` | Mensajes de progreso visibles al usuario en tiempo real |
| `read_file` | Lee archivos del sistema (hasta 4000 chars) |
| `browser_navigate/click/scroll/screenshot/get_content` | Browser headless Puppeteer |
| `generate_image` | Gemini imagen via `gemini-2.5-flash-image` |
| `messaging_send/status/get_chats` | WhatsApp y Messenger |
| `open_in_brave` | Abre Brave real del usuario |
| `play_media` / `stop_media` | Audio/video via mpv |
| `deploy_subagent` | Despliega agente de fondo autónomo |
| `canva_*` | Suite interactiva (status, list_designs, create_design, export_design) |

### Bugs resueltos del sistema de tool calls (2026-03)

| Bug | Síntoma | Fix aplicado |
|-----|---------|--------------|
| IDs duplicados en tarjetas | "Ejecutando..." no se actualiza nunca | `toolId` único por evento, `_toolCardMap` Map en frontend |
| Historial solo guarda texto | IA no recuerda tool calls entre sesiones | Gemini: `chat.getHistory()`. DeepSeek/Ollama: `messages.slice(1)` completo |
| Historial en memoria | IA olvida todo al reiniciar servidor | Persistencia en `data/chat_sessions.json`, carga automática al iniciar |
| iOS pierde WS en background | App reconecta pero UI queda congelada | `visibilitychange` reconecta WS inmediatamente; `onopen` resetea spinner |
| Buffer pequeño (512KB) | Comandos complejos fallan silenciosamente | `maxBuffer: 10MB` en `executeCommand` |
| Heredocs en bash | Fallan con caracteres especiales | `write_file` tool como reemplazo confiable |
| Tarjetas de confirmación sin resultado | "✓ Ejecutando..." para siempre | `toolId` en `needs_confirmation`, resultado actualiza la tarjeta |

### Persistencia del historial
- Archivo: `data/chat_sessions.json` (excluido de git via `.gitignore`)
- Guardado automático con debounce de 1.5s después de cada conversación
- Datos binarios grandes (imágenes base64) se reemplazan por placeholder para no inflar el archivo
- Máximo 60 turnos por sesión (Gemini) / 80 mensajes (DeepSeek/Ollama)

### System Prompt — Modo Agente
El prompt instruye al modelo a:
1. Anunciar el plan completo antes de ejecutar (via `step_update`)
2. Llamar `step_update` cada 2 herramientas máximo
3. Usar `write_file` en lugar de heredocs bash
4. Ejecutar comandos bash cortos y enfocados (uno por vez)
5. Verificar errores en cada paso antes de continuar
6. **Respuestas concisas por defecto** — sin relleno, sin emojis decorativos. Solo desarrollar cuando el usuario lo pide explícitamente.
7. Emojis en `step_update` OK; en respuestas de chat: moderados y solo si el contexto lo pide.

### Bugs resueltos en `open_in_brave` (2026-03-21)
| Bug | Fix |
|-----|-----|
| `nohup cmd & \|\| next` inválido en `/bin/sh` | Reemplazado por `bash -c 'if command -v brave-browser ...; fi'` |
