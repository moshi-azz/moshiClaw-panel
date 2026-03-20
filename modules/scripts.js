const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const SCRIPTS_FILE = path.join(__dirname, '../data/scripts.json');
const PANEL_DIR = path.join(__dirname, '..');

// Ensure data dir exists
if (!fs.existsSync(path.join(__dirname, '../data'))) {
    fs.mkdirSync(path.join(__dirname, '../data'));
}

// Load scripts
function getScripts() {
    if (!fs.existsSync(SCRIPTS_FILE)) {
        // Default scripts — incluye cwd para que npm run start corra en el directorio correcto
        const defaults = [
            { id: 1, name: 'Limpiar Logs', cmd: 'rm -rf /var/log/*.log 2>/dev/null || true', cwd: '/' },
            { id: 2, name: 'Actualizar Sistema', cmd: 'sudo apt update && sudo apt upgrade -y', cwd: '/' },
            { id: 3, name: 'Reiniciar Servidor', cmd: 'npm run start', cwd: PANEL_DIR }
        ];
        fs.writeFileSync(SCRIPTS_FILE, JSON.stringify(defaults, null, 2));
        return defaults;
    }
    return JSON.parse(fs.readFileSync(SCRIPTS_FILE, 'utf8'));
}

function saveScripts(scripts) {
    fs.writeFileSync(SCRIPTS_FILE, JSON.stringify(scripts, null, 2));
}

function runScript(id) {
    const scripts = getScripts();
    const script = scripts.find(s => s.id === parseInt(id));
    if (!script) throw new Error('Script no encontrado');

    const options = {
        timeout: 30000,   // 30s máximo para evitar colgadas
        maxBuffer: 1024 * 1024  // 1MB de output
    };

    // Si el script tiene cwd definido y existe, usarlo; si no, usar el home del usuario
    if (script.cwd && fs.existsSync(script.cwd)) {
        options.cwd = script.cwd;
    }

    return new Promise((resolve) => {
        exec(script.cmd, options, (err, stdout, stderr) => {
            resolve({
                success: !err,
                output: (stdout || '') + (stderr || ''),
                exitCode: err ? (err.code || 1) : 0
            });
        });
    });
}

function addScript(name, cmd, cwd) {
    const scripts = getScripts();
    const newScript = {
        id: Date.now(),
        name,
        cmd,
        cwd: cwd || null
    };
    scripts.push(newScript);
    saveScripts(scripts);
    return newScript;
}

function deleteScript(id) {
    let scripts = getScripts();
    scripts = scripts.filter(s => s.id !== parseInt(id));
    saveScripts(scripts);
}

module.exports = { getScripts, runScript, addScript, deleteScript };
