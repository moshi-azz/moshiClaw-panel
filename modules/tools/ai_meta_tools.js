const canva = require('../canva');
const skillsModule = require('../skills');
const fetch = require('node-fetch');

module.exports = {
  definitions: {
    read_skill: {
      description: 'Lee el contenido de un skill especializado.',
      parameters: {
        id: { type: 'string', description: 'ID del skill' }
      }
    },
    generate_image: {
      description: 'Genera una imagen a partir de texto.',
      parameters: {
        prompt: { type: 'string', description: 'Descripción' }
      }
    },
    canva_status: {
      description: 'Verifica conexión a Canva.',
      parameters: {}
    },
    canva_list_designs: {
      description: 'Lista diseños de Canva.',
      parameters: {
        query: { type: 'string', description: 'Filtro' },
        limit: { type: 'string', description: 'Máximo' }
      }
    },
    canva_create_design: {
      description: 'Crea diseño en Canva.',
      parameters: {
        design_type: { type: 'string', description: 'Tipo' },
        title: { type: 'string', description: 'Título' }
      }
    },
    canva_export_design: {
      description: 'Exporta diseño de Canva.',
      parameters: {
        design_id: { type: 'string', description: 'ID' },
        format: { type: 'string', description: 'PDF, PNG, etc' }
      }
    },
    deploy_subagent: {
      description: 'Despliega un sub-agente autónomo.',
      parameters: {
        task: { type: 'string', description: 'Tarea' },
        name: { type: 'string', description: 'Nombre' }
      }
    }
  },
  handlers: {
    read_skill: async (args) => {
      const sid = args.id || args.skill_id;
      const content = skillsModule.getSkillContent(sid);
      if (!content) return `Skill ${sid} no encontrado.`;
      return `SKILL CARGADO: ${sid}\n\n${content}`;
    },
    generate_image: async (args, context) => {
      const apiKey = context.apiKey || process.env.GEMINI_API_KEY;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: args.prompt }] }] })
        });
        const data = await response.json();
        if (data.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
          const b64 = data.candidates[0].content.parts[0].inlineData.data;
          return `![Imagen](data:image/jpeg;base64,${b64})`;
        }
        return 'No se generó imagen.';
      } catch (e) { return 'Error de API.'; }
    },
    canva_status: async () => {
      if (!canva.isConnected()) return 'No conectado.';
      const profile = await canva.getProfile();
      return `Conectado como ${profile.user?.display_name || 'usuario'}`;
    },
    canva_list_designs: async (args) => {
      if (!canva.isConnected()) return 'No conectado.';
      const resp = await canva.getFolders();
      let items = resp.items || [];
      if (args.query) items = items.filter(i => (i.title || i.name).toLowerCase().includes(args.query.toLowerCase()));
      return items.slice(0, args.limit || 20).map(i => `- [${i.id}] ${i.title || i.name}`).join('\n');
    },
    canva_create_design: async (args) => {
      if (!canva.isConnected()) return 'No conectado.';
      const res = await canva.createDesign(args.design_type, args.title);
      return `Creado: ${res.design.urls.edit_url}`;
    },
    canva_export_design: async (args) => {
      if (!canva.isConnected()) return 'No conectado.';
      const res = await canva.exportDesign(args.design_id, args.format || 'pdf');
      return `Exportación iniciada (Job: ${res.job.id})`;
    },
    deploy_subagent: async (args, context) => {
      if (context.onToolCall) context.onToolCall({ type: 'step_update', message: `🚀 Sub-agente: ${args.name}...` });
      return `✅ Desplegado.`;
    }
  }
};
