document.getElementById('year').textContent = new Date().getFullYear();

// ===================== ACCÈS ADMIN (fenêtre de code) =====================
const adminOverlay = document.getElementById('admin-modal-overlay');
const adminCodeInput = document.getElementById('admin-modal-code');
const adminModalMsg = document.getElementById('admin-modal-msg');

function openAdminModal() {
  adminOverlay.classList.add('active');
  adminModalMsg.textContent = '';
  adminCodeInput.value = '';
  setTimeout(() => adminCodeInput.focus(), 50);
}
function closeAdminModal() {
  adminOverlay.classList.remove('active');
}

document.getElementById('open-admin-btn').addEventListener('click', openAdminModal);
const footerAdminBtn = document.getElementById('open-admin-btn-footer');
if (footerAdminBtn) footerAdminBtn.addEventListener('click', openAdminModal);

document.getElementById('admin-modal-close').addEventListener('click', closeAdminModal);
adminOverlay.addEventListener('click', (e) => {
  if (e.target === adminOverlay) closeAdminModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAdminModal();
});

async function submitAdminCode() {
  const code = adminCodeInput.value;
  adminModalMsg.textContent = '';
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
    window.location.href = 'admin.html';
  } catch (err) {
    adminModalMsg.textContent = err.message;
  }
}

document.getElementById('admin-modal-submit').addEventListener('click', submitAdminCode);
adminCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAdminCode();
});

// ===================== TÉLÉCHARGEMENT =====================
async function loadGameInfo() {
  const statusEl = document.getElementById('game-status');
  const btn = document.getElementById('download-btn');
  const nameEl = document.getElementById('game-file-name');
  try {
    const res = await fetch('/api/game-info');
    const data = await res.json();
    if (data.available) {
      statusEl.textContent = 'Le jeu est prêt à être téléchargé.';
      btn.style.display = 'inline-flex';
      nameEl.textContent = data.name ? `Fichier : ${data.name}` : '';
    } else {
      statusEl.textContent = "Aucune version n'est disponible pour le moment. Revenez bientôt.";
      btn.style.display = 'none';
    }
  } catch (e) {
    statusEl.textContent = 'Impossible de vérifier le fichier pour le moment.';
  }
}
loadGameInfo();

// ===================== COMMENTAIRES =====================
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function loadComments() {
  const list = document.getElementById('comments-list');
  try {
    const res = await fetch('/api/comments');
    const comments = await res.json();
    if (!comments.length) {
      list.innerHTML = '<div class="empty-state">Aucun commentaire pour l\'instant. Soyez le premier à écrire.</div>';
      return;
    }
    list.innerHTML = comments.map(c => `
      <div class="comment">
        <div class="comment-head">
          <span class="name">${escapeHTML(c.name)}</span>
          <span>${formatDate(c.date)}</span>
        </div>
        <p>${escapeHTML(c.comment)}</p>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty-state">Impossible de charger les commentaires.</div>';
  }
}
loadComments();

document.getElementById('comment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('c-name').value.trim();
  const comment = document.getElementById('c-comment').value.trim();
  const msgEl = document.getElementById('comment-form-msg');
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, comment })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    msgEl.textContent = 'Commentaire publié.';
    msgEl.classList.add('ok');
    e.target.reset();
    loadComments();
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.classList.add('err');
  }
});

// ===================== CONTACT =====================
document.getElementById('contact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('m-name').value.trim();
  const email = document.getElementById('m-email').value.trim();
  const message = document.getElementById('m-message').value.trim();
  const msgEl = document.getElementById('contact-form-msg');
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    msgEl.textContent = 'Message envoyé au développeur. Merci !';
    msgEl.classList.add('ok');
    e.target.reset();
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.classList.add('err');
  }
});

// ===================== LECTEUR DE MUSIQUE =====================
const audio = document.getElementById('audio-player');
const trackTitle = document.getElementById('track-title');
const trackSub = document.getElementById('track-sub');
const progressFill = document.getElementById('progress-fill');
const btnPlayPause = document.getElementById('btn-playpause');
const btnStop = document.getElementById('btn-stop');
const btnNext = document.getElementById('btn-next');
const musicDisc = document.getElementById('music-disc');
const floatingWidget = document.getElementById('floating-disc-widget');
const discIcon = document.getElementById('disc-icon');

let playlist = [];
let currentIndex = -1;

async function loadPlaylist() {
  try {
    const res = await fetch('/api/music');
    playlist = await res.json();
    if (playlist.length) {
      trackTitle.textContent = 'Prêt à écouter';
      trackSub.textContent = `${playlist.length} morceau(x) disponible(s)`;
      btnPlayPause.disabled = false;
      btnNext.disabled = false;
      musicDisc.classList.remove('disabled');
      floatingWidget.title = 'Cliquez pour écouter la musique de Vestiges';
    } else {
      trackTitle.textContent = 'Aucune musique disponible';
      trackSub.textContent = '—';
      btnPlayPause.disabled = true;
      btnNext.disabled = true;
      musicDisc.classList.add('disabled');
      floatingWidget.title = 'Aucune musique disponible';
    }
  } catch (e) {
    trackTitle.textContent = 'Erreur de chargement';
  }
}

function playTrack(index) {
  if (!playlist.length) return;
  currentIndex = ((index % playlist.length) + playlist.length) % playlist.length;
  const track = playlist[currentIndex];
  audio.src = track.url;
  audio.play();
  trackTitle.textContent = track.title;
  trackSub.textContent = `Morceau ${currentIndex + 1} / ${playlist.length}`;
  btnPlayPause.textContent = '❚❚ Pause';
  musicDisc.classList.add('spinning');
  discIcon.textContent = '❚❚';
  floatingWidget.title = `En lecture : ${track.title}`;
}

btnPlayPause.addEventListener('click', () => {
  if (currentIndex === -1) {
    playTrack(0);
    return;
  }
  if (audio.paused) {
    audio.play();
    btnPlayPause.textContent = '❚❚ Pause';
    musicDisc.classList.add('spinning');
    discIcon.textContent = '❚❚';
  } else {
    audio.pause();
    btnPlayPause.textContent = '▶ Lire';
    musicDisc.classList.remove('spinning');
    discIcon.textContent = '▶';
  }
});

btnStop.addEventListener('click', () => {
  audio.pause();
  audio.currentTime = 0;
  progressFill.style.width = '0%';
  btnPlayPause.textContent = '▶ Lire';
  musicDisc.classList.remove('spinning');
  discIcon.textContent = '▶';
});

floatingWidget.addEventListener('click', () => {
  if (!playlist.length) return;
  btnPlayPause.click();
});

btnNext.addEventListener('click', () => {
  playTrack(currentIndex + 1);
});

audio.addEventListener('timeupdate', () => {
  if (audio.duration) {
    progressFill.style.width = (audio.currentTime / audio.duration * 100) + '%';
  }
});

audio.addEventListener('ended', () => {
  playTrack(currentIndex + 1);
});

loadPlaylist();
