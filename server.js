require('dotenv').config();
const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_CODE = process.env.ADMIN_CODE || 'Paul123';

// ---------- Dossiers & fichiers de données ----------
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const GAME_DIR = path.join(UPLOADS_DIR, 'game');
const MUSIC_DIR = path.join(UPLOADS_DIR, 'music');

const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');
const MUSIC_FILE = path.join(DATA_DIR, 'music.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

[DATA_DIR, UPLOADS_DIR, GAME_DIR, MUSIC_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------- Middlewares ----------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads/music', express.static(MUSIC_DIR)); // pour lire les musiques dans le navigateur

function checkAdmin(req, res, next) {
  const code = req.headers['x-admin-code'];
  const ip = getClientIp(req);

  const lockStatus = getLockStatus(ip);
  if (lockStatus.locked) {
    return res.status(429).json({
      error: `Trop de tentatives. Réessayez dans ${formatMinutes(lockStatus.remainingMs)} minute(s).`
    });
  }

  if (code && code === ADMIN_CODE) {
    registerSuccess(ip);
    return next();
  }

  const entry = registerFailedAttempt(ip);
  if (entry.lockedUntil) {
    return res.status(429).json({
      error: `Code incorrect. Trop de tentatives : réessayez dans ${formatMinutes(LOCKOUT_DURATION_MS)} minutes.`
    });
  }
  return res.status(401).json({ error: 'Code administrateur invalide.' });
}

// ---------- Upload configuration (multer) ----------
const gameStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, GAME_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'vestiges-jeu' + ext);
  }
});
const uploadGame = multer({ storage: gameStorage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }); // 2 Go max

const musicStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MUSIC_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  }
});
const uploadMusic = multer({ storage: musicStorage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50 Mo max

// ---------- Nodemailer (envoi de réponses par e-mail) ----------
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE !== 'false',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

// ---------- Protection contre les tentatives répétées sur le code admin ----------
const MAX_LOGIN_ATTEMPTS = 3;
const LOCKOUT_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const loginAttempts = new Map(); // ip -> { count, lockedUntil }

function getClientIp(req) {
  return req.ip || req.connection.remoteAddress || 'unknown';
}

function formatMinutes(ms) {
  return Math.ceil(ms / 60000);
}

function getLockStatus(ip) {
  const entry = loginAttempts.get(ip);
  const now = Date.now();
  if (entry && entry.lockedUntil > now) {
    return { locked: true, remainingMs: entry.lockedUntil - now };
  }
  return { locked: false };
}

function registerFailedAttempt(ip) {
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  // Pas d'entrée, ou verrouillage précédent expiré : on repart d'un compteur propre
  if (!entry || (entry.lockedUntil && entry.lockedUntil <= now)) {
    entry = { count: 0, lockedUntil: 0 };
  }
  entry.count += 1;
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS;
  }
  loginAttempts.set(ip, entry);
  return entry;
}

function registerSuccess(ip) {
  loginAttempts.delete(ip);
}

// =========================================================
//                  ROUTES PUBLIQUES
// =========================================================

// --- Contact : envoyer un message au développeur ---
app.post('/api/contact', (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Nom, e-mail et message sont requis.' });
  }
  const messages = readJSON(MESSAGES_FILE, []);
  const newMessage = {
    id: Date.now().toString(),
    name: String(name).slice(0, 100),
    email: String(email).slice(0, 200),
    message: String(message).slice(0, 3000),
    date: new Date().toISOString(),
    replied: false,
    reply: null
  };
  messages.unshift(newMessage);
  writeJSON(MESSAGES_FILE, messages);
  res.json({ success: true });
});

// --- Commentaires : lire ---
app.get('/api/comments', (req, res) => {
  const comments = readJSON(COMMENTS_FILE, []);
  res.json(comments);
});

// --- Commentaires : ajouter ---
app.post('/api/comments', (req, res) => {
  const { name, comment } = req.body;
  if (!name || !comment) {
    return res.status(400).json({ error: 'Nom et commentaire sont requis.' });
  }
  const comments = readJSON(COMMENTS_FILE, []);
  const newComment = {
    id: Date.now().toString(),
    name: String(name).slice(0, 60),
    comment: String(comment).slice(0, 1000),
    date: new Date().toISOString()
  };
  comments.unshift(newComment);
  writeJSON(COMMENTS_FILE, comments);
  res.json({ success: true, comment: newComment });
});

// --- Musique : liste des morceaux disponibles ---
app.get('/api/music', (req, res) => {
  const music = readJSON(MUSIC_FILE, []);
  res.json(music);
});

// --- Téléchargement du jeu ---
app.get('/api/download', (req, res) => {
  const settings = readJSON(SETTINGS_FILE, {});
  if (!settings.gameFile) {
    return res.status(404).json({ error: "Aucun fichier n'a encore été mis en ligne." });
  }
  const filePath = path.join(GAME_DIR, settings.gameFile);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Fichier introuvable sur le serveur.' });
  }
  res.download(filePath, settings.gameFileOriginalName || settings.gameFile);
});

