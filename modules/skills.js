// modules/skills.js — Gestión de Skills (formato SKILL.md)
// Compatible con el ecosistema de skills de Claude Code, OpenCode, Cursor, Codex, etc.

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os   = require('os');

const SKILLS_DIR = path.join(__dirname, '../data/skills');

function ensureSkillsDir() {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }
}

// ── Parser de frontmatter YAML simple (key: value) ────────────────────────────
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta = {};
  match[1].split('\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      meta[key] = val;
    }
  });
  return { meta, body: match[2].trim() };
}

// ── Sanitizar IDs (sin path traversal) ───────────────────────────────────────
function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
}

// ── Normalizar ID para nombres nuevos ─────────────────────────────────────────
function normalizeId(name) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// ── Listar todos los skills disponibles ───────────────────────────────────────
function listSkills() {
  ensureSkillsDir();
  const skills = [];
  let entries;
  try {
    entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return skills;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    try {
      const raw = fs.readFileSync(skillPath, 'utf8');
      const { meta } = parseFrontmatter(raw);
      skills.push({
        id:          entry.name,
        name:        meta.name        || entry.name,
        description: meta.description || '',
        icon:        meta.icon        || '🧠',
        tags:        meta.tags ? meta.tags.split(',').map(t => t.trim()) : [],
        author:      meta.author      || '',
      });
    } catch {}
  }
  return skills;
}

// ── Obtener contenido completo de un skill ────────────────────────────────────
function getSkillContent(skillId) {
  const id = safeId(skillId);
  const skillPath = path.join(SKILLS_DIR, id, 'SKILL.md');
  if (!fs.existsSync(skillPath)) return null;
  return fs.readFileSync(skillPath, 'utf8');
}

// ── Crear o actualizar un skill ───────────────────────────────────────────────
function createSkill({ id, name, description, icon, tags, content }) {
  ensureSkillsDir();

  const finalId  = id ? safeId(id) : normalizeId(name || 'skill');
  const skillDir = path.join(SKILLS_DIR, finalId);
  fs.mkdirSync(skillDir, { recursive: true });

  const fm = [
    '---',
    `name: ${(name || finalId).replace(/\n/g, ' ')}`,
    `description: ${(description || '').replace(/\n/g, ' ')}`,
    `icon: ${icon || '🧠'}`,
    tags ? `tags: ${Array.isArray(tags) ? tags.join(', ') : tags}` : null,
    '---',
    '',
  ].filter(l => l !== null).join('\n');

  fs.writeFileSync(path.join(SKILLS_DIR, finalId, 'SKILL.md'), fm + '\n' + (content || ''), 'utf8');
  return finalId;
}

// ── Eliminar un skill ─────────────────────────────────────────────────────────
function deleteSkill(skillId) {
  const id = safeId(skillId);
  const skillDir = path.join(SKILLS_DIR, id);
  if (!fs.existsSync(skillDir)) return false;
  fs.rmSync(skillDir, { recursive: true, force: true });
  return true;
}

