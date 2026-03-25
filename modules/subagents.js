// modules/subagents.js
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SUBAGENTS_DIR = path.join(__dirname, '../data/subagents');
if (!fs.existsSync(SUBAGENTS_DIR)) fs.mkdirSync(SUBAGENTS_DIR, { recursive: true });

const tasks = new Map();

async function createSubagent(name, taskDescription, parentSessionId, apiKey) {
  const id = uuidv4();
  const task = {
    id,
    name: name || `Agente-${id.slice(0,4)}`,
    description: taskDescription,
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: null,
    parentId: parentSessionId
  };

  tasks.set(id, task);
  saveTask(task);

  // Iniciar ejecución asíncrona (esto es una simplificación, 
  // en un sistema real usaríamos un worker thread o un proceso aparte)
  executeTask(id, apiKey).catch(err => {
    task.status = 'error';
    task.result = err.message;
    saveTask(task);
  });

  return id;
}

async function executeTask(id, apiKey) {
  const task = tasks.get(id);
  if (!task) return;

  const ai = require('./ai'); // Importación circular cuidadosa
  
  try {
    const result = await ai.chat({
      provider: 'gemini',
      apiKey: apiKey,
      model: 'gemini-1.5-flash',
      message: `TAREA AUTÓNOMA: ${task.description}\n\nTerminá tu respuesta con "FIN_DE_TAREA: [resultado final]".`,
      sessionId: `subagent_${id}`,
      autoExecute: true
    });

    task.status = 'completed';
    task.result = result;
    task.updatedAt = new Date().toISOString();
    saveTask(task);
  } catch (err) {
    task.status = 'error';
    task.result = err.message;
    saveTask(task);
    throw err;
  }
}

function saveTask(task) {
  fs.writeFileSync(path.join(SUBAGENTS_DIR, `${task.id}.json`), JSON.stringify(task, null, 2));
}

function getTasks(parentId = null) {
  const allTasks = Array.from(tasks.values());
  if (parentId) return allTasks.filter(t => t.parentId === parentId);
  return allTasks;
}

module.exports = { createSubagent, getTasks };
