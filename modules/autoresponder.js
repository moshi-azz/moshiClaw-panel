// modules/autoresponder.js — Cerebro del auto-responder
// Lee el Excel de stock, aplica reglas, genera respuestas con IA
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const EventEmitter = require('events');

const emitter = new EventEmitter();

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const STOCK_FILE = path.join(__dirname, '..', 'stock_moshiclaw.xlsx');
const PENDING_FILE = path.join(__dirname, '..', 'data', 'pending_responses.json');
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'message_history.json');
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'autoresponder_config.json');
const BLOCKED_FILE = path.join(__dirname, '..', 'data', 'blocked_contacts.json');

// Estado en memoria
let globalMode = 'SEMI'; // AUTO | SEMI | PAUSADO
let pendingResponses = []; // mensajes esperando aprobación (modo SEMI)
let messageHistory = [];
let blockedContacts = [];
let runtimeConfig = {}; // overrides en tiempo real desde MoshiClaw

// ─── PERSISTENCIA ─────────────────────────────────────────────────────────────
function ensureDataDir() {
  const dir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
}

function loadState() {
  ensureDataDir();
  try { pendingResponses = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')); } catch { pendingResponses = []; }
  try { messageHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { messageHistory = []; }
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    globalMode = cfg.mode || 'SEMI';
    runtimeConfig = cfg;
  } catch {}
  try { blockedContacts = JSON.parse(fs.readFileSync(BLOCKED_FILE, 'utf8')); } catch { blockedContacts = []; }
}

function saveState() {
  ensureDataDir();
  fs.writeFileSync(PENDING_FILE, JSON.stringify(pendingResponses, null, 2));
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(messageHistory.slice(-500), null, 2));
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ mode: globalMode, ...runtimeConfig }, null, 2));
  fs.writeFileSync(BLOCKED_FILE, JSON.stringify(blockedContacts, null, 2));
}

// ─── LEER STOCK DESDE EXCEL ───────────────────────────────────────────────────
function readStock() {
  try {
    if (!fs.existsSync(STOCK_FILE)) return { products: [], params: {} };
    const wb = XLSX.readFile(STOCK_FILE);

    // Hoja STOCK
    const stockSheet = wb.Sheets['STOCK'];
    const stockRows = stockSheet ? XLSX.utils.sheet_to_json(stockSheet, { defval: '' }) : [];
    const products = stockRows
      .filter(r => r['PRODUCTO'] || r['ID'])
      .map(r => ({
        id: r['ID'] || '',
        category: r['CATEGORÍA'] || '',
        name: r['PRODUCTO'] || '',
        description: r['DESCRIPCIÓN\n(para la IA)'] || r['DESCRIPCIÓN (para la IA)'] || r['DESCRIPCIÓN'] || '',
        price: parseFloat(String(r['PRECIO\nLISTA ($)']).replace(/[^0-9.]/g, '')) || 0,
        priceMin: parseFloat(String(r['PRECIO\nMÍNIMO ($)']).replace(/[^0-9.]/g, '')) || 0,
        stock: parseInt(r['STOCK\nACTUAL']) || 0,
        unit: r['UNIDAD'] || 'unidad',
        respond: String(r['RESPONDER\nMENSAJES']).toUpperCase() === 'SÍ' || String(r['RESPONDER\nMENSAJES']).toUpperCase() === 'SI',
        mode: String(r['MODO\nRESPUESTA']).toUpperCase() || 'AUTO',
        notes: r['NOTAS\nINTERNAS'] || '',
      }));

    // Hoja PARÁMETROS IA
    const paramSheet = wb.Sheets['PARÁMETROS IA'];
    const paramRows = paramSheet ? XLSX.utils.sheet_to_json(paramSheet, { defval: '' }) : [];
    const params = {};
    paramRows.forEach(r => {
      const key = String(r['PARÁMETRO'] || '').trim();
      const val = String(r['VALOR'] || '').trim();
      if (key && val && !key.startsWith('▶')) params[key] = val;
    });

    return { products, params };
  } catch (err) {
    console.error('Error leyendo stock:', err.message);
    return { products: [], params: {} };
  }
}