// ── Instalador desde GitHub ────────────────────────────────────────────────────
// Soporta repos con uno o múltiples SKILL.md, maneja symlinks, parchea rutas absolutas.
async function installFromGitHub(repoUrl) {
  ensureSkillsDir();

  // Normalizar URL: aceptar https://github.com/user/repo o github.com/user/repo
  const raw = repoUrl.replace(/^git\+/, '').trim();
  const ghMatch = raw.match(/(?:https?:\/\/)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/);
  if (!ghMatch) throw new Error('URL inválida. Formato: https://github.com/usuario/repo');

  const [, owner, repoName] = ghMatch;
  const cloneUrl = `https://github.com/${owner}/${repoName}.git`;
  const tempDir  = path.join(os.tmpdir(), `moshiclaw-skill-${Date.now()}`);

  try {
    // ── 1. Clonar shallow ─────────────────────────────────────────────────────
    execSync(`git clone --depth 1 "${cloneUrl}" "${tempDir}"`, {
      timeout: 90000,
      stdio: 'pipe',
    });

    // ── 2. Encontrar todos los SKILL.md (siguiendo symlinks) ──────────────────
    let findOut = '';
    try {
      findOut = execSync(
        `find -L "${tempDir}" -name "SKILL.md" -not -path "*/node_modules/*" -not -path "*/.git/*"`,
        { encoding: 'utf8', timeout: 15000 }
      );
    } catch {}

    const rawPaths = findOut.trim().split('\n').filter(Boolean);

    // Deduplicar por ruta real (los symlinks pueden apuntar al mismo archivo)
    const seenReal = new Set();
    const uniquePaths = [];
    for (const p of rawPaths) {
      try {
        const real = fs.realpathSync(p);
        if (!seenReal.has(real)) { seenReal.add(real); uniquePaths.push(p); }
      } catch { uniquePaths.push(p); }
    }

    if (uniquePaths.length === 0) {
      throw new Error('No se encontró ningún SKILL.md en el repositorio. Verificá que sea un repo de skills compatible.');
    }

    // ── 3. Instalar cada skill encontrado ──────────────────────────────────────
    const installed = [];
    const skipped   = [];

    for (const skillMdPath of uniquePaths) {
      try {
        // Resolver el directorio real del skill (siguiendo symlinks)
        const linkDir  = path.dirname(skillMdPath);
        const realDir  = (() => { try { return fs.realpathSync(linkDir); } catch { return linkDir; } })();

        // Leer frontmatter para obtener nombre/id canónico
        const rawContent = fs.readFileSync(skillMdPath, 'utf8');
        const { meta }   = parseFrontmatter(rawContent);

        // Determinar ID: preferir campo 'name' del frontmatter, luego nombre del directorio
        const rawName    = (meta.name || path.basename(realDir)).replace(/^ckm:/, '');
        const skillId    = normalizeId(rawName) || normalizeId(repoName);
        const destDir    = path.join(SKILLS_DIR, skillId);

        // Copiar el directorio real dereferenciando symlinks (-rL)
        if (fs.existsSync(destDir)) {
          execSync(`rm -rf "${destDir}"`, { stdio: 'pipe' });
        }
        execSync(`cp -rL "${realDir}" "${destDir}"`, { stdio: 'pipe', timeout: 30000 });

        // ── Parchear SKILL.md: inyectar BASE_DIR y ajustar rutas relativas ────
        const destSkillMd = path.join(destDir, 'SKILL.md');
        if (fs.existsSync(destSkillMd)) {
          let content = fs.readFileSync(destSkillMd, 'utf8');

          // Nota de instalación con ruta absoluta (va después del frontmatter)
          const installNote =
            `\n<!-- MOSHICLAW_INSTALL: BASE_DIR=${destDir} -->\n` +
            `> ⚙️ **Skill instalado en:** \`${destDir}\`  \n` +
            `> Para ejecutar scripts usá la ruta absoluta: \`${destDir}/scripts/\`\n\n`;

          // Insertar nota después del bloque frontmatter ---
          content = content.replace(/^(---[\s\S]*?---\s*\n)/, `$1${installNote}`);

          // Reemplazar rutas relativas comunes por absolutas
          // Patrón: python3 skills/<name>/ o python3 src/<name>/
          const relPatterns = [
            /python3\s+skills\/[^/\s]+\//g,
            /python3\s+src\/[^/\s]+\//g,
            new RegExp(`python3\\s+${escapeRegex(path.basename(realDir))}\\/`, 'g'),
          ];
          for (const pat of relPatterns) {
            content = content.replace(pat, `python3 ${destDir}/`);
          }

          fs.writeFileSync(destSkillMd, content, 'utf8');
        }

        // Si no tiene frontmatter con icon, agregar uno por defecto
        const finalMeta = parseFrontmatter(fs.readFileSync(destSkillMd, 'utf8')).meta;
        installed.push({
          id:          skillId,
          name:        finalMeta.name || skillId,
          icon:        finalMeta.icon || '📦',
          description: (finalMeta.description || '').slice(0, 100),
        });
      } catch (e) {
        skipped.push({ path: skillMdPath, error: e.message });
      }
    }

    return { success: true, installed, skipped, total: uniquePaths.length };

  } finally {
    // Limpiar directorio temporal
    try { execSync(`rm -rf "${tempDir}"`, { stdio: 'pipe' }); } catch {}
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  listSkills,
  getSkillContent,
  createSkill,
  deleteSkill,
  installFromGitHub,
  SKILLS_DIR,
};
