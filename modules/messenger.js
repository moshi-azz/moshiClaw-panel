// modules/messenger.js — Facebook Messenger con login email+contraseña (Puppeteer)
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

const emitter = new EventEmitter();

// Reemplaza page.waitForTimeout() eliminado en Puppeteer v22+
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

const COOKIES_PATH = path.join(__dirname, '..', 'data', 'fb_cookies.json');
const MESSENGER_URL = 'https://www.messenger.com';

let browser = null;
let page = null;
let status = 'disconnected'; // disconnected | logging_in | ready | error | needs_2fa
let lastError = null;
let pollInterval = null;
let knownMessageIds = new Set();
let onMessageCallback = null;
let connectedEmail = null;    // email usado para conectarse
let connectedUsername = null; // nombre de usuario extraído de Facebook

function getStatus() {
  return {
    status,
    error: lastError,
    email: connectedEmail || null,
    username: connectedUsername || null
  };
}

function getExecutablePath() {
  try { return require('chromium').path; } catch {}
  const candidates = [
    '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
  ];
  return candidates.find(p => fs.existsSync(p)) || 'chromium-browser';
}

async function saveCookies() {
  if (!page) return;
  const cookies = await page.cookies();
  fs.mkdirSync(path.dirname(COOKIES_PATH), { recursive: true });
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
}

async function loadCookies() {
  if (!page || !fs.existsSync(COOKIES_PATH)) return false;
  try {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
    await page.setCookie(...cookies);
    return true;
  } catch { return false; }
}

/**
 * Extrae el nombre del usuario conectado desde la página de Messenger.
 * Busca el nombre en el header/sidebar de Messenger.
 */
async function extractUsername() {
  if (!page) return null;
  try {
    const name = await page.evaluate(() => {
      // Intentar varios selectores donde Messenger muestra el nombre del usuario
      const selectors = [
        '[data-testid="user-name"]',
        'h1[dir="auto"]',
        '[aria-label*="Profile"]',
        '.x1heor9g span',  // Nombre en sidebar
        'span[data-testid="navigation_sidebar_account_name"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent && el.textContent.trim().length > 1) {
          return el.textContent.trim();
        }
      }
      // Fallback: buscar en la barra de título
      return document.title.split(' - ')[0] || null;
    });
    return name && name !== 'Messenger' ? name : null;
  } catch {
    return null;
  }
}

async function launchBrowser() {
  if (browser) { try { await browser.close(); } catch {} }
  browser = await puppeteer.launch({
    executablePath: getExecutablePath(),
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-gpu',
      '--window-size=1280,900',
    ]
  });
  const pages = await browser.pages();
  page = pages[0] || await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
}

async function start(email, password, onMessage) {
  if (status === 'ready') return { ok: true, msg: 'Ya conectado' };

  onMessageCallback = onMessage;
  status = 'starting';
  lastError = null;
  connectedEmail = email || null;
  connectedUsername = null;

  try {
    await launchBrowser();

    // Intentar con cookies guardadas primero
    await loadCookies();
    await page.goto(MESSENGER_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    const url = page.url();
    const isLoggedIn = !url.includes('login') && !url.includes('signin');

    if (!isLoggedIn) {
      // Login con email + contraseña
      status = 'logging_in';
      console.log('🔑 Messenger: iniciando sesión...');

      await page.goto('https://www.facebook.com/login', { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForSelector('#email', { timeout: 10000 });
      await page.type('#email', email, { delay: 60 });
      await page.type('#pass', password, { delay: 60 });
      await page.click('[name="login"]');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });

      const afterLogin = page.url();
      if (afterLogin.includes('checkpoint') || afterLogin.includes('two_step') || afterLogin.includes('login')) {
        status = 'needs_2fa';
        emitter.emit('status', { status, msg: 'Facebook requiere verificación adicional. Revisá tu teléfono o email de seguridad y completá la verificación.' });
        console.log('⚠️  Messenger: se requiere 2FA o verificación adicional');
        return { ok: false, needs2fa: true, msg: 'Se requiere verificación adicional de Facebook. Completá la verificación en la cuenta y volvé a intentar.' };
      }

      await saveCookies();
      await page.goto(MESSENGER_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    }

    // Extraer nombre de usuario de la sesión activa
    await sleep(2000); // Esperar que cargue el sidebar
    connectedUsername = await extractUsername();
    console.log(`✅ Messenger: sesión iniciada — Usuario: ${connectedUsername || connectedEmail || 'desconocido'}`);

    status = 'ready';
    emitter.emit('status', { status, username: connectedUsername, email: connectedEmail });
    startPolling();
    return { ok: true, username: connectedUsername, email: connectedEmail };

  } catch (err) {
    status = 'error';
    lastError = err.message;
    console.error('❌ Messenger error:', err.message);
    return { ok: false, error: err.message };
  }
}

// Polling: revisa nuevos mensajes cada 30 segundos
function startPolling(intervalMs = 30000) {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    if (status !== 'ready') return;
    try { await checkNewMessages(); } catch (e) {
      console.error('Error polling Messenger:', e.message);
    }
  }, intervalMs);
  // Check inmediato al arrancar
  setTimeout(() => checkNewMessages(), 3000);
}

