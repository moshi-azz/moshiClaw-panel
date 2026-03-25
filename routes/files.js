const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const files = require('../modules/files');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
      try {
          const base = '/home/moshi';
          const p = (req.body.path || '').replace(/^\/+/, '');
          const target = path.resolve(base, p);
          if (!target.startsWith(path.resolve(base))) throw new Error("Acción denegada");
          cb(null, target);
      } catch (err) {
          cb(err);
      }
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage: storage });

router.get('/list', async (req, res) => {
    try {
        const items = await files.listFiles(req.query.path || '/');
        res.json({ success: true, items });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/download', (req, res) => {
    try {
        const target = files.getDownloadPath(req.query.path);
        res.download(target);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

router.get('/preview', (req, res) => {
    try {
        const target = files.getDownloadPath(req.query.path);
        res.sendFile(target);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

router.post('/upload', upload.array('files'), (req, res) => {
    res.json({ success: true, message: "Archivos subidos correctamente." });
});

router.post('/rename', async (req, res) => {
    try {
        await files.renameFile(req.body.path, req.body.newName);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/delete', async (req, res) => {
    try {
         await files.deleteFileOrFolder(req.body.path);
         res.json({ success: true });
    } catch(err) {
         res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
