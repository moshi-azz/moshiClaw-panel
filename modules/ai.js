// modules/ai.js — Adaptador multi-proveedor: Gemini + DeepSeek
const { executeCommand } = require('./terminal');
const browser = require('./browser');

// Proveedores disponibles
const PROVIDERS = {
  gemini: 'gemini',
  deepseek: 'deepseek'
};

// Historial de conversación por sesión
const chatHistories = new Map();

// Herramientas que la IA puede usar
const AI_TOOLS = {
  execute_command: {
    description: 'Ejecuta un comando de shell en la PC Ubuntu del usuario',
    parameters: {
      command: { type: 'string', description: 'El comando bash a ejecutar' }
    }
  },
  read_file: {
    description: 'Lee el contenido de un archivo',
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
  }
};

// Ejecutar herramienta real
async function runTool(toolName, args, onToolCall) {
  if (toolName === 'execute_command') {
    const result = await executeCommand(args.command, 30000);
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
  return `Herramienta desconocida: ${toolName}`;
}

// ─── GEMINI ───────────────────────────────────────────────────────────────────
async function chatWithGemini(apiKey, selectedModel, message, sessionId, autoExecute, onToolCall) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: selectedModel || process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite',
    systemInstruction: getSystemPrompt(),
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
        }
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
  while (calls && calls.length > 0) {
    const functionResponses = [];

    for (const call of calls) {
      let toolResult;
      const isBrowserTool = call.name.startsWith('browser_');
      if (autoExecute || isBrowserTool) {
        // Las herramientas de navegador siempre se ejecutan sin confirmación
        onToolCall && onToolCall({ type: 'executing', name: call.name, args: call.args });
        toolResult = await runTool(call.name, call.args, onToolCall);
        onToolCall && onToolCall({ type: 'result', name: call.name, result: toolResult });
      } else {
        // Modo confirmación: pausar y esperar
        toolResult = await waitForConfirmation(sessionId, call.name, call.args, onToolCall);
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

  // Guardar historial simplificado
  history.push({ role: 'user', parts: [{ text: message }] });
  history.push({ role: 'model', parts: [{ text: response.text() }] });
  if (history.length > 40) history.splice(0, 2); // Limitar historial

  return response.text();
}

// ─── DEEPSEEK ─────────────────────────────────────────────────────────────────
async function chatWithDeepSeek(apiKey, selectedModel, message, sessionId, autoExecute, onToolCall) {
  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com'
  });

  if (!chatHistories.has(sessionId)) chatHistories.set(sessionId, []);
  const history = chatHistories.get(sessionId);

  const messages = [
    { role: 'system', content: getSystemPrompt() },
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
  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    messages.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);
      let toolResult;
      const isBrowserTool = toolCall.function.name.startsWith('browser_');

      if (autoExecute || isBrowserTool) {
        onToolCall && onToolCall({ type: 'executing', name: toolCall.function.name, args });
        toolResult = await runTool(toolCall.function.name, args, onToolCall);
        onToolCall && onToolCall({ type: 'result', name: toolCall.function.name, result: toolResult });
      } else {
        toolResult = await waitForConfirmation(sessionId, toolCall.function.name, args, onToolCall);
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

  // Actualizar historial
  history.push({ role: 'user', content: message });
  history.push({ role: 'assistant', content: finalText });
  if (history.length > 40) history.splice(0, 2);

  return finalText;
}

// ─── SISTEMA DE CONFIRMACIÓN ──────────────────────────────────────────────────
const pendingConfirmations = new Map();

async function waitForConfirmation(sessionId, toolName, args, onToolCall) {
  return new Promise((resolve) => {
    const confirmId = `${sessionId}_${Date.now()}`;
    pendingConfirmations.set(confirmId, resolve);
    onToolCall && onToolCall({
      type: 'needs_confirmation',
      confirmId,
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
  pendingConfirmations.delete(confirmId);
  const result = await runTool(toolName, args);
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
async function chat({ provider, apiKey, model, message, sessionId, autoExecute = false, onToolCall }) {
  if (provider === 'gemini') {
    return chatWithGemini(apiKey, model, message, sessionId, autoExecute, onToolCall);
  } else if (provider === 'deepseek') {
    return chatWithDeepSeek(apiKey, model, message, sessionId, autoExecute, onToolCall);
  }
  throw new Error(`Proveedor desconocido: ${provider}`);
}

function clearHistory(sessionId) {
  chatHistories.delete(sessionId);
}

function getSystemPrompt() {
  const os = require('os');
  return `Sos moshiClaw, un asistente de IA experto en sistemas Linux/Ubuntu con acceso completo a la PC del usuario y a un navegador web controlado.
El sistema operativo es Ubuntu Linux. Hostname: ${os.hostname()}. Directorio home: ${os.homedir()}.

Tus capacidades:
- Ejecutar comandos bash en la PC del usuario (execute_command)
- Leer archivos del sistema (read_file)
- Navegar a cualquier sitio web (browser_navigate)
- Leer el contenido de páginas web (browser_get_content)
- Tomar capturas de pantalla del navegador (browser_screenshot)
- Hacer clic en elementos de páginas web (browser_click)

Cuando el usuario te pida buscar algo en internet:
1. Usá browser_navigate para ir a: https://html.duckduckgo.com/html/?q=TU+BUSQUEDA (reemplazá espacios con +)
2. Usá browser_get_content para leer los resultados
3. Si necesitás entrar a un resultado específico, usá browser_navigate con esa URL
4. Respondé con la información encontrada

IMPORTANTE: Nunca uses google.com para buscar — DuckDuckGo funciona sin bloqueos con el navegador automatizado.
Si querés buscar en Wikipedia: https://es.wikipedia.org/wiki/TEMA
Siempre explicá qué estás haciendo.
Si un comando puede ser peligroso, advertí al usuario antes de ejecutarlo.
Respondé en el mismo idioma que usa el usuario (español o inglés).`;
}

module.exports = { chat, clearHistory, executeConfirmedTool, cancelToolExecution, PROVIDERS };