async function checkNewMessages() {
  if (!page || status !== 'ready') return;

  try {
    // Obtener lista de conversaciones visibles en Messenger
    const conversations = await page.evaluate(() => {
      const results = [];
      const threadItems = document.querySelectorAll('[data-testid="mwthreadlist-item"], [role="row"]');
      threadItems.forEach((item, idx) => {
        if (idx > 15) return;
        const nameEl = item.querySelector('[data-testid="conversation_name"]') ||
                       item.querySelector('span[dir="auto"]');
        const previewEl = item.querySelector('[data-testid="last_message_snippet"]') ||
                          item.querySelectorAll('span[dir="auto"]')[1];
        const unreadBadge = item.querySelector('[data-testid="unread_badge"]') ||
                            item.querySelector('[aria-label*="unread"]');
        const href = item.querySelector('a')?.href || '';
        if (nameEl && href) {
          results.push({
            name: nameEl.innerText,
            preview: previewEl?.innerText || '',
            unread: !!unreadBadge,
            href
          });
        }
      });
      return results;
    });

    for (const conv of conversations) {
      if (!conv.unread) continue;
      await page.goto(conv.href, { waitUntil: 'networkidle2', timeout: 20000 });
      await sleep(1500);

      const messages = await page.evaluate(() => {
        const msgs = [];
        const bubbles = document.querySelectorAll('[data-testid="message_body"], .x1iorvi4 span[dir="auto"]');
        bubbles.forEach((b, i) => {
          if (b.innerText && i < 5) msgs.push(b.innerText);
        });
        return msgs;
      });

      if (messages.length > 0) {
        const msgId = `fb_${conv.name}_${messages[messages.length - 1].substring(0, 20)}`;
        if (!knownMessageIds.has(msgId)) {
          knownMessageIds.add(msgId);
          const incoming = {
            platform: 'messenger',
            id: msgId,
            from: conv.href,
            fromName: conv.name,
            body: messages[messages.length - 1],
            timestamp: Date.now(),
            isGroup: false,
            conversationUrl: conv.href,
          };
          console.log(`📩 Messenger [${incoming.fromName}]: ${incoming.body.substring(0, 80)}`);
          emitter.emit('message', incoming);
          if (onMessageCallback) {
            try { await onMessageCallback(incoming); } catch (e) { console.error('Error onMessage Messenger:', e.message); }
          }
        }
      }

      await page.goto(MESSENGER_URL, { waitUntil: 'networkidle2', timeout: 20000 });
      await sleep(1000);
    }
  } catch (err) {
    console.error('Error checkNewMessages:', err.message);
    if (err.message.includes('Session closed') || err.message.includes('Target closed')) {
      status = 'disconnected';
    }
  }
}

async function sendMessage(conversationUrl, text) {
  if (status !== 'ready') throw new Error(`Messenger no está listo (estado: ${status})`);

  const currentUrl = page.url();
  if (currentUrl !== conversationUrl) {
    await page.goto(conversationUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(1500);
  }

  const inputSelectors = [
    '[contenteditable="true"][data-lexical-editor="true"]',
    '[contenteditable="true"]',
    '[role="textbox"]',
    'textarea',
  ];

  let inputEl = null;
  for (const sel of inputSelectors) {
    inputEl = await page.$(sel);
    if (inputEl) break;
  }

  if (!inputEl) throw new Error('No se encontró el campo de texto en Messenger');

  await inputEl.click();
  await sleep(300);
  await page.keyboard.type(text, { delay: 30 });
  await sleep(300);
  await page.keyboard.press('Enter');
  await sleep(500);

  await saveCookies();

  return { ok: true, to: conversationUrl };
}

async function getChats() {
  if (status !== 'ready' || !page) return [];
  try {
    const currentUrl = page.url();
    if (!currentUrl.startsWith('https://www.messenger.com')) {
      await page.goto(MESSENGER_URL, { waitUntil: 'networkidle2', timeout: 20000 });
      await sleep(1500);
    }
    const chats = await page.evaluate(() => {
      const results = [];
      const items = document.querySelectorAll('[data-testid="mwthreadlist-item"], [role="row"]');
      items.forEach((item, idx) => {
        if (idx > 19) return;
        const nameEl = item.querySelector('[data-testid="conversation_name"]') ||
                       item.querySelector('span[dir="auto"]');
        const href = item.querySelector('a')?.href || '';
        if (nameEl && href && href.includes('messenger.com')) {
          results.push({ name: nameEl.innerText.trim(), url: href });
        }
      });
      return results;
    });
    return chats;
  } catch (err) {
    console.error('getChats Messenger error:', err.message);
    return [];
  }
}

async function stop() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  if (browser) { try { await browser.close(); } catch {} browser = null; }
  page = null;
  status = 'disconnected';
  connectedEmail = null;
  connectedUsername = null;
  emitter.emit('status', { status });
}

// Reintentar con 2FA completado manualmente
async function retryAfter2FA() {
  if (!browser || !page) return { ok: false, error: 'No hay sesión activa' };
  try {
    await saveCookies();
    await page.goto(MESSENGER_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    const url = page.url();
    if (!url.includes('login')) {
      await sleep(2000);
      connectedUsername = await extractUsername();
      status = 'ready';
      emitter.emit('status', { status, username: connectedUsername, email: connectedEmail });
      startPolling();
      return { ok: true, username: connectedUsername };
    }
    return { ok: false, error: 'Todavía en la pantalla de login' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { start, stop, sendMessage, getStatus, getChats, retryAfter2FA, emitter };
