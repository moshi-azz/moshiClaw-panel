const express = require('express');
const router = express.Router();
const scripts = require('../modules/scripts');

router.get('/', (req, res) => {
  res.json({ scripts: scripts.getScripts() });
});

router.post('/run', async (req, res) => {
  const { id } = req.body;
  try {
    const result = await scripts.runScript(id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/add', (req, res) => {
  const { name, cmd } = req.body;
  if (!name || !cmd) return res.status(400).json({ error: 'Faltan datos' });
  const newScript = scripts.addScript(name, cmd);
  res.json({ success: true, script: newScript });
});

router.delete('/:id', (req, res) => {
  scripts.deleteScript(req.params.id);
  res.json({ success: true });
});

module.exports = router;
