const productivity = require('../productivity');

module.exports = {
  definitions: {
    productivity_email_send: {
      description: 'Envía un correo electrónico.',
      parameters: {
        to: { type: 'string', description: 'Destinatario' },
        subject: { type: 'string', description: 'Asunto' },
        body: { type: 'string', description: 'Cuerpo del mensaje' }
      }
    },
    productivity_calendar_add: {
      description: 'Agrega un evento al calendario.',
      parameters: {
        title: { type: 'string', description: 'Título del evento' },
        startTime: { type: 'string', description: 'Fecha y hora de inicio (ISO 8601)' },
        duration: { type: 'string', description: 'Duración (ej: 1h, 30m)' }
      }
    },
    productivity_calendar_list: {
      description: 'Lista los próximos eventos del calendario.',
      parameters: {}
    }
  },
  handlers: {
    productivity_email_send: async (args, context) => {
      const { to, subject, body } = args;
      const res = productivity.sendEmail(to, subject, body);
      if (context.onToolCall) context.onToolCall({ type: 'step_update', message: `📧 Email enviado a ${to}: ${subject}` });
      return `✅ Email registrado y enviado (ID: ${res.id})`;
    },
    productivity_calendar_add: async (args, context) => {
      const { title, startTime, duration } = args;
      const res = productivity.addCalendarEvent(title, startTime, duration);
      if (context.onToolCall) context.onToolCall({ type: 'step_update', message: `📅 Evento agendado: ${title}` });
      return `✅ Evento "${title}" agendado para el ${startTime}`;
    },
    productivity_calendar_list: async () => {
      const events = productivity.listCalendarEvents();
      if (events.length === 0) return 'No hay eventos agendados.';
      return events.map(e => `- [${e.startTime}] ${e.title} (${e.duration})`).join('\n');
    }
  }
};
