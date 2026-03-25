const whatsapp = require('../whatsapp');
const messenger = require('../messenger');

module.exports = {
  definitions: {
    messaging_send: {
      description: 'Envía un mensaje por WhatsApp o Messenger.',
      parameters: {
        platform: { type: 'string', description: '"whatsapp" o "messenger"' },
        to: { type: 'string', description: 'Número o URL' },
        message: { type: 'string', description: 'Texto' }
      }
    },
    messaging_status: {
      description: 'Consulta el estado de conexión de mensajería.',
      parameters: {}
    },
    messaging_get_chats: {
      description: 'Lista los chats abiertos.',
      parameters: {
        platform: { type: 'string', description: '"whatsapp", "messenger" o "all"' }
      }
    }
  },
  handlers: {
    messaging_send: async (args) => {
      const { platform, to, message } = args;
      if (platform === 'whatsapp') {
        const status = whatsapp.getStatus();
        if (status.status !== 'ready') return 'WhatsApp no conectado.';
        await whatsapp.sendMessage(to, message);
        return 'Enviado.';
      } else if (platform === 'messenger') {
        const status = messenger.getStatus();
        if (status.status !== 'ready') return 'Messenger no conectado.';
        await messenger.sendMessage(to, message);
        return 'Enviado.';
      }
      return 'Plataforma inválida.';
    },
    messaging_status: async () => {
      const wa = whatsapp.getStatus();
      const fb = messenger.getStatus();
      return `WA: ${wa.status}, FB: ${fb.status}`;
    },
    messaging_get_chats: async (args) => {
      let res = '';
      if (args.platform === 'whatsapp' || args.platform === 'all') {
        const chats = await whatsapp.getChats();
        res += `WA: ${chats.map(c => c.id).join(', ')}\n`;
      }
      if (args.platform === 'messenger' || args.platform === 'all') {
        const chats = await messenger.getChats();
        res += `FB: ${chats.map(c => c.name).join(', ')}\n`;
      }
      return res || 'Sin chats.';
    }
  }
};
