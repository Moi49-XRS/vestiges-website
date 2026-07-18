require('dotenv').config();
const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_CODE = process.env.ADMIN_CODE || 'V2702#CER';

// Texte des crédits par défaut (utilisé si data/credits.json est vide/absent)
const DEFAULT_CREDITS_TEXT = `Direction du projet — 
Co-direction du projet — 
Partenaire officiel du jeu — Un Meme Par Jour
Site web — 
Scénario — 
Modèles 3D — 
Graphisme — 
Programmation — 
Audio — 
Communication — 
Bêta testeurs — 
Administration — 
Autres — `;

// =========================================================
//   STOCKAGE DES DONNÉES (messages, comptages, réglages...)
//   -> Upstash Redis si configuré (persiste même si Render
//      met le site en veille), sinon fichiers JSON locaux
//      (pratique pour tester en local avec `npm start`).
// =========================================================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USE_UPSTASH = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

async function readJSON(key, fallback) {
  if (USE_UPSTASH) {
    try {
      const res = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
      });
      const data = await res.json();
      return data.result ? JSON.parse(data.result) : fallback;
    } catch (e) {
      console.error('Erreur de lecture Upstash:', e.message);
      return fallback;
    }
  }
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, key + '.json'), 'utf-8'));
  } catch (e) {
    return fallback;
  }
}

async function writeJSON(key, data) {
  if (USE_UPSTASH) {
    await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify(data)
    });
    return;
  }
  fs.writeFileSync(path.join(DATA_DIR, key + '.json'), JSON.stringify(data, null, 2), 'utf-8');
}

// =========================================================
//   STOCKAGE DES FICHIERS (jeu + musiques)
//   -> Backblaze B2 si configuré (persiste même si Render
//      met le site en veille, gratuit, aucune carte requise,
//      bucket privé — tout passe par ce serveur), sinon
//      disque local (pratique pour tester en local).
// =========================================================
const USE_B2 = !!(process.env.B2_ENDPOINT && process.env.B2_ACCESS_KEY_ID && process.env.B2_SECRET_ACCESS_KEY && process.env.B2_BUCKET_NAME);

let s3Client = null;
if (USE_B2) {
  s3Client = new S3Client({
    region: process.env.B2_REGION || 'us-west-004',
    endpoint: process.env.B2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.B2_ACCESS_KEY_ID,
      secretAccessKey: process.env.B2_SECRET_ACCESS_KEY
    }
  });
}

const LOCAL_UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!USE_B2 && !fs.existsSync(LOCAL_UPLOADS_DIR)) fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });

// Envoie un fichier vers B2 (ou le disque local), renvoie sa "clé" (chemin interne)
async function storeFile(buffer, key, contentType) {
  if (USE_B2) {
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.B2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType
    }));
    return key;
  }
  const localPath = path.join(LOCAL_UPLOADS_DIR, key);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, buffer);
  return key;
}

// Supprime un fichier de B2 (ou du disque local)
async function deleteFile(key) {
  if (USE_B2) {
    await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: key }));
    return;
  }
  const localPath = path.join(LOCAL_UPLOADS_DIR, key);
  if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
}

// Lit un fichier (entier ou une plage précise, pour l'écoute audio avec avance/retour)
// depuis B2 ou le disque local, et renvoie un flux prêt à être transmis au visiteur.
async function getFileRange(key, range) {
  if (USE_B2) {
    const params = { Bucket: process.env.B2_BUCKET_NAME, Key: key };
    if (range) params.Range = `bytes=${range.start}-${range.end != null ? range.end : ''}`;
    const result = await s3Client.send(new GetObjectCommand(params));
    const totalSize = result.ContentRange ? Number(result.ContentRange.split('/')[1]) : Number(result.ContentLength);
    return {
      stream: result.Body,
      contentLength: Number(result.ContentLength),
      contentRange: result.ContentRange || null,
      contentType: result.ContentType,
      totalSize
    };
  }
  const localPath = path.join(LOCAL_UPLOADS_DIR, key);
  if (!fs.existsSync(localPath)) throw new Error('Fichier introuvable en local');
  const stat = fs.statSync(localPath);
  const totalSize = stat.size;
  if (range) {
    const end = range.end != null ? Math.min(range.end, totalSize - 1) : totalSize - 1;
    return {
      stream: fs.createReadStream(localPath, { start: range.start, end }),
      contentLength: end - range.start + 1,
      contentRange: `bytes ${range.start}-${end}/${totalSize}`,
      contentType: null,
      totalSize
    };
  }
  return { stream: fs.createReadStream(localPath), contentLength: totalSize, contentRange: null, contentType: null, totalSize };
}

