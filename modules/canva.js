// modules/canva.js — Integración Canva Connect API (OAuth 2.0)
const fs   = require('fs');
const path = require('path');

const TOKEN_FILE      = path.join(__dirname, '../data/canva_token.json');
const CANVA_API_BASE  = 'https://api.canva.com/rest/v1';
const CANVA_AUTH_URL  = 'https://www.canva.com/api/oauth/code';
const CANVA_TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';

// ─── CREDENCIALES DE LA APP (registradas UNA VEZ en canva.com/developers) ─────
// Los usuarios finales NO necesitan tocar esto. Solo el desarrollador de
// MoshiClaw reemplaza estos valores al registrar la app en Canva.
// Override opcional vía .env: CANVA_CLIENT_ID / CANVA_CLIENT_SECRET
const APP_CLIENT_ID     = process.env.CANVA_CLIENT_ID     || 'REEMPLAZAR_CON_TU_CLIENT_ID';
const APP_CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET || 'REEMPLAZAR_CON_TU_CLIENT_SECRET';

// Redirect URI fija — debe estar registrada exactamente así en el Developer Portal de Canva.
// Si el usuario usa un puerto distinto a 3000, puede sobreescribir con CANVA_REDIRECT_URI en .env.
const REDIRECT_URI = process.env.CANVA_REDIRECT_URI || 'http://localhost:3000/auth/canva/callback';

// Scopes requeridos
const SCOPES = [
  'profile:read',
  'design:meta:read',
  'design:content:read',
  'design:content:write',
  'asset:read',
  'asset:write'
].join(' ');

// ─── FETCH HELPER (usa global fetch de Node 18+ o node-fetch) ─────────────────
async function doFetch(url, options = {}) {
  if (typeof fetch !== 'undefined') {
    // Node 18+ global fetch
    return fetch(url, options);
  }
  // Fallback para Node < 18
  const nodeFetch = require('node-fetch');
  return nodeFetch(url, options);
}

// ─── TOKEN STORAGE ─────────────────────────────────────────────────────────────
function loadToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('⚠️  Canva: error cargando token:', e.message);
  }
  return null;
}

function saveToken(tokenData) {
  try {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...tokenData, saved_at: Date.now() }, null, 2));
  } catch (e) {
    console.error('⚠️  Canva: error guardando token:', e.message);
  }
}

