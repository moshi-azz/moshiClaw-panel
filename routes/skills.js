const express = require('express');
const router = express.Router();
const skills = require('../modules/skills');

// Listar todos los skills
router.get('/', (req, res) => {
  res.json({ skills: skills.listSkills() });
});

// Obtener contenido raw de un skill
router.get('/:id', (req, res) => {
  const content = skills.getSkillContent(req.params.id);
  if (!content) return res.status(404).json({ error: 'Skill no encontrado' });
  res.json({ content });
});

// Crear o actualizar un skill
router.post('/', (req, res) => {
  const { id, name, description, icon, tags, content } = req.body;
  if (!name) return res.status(400).json({ error: 'name es requerido' });
  try {
    const finalId = skills.createSkill({ id, name, description, icon, tags, content });
    res.json({ success: true, id: finalId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar un skill
router.delete('/:id', (req, res) => {
  const ok = skills.deleteSkill(req.params.id);
  res.json({ success: ok });
});

// Instalar skill desde GitHub
router.post('/install-github', async (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl) return res.status(400).json({ error: 'repoUrl es requerido' });
  try {
    const result = await skills.installFromGitHub(repoUrl);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