// ---------- Middlewares ----------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

// ---------- Upload configuration (multer, en mémoire pour repartir ensuite vers R2 ou le disque) ----------
const uploadGame = multer({ storage: multer.memoryStorage(), limits: { fileSize: 250 * 1024 * 1024 } }); // 250 Mo max
const uploadMusic = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50 Mo max

// ---------- Nodemailer (envoi de réponses par e-mail en SMTP classique — fonctionne en local) ----------
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

// ---------- Envoi via EmailJS (API HTTP — aucune adresse postale requise à l'inscription) ----------
async function sendViaEmailJS(to, subject, text) {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: process.env.EMAILJS_TEMPLATE_ID,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      accessToken: process.env.EMAILJS_PRIVATE_KEY,
      template_params: {
        to_email: to,
        subject: subject || 'Réponse - Vestiges',
        message: text
      }
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`EmailJS a refusé l'envoi (${res.status}) : ${errText}`);
  }
}

// ---------- Envoi via Brevo (API HTTP — recommandé sur Render, contourne le blocage SMTP) ----------
async function sendViaBrevo(to, subject, text) {
  const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.SMTP_USER;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'api-key': process.env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: 'Vestiges - Développeur' },
      to: [{ email: to }],
      subject: subject || 'Réponse - Vestiges',
      textContent: text
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Brevo a refusé l'envoi (${res.status}) : ${errText}`);
  }
}

// Choisit automatiquement la meilleure méthode disponible pour envoyer un e-mail
async function sendReplyEmail(to, subject, text) {
  if (process.env.EMAILJS_SERVICE_ID) {
    return sendViaEmailJS(to, subject, text);
  }
  if (process.env.BREVO_API_KEY) {
    return sendViaBrevo(to, subject, text);
  }
  if (transporter) {
    return transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: subject || 'Réponse - Vestiges',
      text
    });
  }
  throw new Error(
    "L'envoi d'e-mails n'est pas configuré. Ajoutez EMAILJS_SERVICE_ID (recommandé, sans adresse requise) ou BREVO_API_KEY ou SMTP_HOST/SMTP_USER/SMTP_PASS dans les variables d'environnement."
  );
}

// =========================================================
//                  ROUTES PUBLIQUES
// =========================================================

// --- Contact : envoyer un message au développeur ---
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Nom, e-mail et message sont requis.' });
  }
  const messages = await readJSON('messages', []);
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
  await writeJSON('messages', messages);
  res.json({ success: true });
});

// --- Commentaires : lire ---
app.get('/api/comments', async (req, res) => {
  const comments = await readJSON('comments', []);
  res.json(comments);
});

// --- Commentaires : ajouter ---
app.post('/api/comments', async (req, res) => {
  const { name, comment } = req.body;
  if (!name || !comment) {
    return res.status(400).json({ error: 'Nom et commentaire sont requis.' });
  }
  const comments = await readJSON('comments', []);
  const newComment = {
    id: Date.now().toString(),
    name: String(name).slice(0, 60),
    comment: String(comment).slice(0, 1000),
    date: new Date().toISOString()
  };
  comments.unshift(newComment);
  await writeJSON('comments', comments);
  res.json({ success: true, comment: newComment });
});

// --- Annonces : lire (les plus récentes en premier) ---
app.get('/api/announcements', async (req, res) => {
  const announcements = await readJSON('announcements', []);
  res.json(announcements);
});

// --- Musique : liste des morceaux disponibles ---
app.get('/api/music', async (req, res) => {
  const music = await readJSON('music', []);
  res.json(music);
});

// --- Crédits : lire ---
app.get('/api/credits', async (req, res) => {
  const data = await readJSON('credits', { text: DEFAULT_CREDITS_TEXT });
  res.json({ text: data.text || '' });
});

// --- Nombre d'abonnés de la chaîne WhatsApp (récupéré depuis la page publique, mis en cache) ---
const WHATSAPP_CHANNEL_URL = process.env.WHATSAPP_CHANNEL_URL || 'https://whatsapp.com/channel/0029Vb7ogpi0Vyc9cWOUpb3i';
let whatsappCache = { count: null, fetchedAt: 0 };
const WHATSAPP_CACHE_MS = 10 * 60 * 1000; // 10 minutes

