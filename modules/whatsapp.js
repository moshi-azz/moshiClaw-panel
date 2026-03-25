// modules/whatsapp.js — Integración WhatsApp Web (auth por QR o código de teléfono)
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const EventEmitter = require('events');
const utils = require('./utils');

const emitter = new EventEmitter();

let client = null;
let qrDataUrl = null;
let pairingCode = null;   // código de vinculación por teléfono
let phoneMode = false;    // true cuando se usa login por teléfono
let phoneNumber = null;   // número para pedir el pairing code
let status = 'disconnected'; // disconnected | starting | qr_pending | phone_pending | authenticated | ready | error
let lastError = null;
let onMessageCallback = null;

const SESSION_DIR = path.join(__dirname, '..', 'data', 'wwebjs_session');

function getStatus() {
  return { status, qr: qrDataUrl, pairingCode, error: lastError };
}

/**
 * Iniciar WhatsApp.
 * @param {Function} onMessage - callback para mensajes entrantes
 * @param {string|null} phone - si se pasa, usa el método de código de teléfono en vez de QR
 */
async function start(onMessage, phone) {
  if (client && (status === 'ready' || status === 'authenticated')) {
    return { ok: true, msg: 'Ya conectado' };
  }
  if (status === 'starting' || status === 'qr_pending' || status === 'phone_pending') {
    return { ok: true, msg: 'Ya iniciando' };
  }

  onMessageCallback = onMessage;
  phoneNumber = phone ? String(phone).replace(/\D/g, '') : null;
  phoneMode = !!phoneNumber;

  status = 'starting';
  qrDataUrl = null;
  pairingCode = null;
  lastError = null;
  emitter.emit('status', status);

  let executablePath = utils.getChromiumPath();

  // Destruir cliente anterior si existe
  if (client) {
    try { await client.destroy(); } catch {}
    client = null;
  }

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    puppeteer: {
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-extensions',
      ]
    }
  });

  client.on('qr', async (qr) => {
    if (phoneMode && phoneNumber) {
      // Modo teléfono: pedir pairing code en lugar de mostrar QR
      status = 'phone_pending';
      emitter.emit('status', status);
      try {
        console.log(`📲 WhatsApp: solicitando código de vinculación para ${phoneNumber}...`);
        const code = await client.requestPairingCode(phoneNumber);
        pairingCode = code;
        console.log(`✅ WhatsApp pairing code: ${code}`);
        emitter.emit('pairing_code', code);
        emitter.emit('status', status);
      } catch (err) {
        console.error('❌ Error requestPairingCode:', err.message);
        // Si falla el código, caer de vuelta al QR
        status = 'qr_pending';
        lastError = `No se pudo obtener código: ${err.message}`;
        try {
          qrDataUrl = await QRCode.toDataURL(qr, { width: 256 });
        } catch {
          qrDataUrl = qr;
        }
        emitter.emit('qr', qrDataUrl);
        emitter.emit('status', status);
      }
    } else {
      // Modo QR normal
      status = 'qr_pending';
      try {
        qrDataUrl = await QRCode.toDataURL(qr, { width: 256 });
      } catch {
        qrDataUrl = qr;
      }
      console.log('📱 WhatsApp QR generado — escaneá desde el panel');
      emitter.emit('qr', qrDataUrl);
      emitter.emit('status', status);
    }
  });

  client.on('authenticated', () => {
    console.log('✅ WhatsApp autenticado');
    status = 'authenticated';
    qrDataUrl = null;
    pairingCode = null;
    emitter.emit('status', status);
  });

  client.on('ready', () => {
    console.log('✅ WhatsApp listo para recibir mensajes');
    status = 'ready';
    qrDataUrl = null;
    pairingCode = null;
    phoneMode = false;
    emitter.emit('status', status);
  });

  client.on('auth_failure', (msg) => {
    console.error('❌ WhatsApp auth fallida:', msg);
    status = 'error';
    lastError = msg;
    client = null;
    emitter.emit('status', status);
  });

  client.on('disconnected', (reason) => {
    console.log('🔌 WhatsApp desconectado:', reason);
    status = 'disconnected';
    client = null;
    emitter.emit('status', status);
  });

  client.on('message', async (msg) => {
    if (msg.fromMe) return;

    const contact = await msg.getContact();
    const chat = await msg.getChat();

    const incoming = {
      platform: 'whatsapp',
      id: msg.id._serialized,
      from: msg.from,
      fromName: contact.pushname || contact.name || msg.from,
      body: msg.body,
      timestamp: msg.timestamp,
      isGroup: chat.isGroup,
    };

    console.log(`📩 WA [${incoming.fromName}]: ${incoming.body.substring(0, 80)}`);
    emitter.emit('message', incoming);

    if (onMessageCallback) {
      try { await onMessageCallback(incoming); } catch (e) { console.error('Error en onMessage WA:', e.message); }
    }
  });

  // Inicializar en background — NO bloqueamos el request HTTP
  client.initialize().catch(err => {
    console.error('❌ WhatsApp initialize error:', err.message);
    status = 'error';
    lastError = err.message;
    client = null;
    emitter.emit('status', status);
  });

  return {
    ok: true,
    msg: phoneMode
      ? `Iniciando WhatsApp en background, generando código para ${phoneNumber}...`
      : 'Iniciando WhatsApp en background, esperá el QR...'
  };
}

async function stop() {
  if (client) {
    try { await client.destroy(); } catch {}
    client = null;
  }
  status = 'disconnected';
  qrDataUrl = null;
  pairingCode = null;
  phoneMode = false;
  phoneNumber = null;
  emitter.emit('status', status);
}

async function sendMessage(to, text) {
  if (status !== 'ready') throw new Error(`WhatsApp no está listo (estado: ${status})`);
  const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@c.us`;
  await client.sendMessage(chatId, text);
  return { ok: true, to: chatId };
}

async function getChats() {
  if (status !== 'ready') return [];
  const chats = await client.getChats();
  return chats.slice(0, 20).map(c => ({
    id: c.id._serialized,
    name: c.name,
    unread: c.unreadCount,
    lastMessage: c.lastMessage?.body?.substring(0, 60)
  }));
}

module.exports = { start, stop, sendMessage, getChats, getStatus, emitter };