// --- Info sur le fichier du jeu actuellement disponible ---
app.get('/api/game-info', (req, res) => {
  const settings = readJSON(SETTINGS_FILE, {});
  res.json({
    available: !!settings.gameFile,
    name: settings.gameFileOriginalName || null
  });
});

// =========================================================
//                  ROUTES ADMIN (protégées)
// =========================================================

// --- Vérifier le code admin ---
app.post('/api/admin/login', (req, res) => {
  const { code } = req.body;
  const ip = getClientIp(req);

  const lockStatus = getLockStatus(ip);
  if (lockStatus.locked) {
    return res.status(429).json({
      error: `Trop de tentatives. Réessayez dans ${formatMinutes(lockStatus.remainingMs)} minute(s).`
    });
  }

  if (code === ADMIN_CODE) {
    registerSuccess(ip);
    return res.json({ success: true });
  }

  const entry = registerFailedAttempt(ip);
  if (entry.lockedUntil) {
    return res.status(429).json({
      error: `Code incorrect. Trop de tentatives : réessayez dans ${formatMinutes(LOCKOUT_DURATION_MS)} minutes.`
    });
  }
  const remaining = MAX_LOGIN_ATTEMPTS - entry.count;
  res.status(401).json({ error: `Code incorrect. ${remaining} tentative(s) restante(s).` });
});

// --- Voir tous les messages reçus ---
app.get('/api/admin/messages', checkAdmin, (req, res) => {
  const messages = readJSON(MESSAGES_FILE, []);
  res.json(messages);
});

// --- Répondre à un message par e-mail ---
app.post('/api/admin/reply', checkAdmin, async (req, res) => {
  const { id, to, subject, body } = req.body;
  if (!to || !body) {
    return res.status(400).json({ error: 'Destinataire et texte de réponse requis.' });
  }
  if (!transporter) {
    return res.status(500).json({
      error: "L'envoi d'e-mails n'est pas configuré. Renseignez SMTP_HOST, SMTP_USER et SMTP_PASS dans le fichier .env."
    });
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: subject || 'Réponse - Vestiges',
      text: body
    });
    if (id) {
      const messages = readJSON(MESSAGES_FILE, []);
      const idx = messages.findIndex(m => m.id === id);
      if (idx !== -1) {
        messages[idx].replied = true;
        messages[idx].reply = body;
        writeJSON(MESSAGES_FILE, messages);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Échec de l'envoi de l'e-mail : " + err.message });
  }
});

// --- Supprimer un message ---
app.delete('/api/admin/messages/:id', checkAdmin, (req, res) => {
  let messages = readJSON(MESSAGES_FILE, []);
  messages = messages.filter(m => m.id !== req.params.id);
  writeJSON(MESSAGES_FILE, messages);
  res.json({ success: true });
});

// --- Envoyer / remplacer le fichier téléchargeable du jeu ---
app.post('/api/admin/upload-game', checkAdmin, uploadGame.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
  const settings = readJSON(SETTINGS_FILE, {});
  settings.gameFile = req.file.filename;
  settings.gameFileOriginalName = req.file.originalname;
  writeJSON(SETTINGS_FILE, settings);
  res.json({ success: true, name: req.file.originalname });
});

// --- Supprimer le fichier du jeu ---
app.delete('/api/admin/game-file', checkAdmin, (req, res) => {
  const settings = readJSON(SETTINGS_FILE, {});
  if (settings.gameFile) {
    const filePath = path.join(GAME_DIR, settings.gameFile);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  settings.gameFile = null;
  settings.gameFileOriginalName = null;
  writeJSON(SETTINGS_FILE, settings);
  res.json({ success: true });
});

// --- Envoyer une musique ---
app.post('/api/admin/upload-music', checkAdmin, uploadMusic.single('music'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier audio reçu.' });
  const title = req.body.title || req.file.originalname.replace(/\.[^/.]+$/, '');
  const music = readJSON(MUSIC_FILE, []);
  const track = {
    id: Date.now().toString(),
    title,
    filename: req.file.filename,
    url: '/uploads/music/' + req.file.filename
  };
  music.push(track);
  writeJSON(MUSIC_FILE, music);
  res.json({ success: true, track });
});

// --- Supprimer une musique ---
app.delete('/api/admin/music/:id', checkAdmin, (req, res) => {
  let music = readJSON(MUSIC_FILE, []);
  const track = music.find(m => m.id === req.params.id);
  if (track) {
    const filePath = path.join(MUSIC_DIR, track.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  music = music.filter(m => m.id !== req.params.id);
  writeJSON(MUSIC_FILE, music);
  res.json({ success: true });
});

// --- Supprimer un commentaire (modération) ---
app.delete('/api/admin/comments/:id', checkAdmin, (req, res) => {
  let comments = readJSON(COMMENTS_FILE, []);
  comments = comments.filter(c => c.id !== req.params.id);
  writeJSON(COMMENTS_FILE, comments);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n  Vestiges — le serveur tourne sur http://localhost:${PORT}\n`);
  if (!transporter) {
    console.log('  ⚠️  Envoi d\'e-mails non configuré : renseignez le fichier .env pour activer les réponses par mail.\n');
  }
});