app.get('/api/whatsapp-followers', async (req, res) => {
  const now = Date.now();
  if (whatsappCache.count !== null && now - whatsappCache.fetchedAt < WHATSAPP_CACHE_MS) {
    return res.json({ count: whatsappCache.count, channelUrl: WHATSAPP_CHANNEL_URL });
  }
  try {
    const pageRes = await fetch(WHATSAPP_CHANNEL_URL);
    const html = await pageRes.text();
    const match = html.match(/Channel\s*[•·]\s*([\d.,]+)\s*followers/i);
    if (match) {
      const count = parseInt(match[1].replace(/[.,]/g, ''), 10);
      whatsappCache = { count, fetchedAt: now };
      return res.json({ count, channelUrl: WHATSAPP_CHANNEL_URL });
    }
    throw new Error('Nombre introuvable dans la page');
  } catch (e) {
    // En cas d'échec, on renvoie la dernière valeur connue (même périmée) plutôt que rien
    return res.json({ count: whatsappCache.count, channelUrl: WHATSAPP_CHANNEL_URL });
  }
});

// --- Téléchargement du jeu ---
app.get('/api/download', async (req, res) => {
  const settings = await readJSON('settings', {});
  if (!settings.gameFileKey) {
    return res.status(404).json({ error: "Aucun fichier n'a encore été mis en ligne." });
  }
  try {
    const file = await getFileRange(settings.gameFileKey, null);
    res.setHeader('Content-Disposition', `attachment; filename="${settings.gameFileOriginalName || 'vestiges.zip'}"`);
    res.setHeader('Content-Length', file.contentLength);
    file.stream.pipe(res);
  } catch (e) {
    res.status(404).json({ error: 'Fichier introuvable sur le serveur.' });
  }
});

// --- Écoute d'une musique (avec support de l'avance/retour rapide) ---
app.get('/api/music/:id/stream', async (req, res) => {
  const music = await readJSON('music', []);
  const track = music.find(m => m.id === req.params.id);
  if (!track) return res.status(404).end();
  try {
    let range = null;
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      if (match) range = { start: parseInt(match[1], 10), end: match[2] ? parseInt(match[2], 10) : undefined };
    }
    const file = await getFileRange(track.key, range);
    res.setHeader('Content-Type', track.mimetype || file.contentType || 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', file.contentLength);
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', file.contentRange);
    }
    file.stream.pipe(res);
  } catch (e) {
    res.status(404).end();
  }
});

// --- Info sur le fichier du jeu actuellement disponible ---
app.get('/api/game-info', async (req, res) => {
  const settings = await readJSON('settings', {});
  res.json({
    available: !!settings.gameFileKey,
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
app.get('/api/admin/messages', checkAdmin, async (req, res) => {
  const messages = await readJSON('messages', []);
  res.json(messages);
});

// --- Répondre à un message par e-mail ---
app.post('/api/admin/reply', checkAdmin, async (req, res) => {
  const { id, to, subject, body } = req.body;
  if (!to || !body) {
    return res.status(400).json({ error: 'Destinataire et texte de réponse requis.' });
  }
  try {
    await sendReplyEmail(to, subject, body);
    if (id) {
      const messages = await readJSON('messages', []);
      const idx = messages.findIndex(m => m.id === id);
      if (idx !== -1) {
        messages[idx].replied = true;
        messages[idx].reply = body;
        await writeJSON('messages', messages);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Échec de l'envoi de l'e-mail : " + err.message });
  }
});

// --- Supprimer un message ---
app.delete('/api/admin/messages/:id', checkAdmin, async (req, res) => {
  let messages = await readJSON('messages', []);
  messages = messages.filter(m => m.id !== req.params.id);
  await writeJSON('messages', messages);
  res.json({ success: true });
});

// --- Publier une annonce ---
app.post('/api/admin/announcements', checkAdmin, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Le texte de l'annonce est requis." });
  }
  const announcements = await readJSON('announcements', []);
  const newAnnouncement = {
    id: Date.now().toString(),
    text: String(text).trim().slice(0, 2000),
    date: new Date().toISOString()
  };
  announcements.unshift(newAnnouncement);
  await writeJSON('announcements', announcements);
  res.json({ success: true, announcement: newAnnouncement });
});

// --- Supprimer une annonce ---
app.delete('/api/admin/announcements/:id', checkAdmin, async (req, res) => {
  let announcements = await readJSON('announcements', []);
  announcements = announcements.filter(a => a.id !== req.params.id);
  await writeJSON('announcements', announcements);
  res.json({ success: true });
});

// --- Mettre à jour les crédits ---
app.post('/api/admin/credits', checkAdmin, async (req, res) => {
  const { text } = req.body;
  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'Format de crédits invalide.' });
  }
  const sanitized = text.slice(0, 5000);
  await writeJSON('credits', { text: sanitized });
  res.json({ success: true, text: sanitized });
});

// --- Envoyer / remplacer le fichier téléchargeable du jeu ---
app.post('/api/admin/upload-game', checkAdmin, uploadGame.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
  try {
    const settings = await readJSON('settings', {});
    // Supprime l'ancien fichier s'il y en avait un
    if (settings.gameFileKey) {
      await deleteFile(settings.gameFileKey).catch(() => {});
    }
    const ext = path.extname(req.file.originalname) || '.zip';
    const key = `game/vestiges-jeu-${Date.now()}${ext}`;
    await storeFile(req.file.buffer, key, req.file.mimetype);
    settings.gameFileKey = key;
    settings.gameFileOriginalName = req.file.originalname;
    await writeJSON('settings', settings);
    res.json({ success: true, name: req.file.originalname });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Échec de l'envoi du fichier : " + err.message });
  }
});

