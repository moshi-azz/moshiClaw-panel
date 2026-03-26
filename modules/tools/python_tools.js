const { execFile, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PYTHON_BIN = 'python3';
const TEMP_DIR = os.tmpdir();

// Inyecciones automáticas al inicio de cada script Python
const AUTO_IMPORTS = `
import os, sys, time, json, subprocess
os.environ.setdefault('DISPLAY', ':0')
os.environ.setdefault('PYTHONDONTWRITEBYTECODE', '1')
`.trimStart();

/**
 * Ejecuta código Python en un archivo temporal y retorna el resultado.
 */
function runPythonCode(code, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const tmpFile = path.join(TEMP_DIR, `moshi_py_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
    const fullCode = AUTO_IMPORTS + '\n' + code;

    try {
      fs.writeFileSync(tmpFile, fullCode, 'utf8');
    } catch (e) {
      return resolve({ stdout: '', stderr: `Error escribiendo temp file: ${e.message}`, exitCode: 1 });
    }

    const env = {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ':0',
      PYTHONPATH: process.env.PYTHONPATH || '',
      HOME: process.env.HOME || '/root',
      PATH: `${process.env.PATH}:/home/moshi/.local/bin:/usr/local/bin:/usr/bin:/bin`
    };

    const proc = execFile(PYTHON_BIN, [tmpFile], { env, timeout: timeoutMs }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      if (err && err.killed) {
        resolve({ stdout, stderr: `⏱️ Timeout: el script superó ${timeoutMs / 1000}s\n${stderr}`, exitCode: 124 });
      } else {
        resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: err ? (err.code || 1) : 0 });
      }
    });

    // Silenciar posibles errores de pipe si el proceso muere antes
    proc.on('error', (e) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      resolve({ stdout: '', stderr: `Error lanzando Python: ${e.message}`, exitCode: 1 });
    });
  });
}

module.exports = {
  definitions: {
    python_run: {
      description: `Ejecuta código Python directamente en el sistema. Potente para:
- Control GUI avanzado: pyautogui (mouse, teclado, image matching)
- Visión por computadora: opencv-python, pytesseract (OCR en pantalla)
- Sistema: psutil (procesos, CPU, RAM, discos en detalle)
- Mouse/teclado global: pynput (captura y envío de eventos)
- Procesamiento de datos: numpy, pandas (si instalado)
- Cualquier librería Python disponible en el sistema
El entorno tiene DISPLAY=:0 configurado automáticamente para herramientas GUI.
Usar timeout_seconds para scripts largos (default: 60s).`,
      parameters: {
        code: { type: 'string', description: 'Código Python completo a ejecutar. No uses comillas escapadas innecesariamente. Escribí el código limpio.' },
        timeout_seconds: { type: 'number', description: 'Tiempo máximo de ejecución en segundos (default: 60, máx recomendado: 300)' }
      }
    },
    python_pip_install: {
      description: 'Instala una o más librerías Python via pip. Usá esto cuando python_run falle con ImportError. Ejemplo: "requests beautifulsoup4" instala ambas.',
      parameters: {
        packages: { type: 'string', description: 'Nombre(s) del paquete a instalar, separados por espacio (ej: "requests numpy pandas")' }
      }
    }
  },

  handlers: {
    python_run: async (args) => {
      const { code, timeout_seconds } = args;
      if (!code || !code.trim()) return '❌ No se proporcionó código Python.';

      const timeoutMs = Math.min((timeout_seconds || 60) * 1000, 300000); // máx 5min
      const result = await runPythonCode(code, timeoutMs);

      const parts = [];
      if (result.stdout.trim()) parts.push(`STDOUT:\n${result.stdout.trim()}`);
      if (result.stderr.trim()) parts.push(`STDERR:\n${result.stderr.trim()}`);
      parts.push(`Exit code: ${result.exitCode}`);

      return parts.join('\n\n');
    },

    python_pip_install: async (args) => {
      const { packages } = args;
      if (!packages || !packages.trim()) return '❌ No se especificaron paquetes.';

      const safePackages = packages.trim().replace(/[;&|`$(){}]/g, ''); // sanitizar

      return new Promise((resolve) => {
        const cmd = `python3 -m pip install ${safePackages} --break-system-packages 2>&1`;
        exec(cmd, { timeout: 120000, env: { ...process.env, PATH: `${process.env.PATH}:/home/moshi/.local/bin` } }, (err, stdout) => {
          const output = stdout || '';
          const installed = output.includes('Successfully installed') || output.includes('already satisfied');
          const summary = installed
            ? `✅ Instalación exitosa:\n${output.split('\n').filter(l => l.includes('installed') || l.includes('satisfied')).join('\n')}`
            : `⚠️ Resultado:\n${output.slice(-800)}`;
          resolve(summary);
        });
      });
    }
  }
};
