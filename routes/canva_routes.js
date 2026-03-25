const express = require('express');
const router = express.Router();
const canva = require('../modules/canva');

module.exports = function(authMiddleware) {

  // Inicia el flujo OAuth → redirige a Canva
  router.get('/auth/canva', authMiddleware, (req, res) => {
    try {
      const url = canva.getAuthUrl();
      res.redirect(url);
    } catch (e) {
      res.status(500).send(`<pre style="font-family:sans-serif;padding:40px">❌ ${e.message}</pre>`);
    }
  });

  // Callback OAuth — Canva redirige aquí con ?code=...
  router.get('/auth/canva/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error) return res.send(`<script>window.opener?.postMessage({canva:'error',msg:'${error}'},'*');window.close();</script>`);
    if (!code)  return res.status(400).send('Falta el código de autorización');

    try {
      await canva.exchangeCode(code);
      // Cierra la ventana popup y notifica al panel principal
      res.send(`
        <!DOCTYPE html><html><body>
        <p style="font-family:sans-serif;text-align:center;margin-top:80px">
          ✅ <strong>Canva conectado exitosamente.</strong><br>
          <small>Podés cerrar esta ventana.</small>
        </p>
        <script>
          if (window.opener) { window.opener.postMessage({ canva: 'connected' }, '*'); }
          setTimeout(() => window.close(), 2000);
        </script>
        </body></html>
      `);
    } catch (e) {
      res.status(500).send(`Error: ${e.message}`);
    }
  });

  // Estado de conexión
  router.get('/api/canva/status', authMiddleware, async (req, res) => {
    if (!canva.isConnected()) return res.json({ connected: false });
    try {
      const profile = await canva.getProfile();
      res.json({ connected: true, profile: profile.user || profile });
    } catch (e) {
      res.json({ connected: false, error: e.message });
    }
  });

  // Desconectar
  router.post('/api/canva/disconnect', authMiddleware, (req, res) => {
    canva.disconnect();
    res.json({ ok: true });
  });

  // Listar diseños
  router.get('/api/canva/designs', authMiddleware, async (req, res) => {
    try {
      const data = await canva.listDesigns({ query: req.query.q, limit: req.query.limit || 20 });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Crear diseño
  router.post('/api/canva/designs', authMiddleware, async (req, res) => {
    const { design_type, title } = req.body;
    if (!design_type) return res.status(400).json({ error: 'design_type requerido' });
    try {
      const data = await canva.createDesign(design_type, title);
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Exportar diseño
  router.post('/api/canva/export', authMiddleware, async (req, res) => {
    const { design_id, format } = req.body;
    if (!design_id) return res.status(400).json({ error: 'design_id requerido' });
    try {
      const data = await canva.exportDesign(design_id, format || 'pdf');
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