// ─── MOTOR IA ─────────────────────────────────────────────────────────────────
async function generateAIResponse(customerMessage, products, params, context = {}) {
  const availableProducts = products.filter(p => p.respond && p.stock > 0);
  const outOfStock = products.filter(p => p.respond && p.stock === 0);

  const productList = availableProducts.map(p =>
    `- ${p.name} (${p.category}): $${p.price.toLocaleString('es-AR')} | Stock: ${p.stock} ${p.unit} | Desc: ${p.description}`
  ).join('\n');

  const businessName = params['Nombre del negocio'] || 'el negocio';
  const signature = params['Firma mensajes'] || '¡Saludos!';
  const discountPolicy = params['Si pregunta por descuento'] || 'Derivar a dueño';
  const shippingPolicy = params['Ofrecer envío'] || 'Consultar';
  const installmentsPolicy = params['Aceptar pagos en cuotas'] || 'Consultar';
  const noStockAction = params['Si producto sin stock'] || 'No responder';
  const minPriceAction = params['Si precio por debajo del mínimo'] || 'No aceptar';

  const systemPrompt = `Sos el asistente de ventas de "${businessName}" en Facebook Marketplace / WhatsApp.
Tu rol es responder consultas de clientes de forma amigable, clara y vendedora.

PRODUCTOS DISPONIBLES:
${productList || '(sin stock disponible)'}

PRODUCTOS SIN STOCK (no comprometer):
${outOfStock.map(p => `- ${p.name}`).join('\n') || '(ninguno)'}

REGLAS IMPORTANTES:
- Nunca comprometer un precio por debajo del precio mínimo de cada producto
- Descuentos: ${discountPolicy}
- Envíos: ${shippingPolicy}
- Cuotas/pagos: ${installmentsPolicy}
- Si preguntan por producto sin stock: ${noStockAction}
- Si ofrecen precio bajo el mínimo: ${minPriceAction}
- Siempre terminá el mensaje con: "${signature}"
- Sé conciso (máximo 4 oraciones), amigable y profesional
- Usá emojis con moderación
- No inventés información que no está en los datos de los productos
- Si no podés responder la consulta, decí que lo consultás y te comunicás a la brevedad

CONTEXTO:
- Plataforma: ${context.platform || 'Marketplace/WhatsApp'}
- Cliente: ${context.fromName || 'cliente'}`;

  // Usar Gemini (configurado en .env) o fallback a respuesta manual
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  if (!apiKey) {
    // Sin API key: devolver respuesta de placeholder
    return `Hola! Gracias por tu consulta. Te responderemos a la brevedad. ${signature}`;
  }

  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genai = new GoogleGenerativeAI(apiKey);
    const genModel = genai.getGenerativeModel({ model });

    const result = await genModel.generateContent([
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Entendido, responderé las consultas según esas instrucciones.' }] },
      { role: 'user', parts: [{ text: `Mensaje del cliente: "${customerMessage}"` }] }
    ]);

    return result.response.text();
  } catch (err) {
    console.error('Error generando respuesta IA:', err.message);
    throw err;
  }
}

