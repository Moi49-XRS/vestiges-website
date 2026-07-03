const loginScreen = document.getElementById('login-screen');
const adminShell = document.getElementById('admin-shell');

function getAdminCode() {
  return sessionStorage.getItem('vestiges_admin_code');
}

function adminFetch(url, options = {}) {
  options.headers = Object.assign({}, options.headers, { 'x-admin-code': getAdminCode() });
  return fetch(url, options);
}

function showDashboard() {
  loginScreen.style.display = 'none';
  adminShell.classList.add('active');
  loadGameFileInfo();
  loadMessages();
  loadMusicList();
  loadAdminComments();
}

function showLogin() {
  loginScreen.style.display = 'flex';
  adminShell.classList.remove('active');
}

// ===================== CONNEXION =====================
document.getElementById('login-btn').addEventListener('click', attemptLogin);
document.getElementById('admin-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptLogin();
});

async function attemptLogin() {
  const code = document.getElementById('admin-code').value;
  const msgEl = document.getElementById('login-msg');
  msgEl.textContent = '';
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Code incorrect.');
    }
    sessionStorage.setItem('vestiges_admin_code', code);
    showDashboard();
  } catch (err) {
    msgEl.textContent = err.message;
  }
}

document.getElementById('logout-btn').addEventListener('click', () => {
  sessionStorage.removeItem('vestiges_admin_code');
  showLogin();
});

// Vérifie si un code est déjà stocké dans la session
if (getAdminCode()) {
  showDashboard();
}

// ===================== NAVIGATION LATÉRALE =====================
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.panel).classList.add('active');
  });
});

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function formatDateTime(iso) {
  return new Date(iso).toLocaleString('fr-FR');
}

// ===================== FICHIER DU JEU =====================
document.getElementById('game-file-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  document.getElementById('game-file-label').textContent = f ? f.name : 'Choisir un fichier…';
});

async function loadGameFileInfo() {
  const res = await fetch('/api/game-info');
  const data = await res.json();
  const el = document.getElementById('current-game-file');
  const deleteBtn = document.getElementById('delete-game-btn');
  el.textContent = data.available ? `Fichier actuellement en ligne : ${data.name}` : 'Aucun fichier en ligne actuellement.';
  deleteBtn.style.display = data.available ? 'inline-flex' : 'none';
}

