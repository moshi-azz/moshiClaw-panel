const browser = require('../browser');

module.exports = {
  definitions: {
    browser_navigate: {
      description: 'Abre una URL en el navegador controlado.',
      parameters: {
        url: { type: 'string', description: 'URL completa a navegar' }
      }
    },
    browser_get_content: {
      description: 'Obtiene el texto visible de la página actual del navegador.',
      parameters: {}
    },
    browser_screenshot: {
      description: 'Toma una captura de pantalla del navegador.',
      parameters: {}
    },
    browser_click: {
      description: 'Hace clic en un elemento de la página usando un selector CSS.',
      parameters: {
        selector: { type: 'string', description: 'Selector CSS' }
      }
    },
    browser_scroll: {
      description: 'Desplaza la página del navegador.',
      parameters: {
        direction: { type: 'string', description: '"up" o "down"' },
        amount: { type: 'string', description: '"small", "medium" o "large"' }
      }
    }
  },
  handlers: {
    browser_navigate: async (args, context) => {
      const res = await browser.navigate(args.url);
      const img = await browser.screenshot();
      if (img && context.onToolCall) context.onToolCall({ type: 'browser_screenshot', image: img });
      return res.error ? `Error: ${res.error}` : `Navegando a: ${res.url}`;
    },
    browser_get_content: async () => {
      return await browser.getContent();
    },
    browser_screenshot: async (args, context) => {
      const img = await browser.screenshot();
      if (!img) return 'No se pudo tomar screenshot.';
      if (context.onToolCall) context.onToolCall({ type: 'browser_screenshot', image: img });
      return 'Screenshot enviado.';
    },
    browser_click: async (args, context) => {
      const result = await browser.click(args.selector);
      const img = await browser.screenshot();
      if (img && context.onToolCall) context.onToolCall({ type: 'browser_screenshot', image: img });
      return result;
    },
    browser_scroll: async (args, context) => {
      const amountMap = { small: 300, medium: 600, large: 1200 };
      const delta = (args.direction === 'up' ? -1 : 1) * (amountMap[args.amount] || 600);
      await browser.scroll(delta);
      const img = await browser.screenshot();
      if (img && context.onToolCall) context.onToolCall({ type: 'browser_screenshot', image: img });
      return `Scroll ${args.direction} ${Math.abs(delta)}px.`;
    }
  }
};
