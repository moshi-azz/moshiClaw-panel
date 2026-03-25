const system = require('./system_tools');
const browser = require('./browser_tools');
const messaging = require('./messaging_tools');
const meta = require('./ai_meta_tools');

const ALL_TOOLS = {
  definitions: {
    ...system.definitions,
    ...browser.definitions,
    ...messaging.definitions,
    ...meta.definitions
  },
  handlers: {
    ...system.handlers,
    ...browser.handlers,
    ...messaging.handlers,
    ...meta.handlers
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

  // Formateador para OpenAI / DeepSeek / Ollama SDK
  getOpenAITools() {
    return Object.entries(this.definitions).map(([name, def]) => ({
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