document.getElementById('delete-game-btn').addEventListener('click', async () => {
  const status = document.getElementById('game-delete-status');
  status.textContent = '';
  status.className = 'status-line';
  if (!confirm('Supprimer définitivement le fichier du jeu en ligne ? Les joueurs ne pourront plus le télécharger.')) return;
  try {
    const res = await adminFetch('/api/admin/game-file', { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    status.textContent = 'Fichier supprimé.';
    status.classList.add('ok');
    document.getElementById('game-upload-status').textContent = '';
    loadGameFileInfo();
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('err');
  }
});

document.getElementById('upload-game-btn').addEventListener('click', async () => {
  const input = document.getElementById('game-file-input');
  const status = document.getElementById('game-upload-status');
  status.textContent = '';
  status.className = 'status-line';
  if (!input.files.length) {
    status.textContent = 'Choisissez un fichier avant de continuer.';
    status.classList.add('err');
    return;
  }
  const formData = new FormData();
  formData.append('file', input.files[0]);
  try {
    const res = await adminFetch('/api/admin/upload-game', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    status.textContent = `Fichier "${data.name}" mis en ligne avec succès.`;
    status.classList.add('ok');
    loadGameFileInfo();
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('err');
  }
});

// ===================== MESSAGES =====================
async function loadMessages() {
  const list = document.getElementById('messages-list');
  try {
    const res = await adminFetch('/api/admin/messages');
    const messages = await res.json();
    if (!messages.length) {
      list.innerHTML = '<div class="empty-state">Aucun message reçu.</div>';
      return;
    }
    list.innerHTML = messages.map(m => `
      <div class="msg-card" data-id="${m.id}">
        <div class="msg-head">
          <span class="name">${escapeHTML(m.name)} — ${escapeHTML(m.email)}</span>
          <span class="badge ${m.replied ? '' : 'pending'}">${m.replied ? 'Répondu' : 'En attente'}</span>
        </div>
        <div style="font-family:var(--font-mono); font-size:0.7rem; color:var(--parchment-dim); margin-bottom:8px;">${formatDateTime(m.date)}</div>
        <p class="body">${escapeHTML(m.message)}</p>
        ${m.replied ? `<p style="font-family:var(--font-mono); font-size:0.78rem; color:var(--verdigris);">Réponse envoyée : « ${escapeHTML(m.reply)} »</p>` : ''}
        <div class="msg-actions">
          <button class="btn btn-ghost btn-toggle-reply">Répondre par e-mail</button>
          <button class="btn btn-danger btn-delete-msg">Supprimer</button>
        </div>
        <div class="reply-box">
          <div class="form-grid">
            <div>
              <label>Sujet</label>
              <input type="text" class="reply-subject" value="Réponse - Vestiges">
            </div>
            <div>
              <label>Votre réponse</label>
              <textarea class="reply-body" placeholder="Écrivez votre réponse ici…"></textarea>
            </div>
            <button class="btn btn-primary btn-send-reply">Envoyer la réponse à ${escapeHTML(m.email)}</button>
            <div class="reply-status status-line"></div>
          </div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.btn-toggle-reply').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.msg-card').querySelector('.reply-box').classList.toggle('open');
      });
    });

    list.querySelectorAll('.btn-delete-msg').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.msg-card');
        const id = card.dataset.id;
        if (!confirm('Supprimer ce message ?')) return;
        await adminFetch('/api/admin/messages/' + id, { method: 'DELETE' });
        loadMessages();
      });
    });

    list.querySelectorAll('.btn-send-reply').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.msg-card');
        const id = card.dataset.id;
        const to = card.querySelector('.msg-head .name').textContent.split('—')[1].trim();
        const subject = card.querySelector('.reply-subject').value;
        const body = card.querySelector('.reply-body').value.trim();
        const statusEl = card.querySelector('.reply-status');
        statusEl.textContent = '';
        statusEl.className = 'reply-status status-line';
        if (!body) {
          statusEl.textContent = 'Écrivez une réponse avant d\'envoyer.';
          statusEl.classList.add('err');
          return;
        }
        try {
          const res = await adminFetch('/api/admin/reply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, to, subject, body })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Erreur');
          statusEl.textContent = 'Réponse envoyée avec succès.';
          statusEl.classList.add('ok');
          loadMessages();
        } catch (err) {
          statusEl.textContent = err.message;
          statusEl.classList.add('err');
        }
      });
    });
  } catch (e) {
    list.innerHTML = '<div class="empty-state">Impossible de charger les messages.</div>';
  }
}

// ===================== MUSIQUE =====================
document.getElementById('music-file-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  document.getElementById('music-file-label').textContent = f ? f.name : 'Choisir un fichier audio…';
});

document.getElementById('upload-music-btn').addEventListener('click', async () => {
  const input = document.getElementById('music-file-input');
  const title = document.getElementById('music-title-input').value.trim();
  const status = document.getElementById('music-upload-status');
  status.textContent = '';
  status.className = 'status-line';
  if (!input.files.length) {
    status.textContent = 'Choisissez un fichier audio avant de continuer.';
    status.classList.add('err');
    return;
  }
  const formData = new FormData();
  formData.append('music', input.files[0]);
  if (title) formData.append('title', title);
  try {
    const res = await adminFetch('/api/admin/upload-music', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    status.textContent = `Morceau "${data.track.title}" ajouté.`;
    status.classList.add('ok');
    document.getElementById('music-title-input').value = '';
    input.value = '';
    document.getElementById('music-file-label').textContent = 'Choisir un fichier audio…';
    loadMusicList();
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('err');
  }
});

async function loadMusicList() {
  const container = document.getElementById('music-list');
  try {
    const res = await adminFetch('/api/music'.replace('/api/music', '/api/music')); // public endpoint, no auth needed
    const music = await (await fetch('/api/music')).json();
    if (!music.length) {
      container.innerHTML = '<div class="empty-state">Aucune musique ajoutée pour le moment.</div>';
      return;
    }
    container.innerHTML = music.map(t => `
      <div class="track-row" data-id="${t.id}">
        <span class="title">${escapeHTML(t.title)}</span>
        <button class="btn btn-danger btn-delete-track">Supprimer</button>
      </div>
    `).join('');
    container.querySelectorAll('.btn-delete-track').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.track-row');
        if (!confirm('Supprimer ce morceau ?')) return;
        await adminFetch('/api/admin/music/' + row.dataset.id, { method: 'DELETE' });
        loadMusicList();
      });
    });
  } catch (e) {
    container.innerHTML = '<div class="empty-state">Impossible de charger la liste des musiques.</div>';
  }
}

// ===================== MODÉRATION COMMENTAIRES =====================
async function loadAdminComments() {
  const container = document.getElementById('admin-comments-list');
  try {
    const comments = await (await fetch('/api/comments')).json();
    if (!comments.length) {
      container.innerHTML = '<div class="empty-state">Aucun commentaire.</div>';
      return;
    }
    container.innerHTML = comments.map(c => `
      <div class="comment" data-id="${c.id}" style="margin-bottom:14px;">
        <div class="comment-head">
          <span class="name">${escapeHTML(c.name)}</span>
          <span>${formatDateTime(c.date)}</span>
        </div>
        <p>${escapeHTML(c.comment)}</p>
        <button class="btn btn-danger btn-delete-comment" style="margin-top:10px;">Supprimer</button>
      </div>
    `).join('');
    container.querySelectorAll('.btn-delete-comment').forEach(btn => {
      btn.addEventListener('click', async () => {
        const el = btn.closest('.comment');
        if (!confirm('Supprimer ce commentaire ?')) return;
        await adminFetch('/api/admin/comments/' + el.dataset.id, { method: 'DELETE' });
        loadAdminComments();
      });
    });
  } catch (e) {
    container.innerHTML = '<div class="empty-state">Impossible de charger les commentaires.</div>';
  }
}
