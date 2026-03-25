const { executeCommand } = require('../terminal');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

module.exports = {
  definitions: {
    execute_command: {
      description: 'Ejecuta CUALQUIER comando bash en la PC Ubuntu. Tenés permisos de SUDO para tareas administrativas, instalaciones y control total del sistema.',
      parameters: {
        command: { type: 'string', description: 'El comando bash completo a ejecutar (usá sudo si es necesario)' }
      }
    },
    read_file: {
      description: 'Lee el contenido de cualquier archivo del sistema, incluyendo archivos protegidos si usás sudo en conjunto con herramientas de lectura.',
      parameters: {
        path: { type: 'string', description: 'Ruta absoluta del archivo' }
      }
    },
    write_file: {
      description: 'Escribe contenido de texto directamente a un archivo del sistema. Úsalo SIEMPRE para crear o sobreescribir archivos. Crea los directorios padres automáticamente.',
      parameters: {
        path: { type: 'string', description: 'Ruta absoluta del archivo a escribir' },
        content: { type: 'string', description: 'Contenido completo del archivo' }
      }
    },
    step_update: {
      description: 'Envía un mensaje de progreso visible al usuario durante una tarea larga. Usá esto SIEMPRE antes de cada paso importante.',
      parameters: {
        message: { type: 'string', description: 'Mensaje descriptivo del paso actual' }
      }
    },
    open_in_brave: {
      description: 'Abre una URL en el navegador Brave REAL del escritorio del usuario.',
      parameters: {
        url: { type: 'string', description: 'URL completa a abrir (incluir https://)' }
      }
    },
    play_media: {
      description: 'Reproduce un archivo de audio o video, o una URL de YouTube/Spotify, usando mpv o vlc.',
      parameters: {
        source: { type: 'string', description: 'Ruta local o URL a reproducir' },
        type: { type: 'string', description: 'Tipo: "audio" o "video"' }
      }
    },
    stop_media: {
      description: 'Detiene cualquier reproducción de audio o video que esté activa.',
      parameters: {}
    }
  },
  handlers: {
    execute_command: async (args, context) => {
      const sessionId = context ? context.sessionId : null;
      const result = await executeCommand(args.command, 120000, sessionId);
      return `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}\nCódigo de salida: ${result.exitCode}`;
    },
    read_file: async (args) => {
      try {
        const content = fs.readFileSync(args.path, 'utf8');
        return content.slice(0, 4000);
      } catch (e) {
        return `Error leyendo archivo: ${e.message}`;
      }
    },
    write_file: async (args) => {
      try {
        const dir = path.dirname(args.path);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(args.path, args.content, 'utf8');
        return `✅ Archivo creado: ${args.path} (${args.content.length} chars)`;
      } catch (e) {
        return `Error escribiendo archivo: ${e.message}`;
      }
    },
    step_update: async (args, context) => {
      if (context.onToolCall) context.onToolCall({ type: 'step_update', message: args.message });
      return 'Mensaje de actualización enviado.';
    },
    open_in_brave: async (args) => {
      const url = args.url || 'https://google.com';
      const validUrl = url.startsWith('http') ? url : `https://${url}`;
      return new Promise((resolve) => {
        const cmd = `bash -c 'export DISPLAY=:0; if command -v brave-browser >/dev/null 2>&1; then nohup brave-browser "${validUrl}" >/dev/null 2>&1 & elif command -v brave >/dev/null 2>&1; then nohup brave "${validUrl}" >/dev/null 2>&1 & else nohup xdg-open "${validUrl}" >/dev/null 2>&1 & fi'`;
        exec(cmd, (err) => {
          if (err) resolve(`No se pudo abrir Brave: ${err.message}`);
          else resolve(`✅ Brave abierto buscando: ${validUrl}`);
        });
      });
    },
    play_media: async (args) => {
      const { source, type } = args;
      if (!source) return 'Faltan datos';
      exec('pkill mpv 2>/dev/null; pkill vlc 2>/dev/null', () => {});
      const noVideoFlag = type === 'audio' ? '--no-video' : '';
      const mpvCmd = `nohup mpv ${noVideoFlag} "${source}" > /tmp/mpv.log 2>&1 &`;
      return new Promise((resolve) => {
        exec(mpvCmd, (err) => {
          if (err) resolve(`Error iniciando mpv: ${err.message}`);
          else resolve(`▶ Reproduciendo: ${source}`);
        });
      });
    },
    stop_media: async () => {
      return new Promise((resolve) => {
        exec('pkill mpv; pkill vlc; pkill mplayer', () => resolve('⏹ Detenido.'));
      });
    }
  }
};
