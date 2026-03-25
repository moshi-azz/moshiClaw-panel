const express = require('express');
const router = express.Router();
const monitoring = require('../modules/monitoring');
const statsHistory = require('../modules/stats_history');
const screen = require('../modules/screen');
const webcam = require('../modules/webcam');

router.get('/stats', async (req, res) => {
  const stats = await monitoring.getStats();
  if (stats) res.json(stats);
  else res.status(500).json({ error: 'Error obteniendo estadísticas' });
});

router.get('/stats/history', (req, res) => {
  res.json({ history: statsHistory.getHistory() });
});

router.get('/processes', async (req, res) => {
  const procs = await monitoring.getProcesses();
  res.json({ processes: procs });
});

router.post('/processes/kill', (req, res) => {
  const { pid } = req.body;
  if (!pid || isNaN(parseInt(pid))) {
    return res.status(400).json({ error: 'PID inválido' });
  }
  const { exec } = require('child_process');
  const targetPid = parseInt(pid);

  exec(`ps -o pgid= -p ${targetPid} 2>/dev/null`, (pgidErr, pgidOut) => {
    const pgid = parseInt(pgidOut.trim()) || targetPid;
    const killGroupCmd = pgid > 1
      ? `kill -TERM -${pgid} 2>/dev/null || kill -TERM ${targetPid}`
      : `kill -TERM ${targetPid}`;

    exec(killGroupCmd, (err) => {
      if (err) {
        exec(`kill -KILL ${targetPid} 2>/dev/null || sudo kill -KILL ${targetPid}`, (err2) => {
          if (err2) return res.status(500).json({ success: false, error: err2.message });
          res.json({ success: true, message: `Proceso ${targetPid} terminado (KILL).` });
        });
        return;
      }
      res.json({ success: true, message: `Proceso ${targetPid} y su grupo terminados.` });
    });
  });
});

router.post('/system/:action', (req, res) => {
  const { action } = req.params;
  const { exec } = require('child_process');
  
  let cmd = '';
  let msg = '';

  if (action === 'reboot') {
    cmd = 'sudo reboot';
    msg = 'Reiniciando el sistema...';
  } else if (action === 'shutdown') {
    cmd = 'sudo shutdown -h now';
    msg = 'Apagando el sistema...';
  } else if (action === 'cleanup') {
    cmd = 'sudo rm -rf /tmp/* && sudo apt-get clean';
    msg = 'Limpieza de temporales completada.';
  } else {
    return res.status(400).json({ error: 'Acción no reconocida' });
  }

  console.log(`⚠️  SYSTEM ACTION: ${action} by authorized user`);
  
  exec(cmd, (err, stdout, stderr) => {
    if (action === 'cleanup') {
       if (err) {
           return res.status(500).json({ success: false, error: err.message });
       }
       return res.json({ success: true, message: msg });
    }
  });

  if (action !== 'cleanup') {
    res.json({ success: true, message: msg });
  }
});

router.get('/screenshot', async (req, res) => {
  try {
    const b64 = await screen.takeSnapshot();
    res.json({ image: b64, timestamp: Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/webcam-snap', async (req, res) => {
  try {
    const b64 = await webcam.takeWebcamSnapshot();
    res.json({ image: b64, timestamp: Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
