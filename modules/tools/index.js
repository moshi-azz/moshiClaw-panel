const gui = require('./gui_tools');
const productivity = require('./productivity_tools');

const ALL_TOOLS = {
  definitions: {
    ...system.definitions,
    ...browser.definitions,
    ...messaging.definitions,
    ...meta.definitions,
    ...gui.definitions,
    ...productivity.definitions
  },
  handlers: {
    ...system.handlers,
    ...browser.handlers,
    ...messaging.handlers,
    ...meta.handlers,
    ...gui.handlers,
    ...productivity.handlers
  },

  // Formateador para Gemini SDK
  getGeminiTools() {
    return Object.entries(this.definitions).map(([name, def]) => ({
      name,
      description: def.description,
      parameters: {
        type: 'object',
        properties: def.parameters,
        required: Object.keys(def.parameters)
      }
    }));
  },

  // Formateador para OpenAI / DeepSeek / Ollama SDK (LITE)
  // Solo incluye herramientas de sistema esenciales para mejorar performance en modelos locales
  getLiteOpenAITools() {
    const essential = ['execute_command', 'read_file', 'write_file', 'step_update', 'browser_navigate', 'browser_get_content', 'browser_screenshot'];
    return Object.entries(this.definitions)
      .filter(([name]) => essential.includes(name))
      .map(([name, def]) => ({
        type: 'function',
        function: {
          name,
          description: def.description,
          parameters: {
            type: 'object',
            properties: def.parameters,
            required: Object.keys(def.parameters)
          }
        }
      }));
  },

  // Formateador para OpenAI / DeepSeek / Ollama SDK (FULL)
  getOpenAITools() {
    return Object.entries(this.definitions)
      .map(([name, def]) => ({
        type: 'function',
        function: {
          name,
          description: def.description,
          parameters: {
            type: 'object',
            properties: def.parameters,
            required: Object.keys(def.parameters)
          }
        }
      }));
  }
};

module.exports = ALL_TOOLS;
