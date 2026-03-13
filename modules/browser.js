// modules/browser.js — Controlador de Navegador (Puppeteer) para agente IA
const puppeteer = require('puppeteer-core');
const chromium = require('chromium');

let browser = null;
let page = null;

async function launch() {
  if (browser) return;
  browser = await puppeteer.launch({
    executablePath: chromium.path,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',  // Ocultar flag de automatización
      '--disable-infobars',
      '--window-size=1280,720',
      '--lang=es-AR,es,en-US,en'
    ]
  });

  // Escuchar nuevas páginas para aplicar evasión
  browser.on('targetcreated', async (target) => {
    const p = await target.page();
    if (p) await applyEvasion(p);
  });

  page = await browser.newPage();
  await applyEvasion(page);
  await page.setViewport({ width: 1280, height: 720 });
  console.log('🌐 Browser lanzado');
}

// Ocultar huellas de automatización en cada página
async function applyEvasion(p) {
  try {
    await p.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await p.evaluateOnNewDocument(() => {
      // Eliminar propiedad webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // Simular plugins reales
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      // Simular idiomas reales
      Object.defineProperty(navigator, 'languages', { get: () => ['es-AR', 'es', 'en-US', 'en'] });
    });
  } catch {}
}

async function navigate(url) {
  if (!browser) await launch();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    return { title: await page.title(), url: page.url() };
  } catch (e) {
    return { error: e.message, url };
  }
}

async function screenshot() {
  if (!page) return null;
  try {
    return await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 75 });
  } catch (e) {
    console.error('Screenshot error:', e.message);
    return null;
  }
}

/**
 * Extrae el texto visible de la página actual, limpiado y limitado.
 * La IA usará esto para "leer" el contenido de sitios web.
 */
async function getContent() {
  if (!page) return 'No hay página abierta.';
  try {
    const content = await page.evaluate(() => {
      // Eliminar scripts, styles, nav, footer para quedarse con el contenido útil
      const remove = document.querySelectorAll('script, style, nav, footer, header, iframe, noscript');
      remove.forEach(el => el.remove());
      return document.body ? document.body.innerText.trim() : '';
    });
    // Limpiar whitespace excesivo y limitar a 4000 chars para no saturar el contexto
    return content
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .slice(0, 4000) || 'Página vacía o sin contenido de texto.';
  } catch (e) {
    return `Error obteniendo contenido: ${e.message}`;
  }
}

/**
 * Hace clic en un elemento CSS selector.
 */
async function click(selector) {
  if (!page) return 'No hay página abierta.';
  try {
    await page.click(selector);
    return `Clic en "${selector}" realizado.`;
  } catch (e) {
    return `Error al hacer clic en "${selector}": ${e.message}`;
  }
}

/**
 * Escribe texto en un campo de input.
 */
async function typeInto(selector, text) {
  if (!page) return 'No hay página abierta.';
  try {
    await page.click(selector);
    await page.type(selector, text, { delay: 20 });
    return `Texto "${text}" escrito en "${selector}".`;
  } catch (e) {
    return `Error al escribir en "${selector}": ${e.message}`;
  }
}

/**
 * Evalúa JS arbitrario en la página (scroll, extraer datos específicos, etc.)
 */
async function evaluate(script) {
  if (!page) return 'No hay página abierta.';
  try {
    const result = await page.evaluate(new Function(`return (${script})()`));
    return JSON.stringify(result);
  } catch (e) {
    return `Error evaluando script: ${e.message}`;
  }
}

/**
 * Devuelve info básica de la página actual (title + URL).
 */
async function getPageInfo() {
  if (!page) return { title: 'N/A', url: 'N/A' };
  try {
    return { title: await page.title(), url: page.url() };
  } catch (e) {
    return { title: 'Error', url: 'Error', error: e.message };
  }
}

async function close() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
    console.log('🌐 Browser cerrado');
  }
}

module.exports = { launch, navigate, screenshot, click, typeInto, getContent, evaluate, getPageInfo, close };
