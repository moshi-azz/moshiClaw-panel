const fs = require('fs');
const path = require('path');

/**
 * Detecta la ruta del ejecutable de Chromium/Chrome disponible en el sistema.
 * @returns {string|undefined}
 */
function getChromiumPath() {
  // Intentar primero con el paquete 'chromium' de npm si existe
  try {
    const { path: cPath } = require('chromium');
    if (cPath) return cPath;
  } catch {}

  // Fallbacks para Linux (Ubuntu/Debian)
  const candidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium'
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return undefined;
}

/**
 * Espera una cantidad de milisegundos.
 * @param {number} ms 
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  getChromiumPath,
  sleep
};