// --- Supprimer le fichier du jeu ---
app.delete('/api/admin/game-file', checkAdmin, async (req, res) => {
  const settings = await readJSON('settings', {});
  if (settings.gameFileKey) {
    await deleteFile(settings.gameFileKey).catch(() => {});
  }
  settings.gameFileKey = null;
  settings.gameFileOriginalName = null;
  await writeJSON('settings', settings);
  res.json({ success: true });
});

// --- Envoyer une musique ---
app.post('/api/admin/upload-music', checkAdmin, uploadMusic.single('music'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier audio reçu.' });
  try {
    const title = req.body.title || req.file.originalname.replace(/\.[^/.]+$/, '');
    const ext = path.extname(req.file.originalname) || '.mp3';
    const key = `music/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    await storeFile(req.file.buffer, key, req.file.mimetype);
    const music = await readJSON('music', []);
    const id = Date.now().toString();
    const track = { id, title, key, mimetype: req.file.mimetype, url: `/api/music/${id}/stream` };
    music.push(track);
    await writeJSON('music', music);
    res.json({ success: true, track });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Échec de l'envoi du morceau : " + err.message });
  }
});

// --- Supprimer une musique ---
app.delete('/api/admin/music/:id', checkAdmin, async (req, res) => {
  let music = await readJSON('music', []);
  const track = music.find(m => m.id === req.params.id);
  if (track && track.key) {
    await deleteFile(track.key).catch(() => {});
  }
  music = music.filter(m => m.id !== req.params.id);
  await writeJSON('music', music);
  res.json({ success: true });
});

// --- Supprimer un commentaire (modération) ---
app.delete('/api/admin/comments/:id', checkAdmin, async (req, res) => {
  let comments = await readJSON('comments', []);
  comments = comments.filter(c => c.id !== req.params.id);
  await writeJSON('comments', comments);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n  Vestiges — le serveur tourne sur http://localhost:${PORT}\n`);
  if (!USE_UPSTASH) {
    console.log('  ⚠️  Stockage des données en fichiers JSON locaux (non persistant sur Render). Configurez UPSTASH_REDIS_REST_URL / TOKEN pour un stockage permanent et gratuit.\n');
  }
  if (!USE_B2) {
    console.log('  ⚠️  Stockage des fichiers (jeu/musique) en local (non persistant sur Render). Configurez B2_ENDPOINT / B2_ACCESS_KEY_ID / B2_SECRET_ACCESS_KEY / B2_BUCKET_NAME pour un stockage permanent et gratuit.\n');
  }
  if (!process.env.EMAILJS_SERVICE_ID && !process.env.BREVO_API_KEY && !transporter) {
    console.log('  ⚠️  Envoi d\'e-mails non configuré : renseignez EMAILJS_SERVICE_ID (recommandé) ou BREVO_API_KEY ou SMTP_HOST/SMTP_USER/SMTP_PASS dans le fichier .env.\n');
  }
});