// ─── OAUTH 2.0 ────────────────────────────────────────────────────────────────
function getAuthUrl() {
  if (APP_CLIENT_ID.startsWith('REEMPLAZAR'))
    throw new Error('Las credenciales de Canva no están configuradas. Revisá modules/canva.js o el README.');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     APP_CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    scope:         SCOPES,
    state:         Math.random().toString(36).slice(2) + Date.now()
  });

  return `${CANVA_AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code) {
  const credentials = Buffer.from(`${APP_CLIENT_ID}:${APP_CLIENT_SECRET}`).toString('base64');

  const res = await doFetch(CANVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    }).toString()
  });

  const data = await res.json();
  if (!res.ok)
    throw new Error(`Error obteniendo token Canva: ${data.error_description || data.error || JSON.stringify(data)}`);

  data.expires_at = Date.now() + (data.expires_in * 1000);
  saveToken(data);
  console.log('✅ Canva: token OAuth guardado correctamente');
  return data;
}

async function refreshAccessToken() {
  const token = loadToken();
  if (!token?.refresh_token)
    throw new Error('No hay refresh_token disponible. Reconectá Canva desde el panel.');

  const credentials = Buffer.from(`${APP_CLIENT_ID}:${APP_CLIENT_SECRET}`).toString('base64');

  const res = await doFetch(CANVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: token.refresh_token
    }).toString()
  });

  const data = await res.json();
  if (!res.ok)
    throw new Error(`Error renovando token Canva: ${data.error_description || data.error}`);

  data.expires_at    = Date.now() + (data.expires_in * 1000);
  if (!data.refresh_token) data.refresh_token = token.refresh_token;
  saveToken(data);
  console.log('🔄 Canva: token renovado automáticamente');
  return data;
}

async function getValidToken() {
  let token = loadToken();
  if (!token) return null;

  // Si expira en menos de 5 minutos → renovar
  if (token.expires_at && Date.now() > token.expires_at - 300_000) {
    try   { token = await refreshAccessToken(); }
    catch (e) { console.error('Canva refresh error:', e.message); return null; }
  }
  return token;
}

function isConnected() {
  const t = loadToken();
  return !!(t?.access_token);
}

function disconnect() {
  try {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
    console.log('🔌 Canva desconectado');
    return true;
  } catch { return false; }
}

// ─── API HELPER ───────────────────────────────────────────────────────────────
async function canvaRequest(method, endpoint, body = null) {
  const token = await getValidToken();
  if (!token)
    throw new Error('Canva no está conectado. Autorizá primero desde el panel de Canva.');

  const url     = `${CANVA_API_BASE}${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token.access_token}`,
      'Content-Type':  'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);

  const res  = await doFetch(url, options);
  const data = await res.json();

  if (!res.ok) {
    const msg = data.message || data.error || JSON.stringify(data);
    throw new Error(`Canva API ${res.status}: ${msg}`);
  }
  return data;
}

// ─── FUNCIONES DE ALTO NIVEL ──────────────────────────────────────────────────

/** Perfil del usuario autenticado */
async function getProfile() {
  return canvaRequest('GET', '/users/me');
}

/**
 * Lista diseños del usuario.
 * @param {object} opts - { query?: string, limit?: number, continuation?: string }
 */
async function listDesigns(opts = {}) {
  const params = new URLSearchParams();
  if (opts.query)        params.set('query', opts.query);
  if (opts.limit)        params.set('limit', String(opts.limit));
  if (opts.continuation) params.set('continuation', opts.continuation);
  const qs = params.toString();
  return canvaRequest('GET', `/designs${qs ? '?' + qs : ''}`);
}

/** Obtiene info de un diseño por ID */
async function getDesign(designId) {
  return canvaRequest('GET', `/designs/${designId}`);
}

/**
 * Crea un nuevo diseño en blanco.
 * @param {string} designType - 'presentation', 'poster', 'instagram_post', 'flyer', etc.
 * @param {string} title      - Título del diseño
 */
async function createDesign(designType, title) {
  return canvaRequest('POST', '/designs', {
    design_type: { type: designType },
    title:       title || `Diseño ${new Date().toLocaleDateString('es-AR')}`
  });
}

/**
 * Exporta un diseño y espera hasta que esté listo (polling, máx 60 seg).
 * @param {string} designId
 * @param {string} format - 'pdf' | 'png' | 'jpg' | 'pptx' | 'gif' | 'mp4'
 * @returns {object} Job con URLs de descarga
 */
async function exportDesign(designId, format = 'pdf') {
  // 1. Iniciar export job
  const jobRes = await canvaRequest('POST', '/exports', {
    design_id: designId,
    format:    { type: format }
  });

  const jobId = jobRes.job?.id || jobRes.id;
  if (!jobId) throw new Error('No se obtuvo job ID del export de Canva');

  // 2. Polling hasta completar (máx 30 intentos × 2 seg = 60 seg)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await canvaRequest('GET', `/exports/${jobId}`);
    const jobStatus = status.job?.status || status.status;

    if (jobStatus === 'success') return status.job || status;
    if (jobStatus === 'failed')  throw new Error(`Export de Canva falló (ID: ${jobId})`);
  }

  throw new Error('Timeout: la exportación de Canva tardó demasiado');
}

module.exports = {
  // OAuth
  getAuthUrl,
  exchangeCode,
  getValidToken,
  isConnected,
  disconnect,
  // API
  getProfile,
  listDesigns,
  getDesign,
  createDesign,
  exportDesign,
  canvaRequest
};
