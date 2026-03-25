const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_PATH = path.join(__dirname, '../../public/screenshots');
if (!fs.existsSync(SCREENSHOT_PATH)) fs.mkdirSync(SCREENSHOT_PATH, { recursive: true });

module.exports = {
  definitions: {
    gui_screenshot: {
      description: 'Captura una imagen de la pantalla actual del escritorio.',
      parameters: {}
    },
    gui_click: {
      description: 'Hace clic en las coordenadas especificas (X, Y).',
      parameters: {
        x: { type: 'number', description: 'Coordenada X' },
        y: { type: 'number', description: 'Coordenada Y' },
        button: { type: 'number', description: 'Botón (1=izq, 2=medio, 3=der)', default: 1 }
      }
    },
    gui_type: {
      description: 'Escribe el texto especificado en la ventana activa.',
      parameters: {
        text: { type: 'string', description: 'Texto a escribir' }
      }
    },
    gui_move: {
      description: 'Mueve el puntero del mouse a las coordenadas (X, Y).',
      parameters: {
        x: { type: 'number', description: 'Coordenada X' },
        y: { type: 'number', description: 'Coordenada Y' }
      }
    },
    gui_get_resolution: {
      description: 'Obtiene la resolución actual de la pantalla.',
      parameters: {}
    }
  },
  handlers: {
    gui_screenshot: async () => {
      const filename = `screen_${Date.now()}.png`;
      const fullPath = path.join(SCREENSHOT_PATH, filename);
      try {
        execSync(`scrot ${fullPath}`);
        // Retornar URL relativa para el frontend si es necesario, 
        // pero para el AI el path absoluto o la confirmación basta.
        return `✅ Screenshot guardada en ${fullPath}`;
      } catch (e) {
        return `❌ Error al capturar: ${e.message}`;
      }
    },
    gui_click: async (args) => {
      try {
        execSync(`xdotool mousemove ${args.x} ${args.y} click ${args.button || 1}`);
        return `✅ Clic en (${args.x}, ${args.y})`;
      } catch (e) {
        return `❌ Error xdotool: ${e.message}`;
      }
    },
    gui_move: async (args) => {
      try {
        execSync(`xdotool mousemove ${args.x} ${args.y}`);
        return `✅ Mouse movido a (${args.x}, ${args.y})`;
      } catch (e) {
        return `❌ Error xdotool: ${e.message}`;
      }
    },
    gui_type: async (args) => {
      try {
        // Escapar caracteres especiales para xdotool type
        execSync(`xdotool type --clearmodifiers "${args.text.replace(/"/g, '\\"')}"`);
        return `✅ Texto escrito.`;
      } catch (e) {
        return `❌ Error xdotool: ${e.message}`;
      }
    },
    gui_get_resolution: async () => {
      try {
        const out = execSync("xrandr | grep '*' | awk '{print $1}'").toString().trim();
        return `Resolución actual: ${out}`;
      } catch (e) {
        return "No se pudo obtener la resolución.";
      }
    }
  }
};