// ─── PROCESADOR PRINCIPAL ─────────────────────────────────────────────────────
async function processIncomingMessage(msg, sendFn) {
  const { platform, from, fromName, body, id } = msg;

  // 1. Verificar si está pausado globalmente
  const currentMode = runtimeConfig.forceMode || globalMode;
  if (currentMode === 'PAUSADO') {
    console.log(`⏸️  Auto-responder pausado — ignorando mensaje de ${fromName}`);
    return { action: 'paused' };
  }

  // 2. Verificar si el contacto está bloqueado
  const isBlocked = blockedContacts.some(b =>
    b && (from.includes(b) || fromName.toLowerCase().includes(b.toLowerCase()))
  );
  if (isBlocked) {
    console.log(`🚫 Contacto bloqueado: ${fromName} (${from})`);
    return { action: 'blocked' };
  }

  // 3. Leer stock actualizado
  const { products, params } = readStock();

  // 4. Verificar regla "si no está en stock, no respondas"
  const noStockAction = runtimeConfig.noStockAction || params['Si producto sin stock'] || 'No responder';

  // 5. Determinar modo para este mensaje
  let effectiveMode = currentMode;
  // Si hay override por contacto/plataforma
  if (runtimeConfig.platformMode && runtimeConfig.platformMode[platform]) {
    effectiveMode = runtimeConfig.platformMode[platform];
  }

  try {
    // 6. Generar respuesta con IA
    const aiResponse = await generateAIResponse(body, products, params, msg);

    // 7. Registrar en historial
    const historyEntry = {
      id,
      platform,
      from,
      fromName,
      received: body,
      response: aiResponse,
      mode: effectiveMode,
      timestamp: Date.now(),
      status: effectiveMode === 'AUTO' ? 'sent' : 'pending',
    };
    messageHistory.push(historyEntry);

    if (effectiveMode === 'AUTO') {
      // Enviar inmediatamente
      try {
        await sendFn(msg, aiResponse);
        historyEntry.status = 'sent';
        console.log(`✅ Respuesta AUTO enviada a ${fromName}`);
        emitter.emit('message_handled', historyEntry);
      } catch (err) {
        historyEntry.status = 'error';
        historyEntry.error = err.message;
        console.error(`❌ Error enviando a ${fromName}:`, err.message);
      }
    } else {
      // SEMI: guardar como pendiente para aprobación
      const pending = {
        ...historyEntry,
        pendingId: `pending_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        sendFnKey: platform, // para saber qué función usar al aprobar
        originalMsg: msg,
      };
      pendingResponses.push(pending);
      console.log(`📋 Respuesta SEMI pendiente de aprobación para ${fromName}`);
      emitter.emit('pending_response', pending);
    }

    saveState();
    return { action: effectiveMode === 'AUTO' ? 'sent' : 'pending', response: aiResponse };

  } catch (err) {
    console.error('Error en autoresponder:', err.message);
    return { action: 'error', error: err.message };
  }
}

// ─── APROBACIÓN / RECHAZO (modo SEMI) ────────────────────────────────────────
async function approveResponse(pendingId, sendFn) {
  const idx = pendingResponses.findIndex(p => p.pendingId === pendingId);
  if (idx === -1) return { ok: false, error: 'No encontrado' };

  const pending = pendingResponses[idx];
  try {
    await sendFn(pending.originalMsg, pending.response);
    pending.status = 'sent';
    pending.approvedAt = Date.now();
    pendingResponses.splice(idx, 1);
    const histEntry = messageHistory.find(h => h.id === pending.id);
    if (histEntry) histEntry.status = 'sent';
    saveState();
    emitter.emit('message_handled', pending);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function rejectResponse(pendingId) {
  const idx = pendingResponses.findIndex(p => p.pendingId === pendingId);
  if (idx === -1) return { ok: false, error: 'No encontrado' };
  pendingResponses[idx].status = 'rejected';
  pendingResponses[idx].rejectedAt = Date.now();
  pendingResponses.splice(idx, 1);
  saveState();
  return { ok: true };
}

// ─── CONTROLES EN TIEMPO REAL ─────────────────────────────────────────────────
function setMode(mode) {
  if (!['AUTO', 'SEMI', 'PAUSADO'].includes(mode.toUpperCase())) return { ok: false };
  globalMode = mode.toUpperCase();
  runtimeConfig.forceMode = globalMode;
  saveState();
  emitter.emit('mode_changed', globalMode);
  return { ok: true, mode: globalMode };
}

function setPlatformMode(platform, mode) {
  if (!runtimeConfig.platformMode) runtimeConfig.platformMode = {};
  runtimeConfig.platformMode[platform] = mode.toUpperCase();
  saveState();
  return { ok: true };
}

function blockContact(identifier) {
  if (!blockedContacts.includes(identifier)) {
    blockedContacts.push(identifier);
    saveState();
  }
  return { ok: true, blocked: blockedContacts };
}

function unblockContact(identifier) {
  blockedContacts = blockedContacts.filter(b => b !== identifier);
  saveState();
  return { ok: true, blocked: blockedContacts };
}

function setConfig(key, value) {
  runtimeConfig[key] = value;
  saveState();
  return { ok: true };
}

function getConfig() {
  const { products, params } = readStock();
  return {
    mode: globalMode,
    runtimeConfig,
    blockedContacts,
    pendingCount: pendingResponses.length,
    historyCount: messageHistory.length,
    stockProductCount: products.length,
    stockParams: params,
  };
}

function getPending() { return pendingResponses; }
function getHistory(limit = 50) { return messageHistory.slice(-limit); }

// Init
loadState();

module.exports = {
  processIncomingMessage,
  approveResponse,
  rejectResponse,
  setMode,
  setPlatformMode,
  blockContact,
  unblockContact,
  setConfig,
  getConfig,
  getPending,
  getHistory,
  readStock,
  emitter,
};
