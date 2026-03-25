const express = require('express');
const router = express.Router();
const whatsapp = require('../modules/whatsapp');
const messenger = require('../modules/messenger');
const autoresponder = require('../modules/autoresponder');

// Mutex (imported from memory, can be shared or stay in server.js but it's used directly in the endpoints so it belongs here)
let chromiumLock = null;

// Función de envío requerida por autoresponder
async function sendReply(msg, text) {
  if (msg.platform === 'whatsapp') {
    await whatsapp.sendMessage(msg.from, text);
  } else if (msg.platform === 'messenger') {
    await messenger.sendMessage(msg.conversationUrl || msg.from, text);
  }
}

// Auto-liberar el mutex si el proceso termina inesperadamente
whatsapp.emitter.on('status', (s) => {
  if ((s === 'disconnected' || s === 'error') && chromiumLock === 'whatsapp') chromiumLock = null;
});
messenger.emitter.on('status', (ev) => {
  const s = typeof ev === 'string' ? ev : ev?.status;
  if ((s === 'disconnected' || s === 'error') && chromiumLock === 'messenger') chromiumLock = null;
});


router.get('/status', (req, res) => {
  res.json({
    whatsapp: whatsapp.getStatus(),
    messenger: messenger.getStatus(),
    autoresponder: autoresponder.getConfig(),
  });
});

router.post('/whatsapp/start', async (req, res) => {
  if (chromiumLock === 'messenger') {
    return res.status(409).json({ ok: false, error: '⚠️ Messenger está activo. Desconectá Messenger primero antes de conectar WhatsApp.' });
  }
  const phone = (req.body && req.body.phone) ? String(req.body.phone).replace(/\D/g, '') : null;
  chromiumLock = 'whatsapp';
  const result = await whatsapp.start(null, phone || null);
  if (!result.ok) chromiumLock = null;
  res.json(result);
});

router.get('/whatsapp/qr', (req, res) => {
  const { qr, status, pairingCode } = whatsapp.getStatus();
  if (pairingCode) res.json({ pairingCode, status });
  else if (qr) res.json({ qr, status });
  else res.json({ status, msg: 'Sin QR disponible (ya conectado o no iniciado)' });
});

router.post('/whatsapp/stop', async (req, res) => {
  await whatsapp.stop();
  if (chromiumLock === 'whatsapp') chromiumLock = null;
  res.json({ ok: true });
});

router.post('/messenger/start', async (req, res) => {
  if (chromiumLock === 'whatsapp') {
    return res.status(409).json({ ok: false, error: '⚠️ WhatsApp está activo. Desconectá WhatsApp primero antes de conectar Messenger.' });
  }
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan email y password' });
  chromiumLock = 'messenger';
  const result = await messenger.start(email, password);
  if (!result.ok) chromiumLock = null;
  res.json(result);
});

router.post('/messenger/retry2fa', async (req, res) => {
  const result = await messenger.retryAfter2FA();
  res.json(result);
});

router.post('/messenger/stop', async (req, res) => {
  await messenger.stop();
  if (chromiumLock === 'messenger') chromiumLock = null;
  res.json({ ok: true });
});

router.post('/send', async (req, res) => {
  const { platform, to, text } = req.body;
  try {
    if (platform === 'whatsapp') await whatsapp.sendMessage(to, text);
    else if (platform === 'messenger') await messenger.sendMessage(to, text);
    else return res.status(400).json({ error: 'Plataforma inválida' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/pending', (req, res) => {
  res.json({ pending: autoresponder.getPending() });
});

router.post('/approve/:pendingId', async (req, res) => {
  const result = await autoresponder.approveResponse(req.params.pendingId, sendReply);
  res.json(result);
});

router.post('/reject/:pendingId', (req, res) => {
  res.json(autoresponder.rejectResponse(req.params.pendingId));
});

router.get('/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ history: autoresponder.getHistory(limit) });
});

router.post('/mode', (req, res) => {
  const { mode } = req.body;
  res.json(autoresponder.setMode(mode));
});

router.post('/platform-mode', (req, res) => {
  const { platform, mode } = req.body;
  res.json(autoresponder.setPlatformMode(platform, mode));
});

router.post('/block', (req, res) => {
  const { identifier } = req.body;
  res.json(autoresponder.blockContact(identifier));
});

router.post('/unblock', (req, res) => {
  const { identifier } = req.body;
  res.json(autoresponder.unblockContact(identifier));
});

router.post('/config', (req, res) => {
  const { key, value } = req.body;
  res.json(autoresponder.setConfig(key, value));
});

module.exports = router;
