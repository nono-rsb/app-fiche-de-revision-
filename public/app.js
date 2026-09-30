const $ = (id) => document.getElementById(id);
const state = { user: null, fiches: [], mode: 'register', shareId: null };

async function api(url, opts = {}) {
  const init = { credentials: 'same-origin', ...opts };
  if (opts.json) {
    init.method = init.method || 'POST';
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.json);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Erreur'), { status: res.status });
  return data;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  n.append(...children);
  return n;
}

// ---------- Compte ----------
function setMode(mode) {
  state.mode = mode;
  const reg = mode === 'register';
  $('authTitle').textContent = reg ? 'Créer un compte' : 'Se connecter';
  $('authSubmit').textContent = reg ? 'Créer mon compte' : 'Connexion';
  $('nameRow').hidden = !reg;
  $('name').required = reg;
  $('password').autocomplete = reg ? 'new-password' : 'current-password';
  $('switchText').textContent = reg ? 'Déjà un compte ?' : 'Pas encore de compte ?';
  $('switchLink').textContent = reg ? 'Se connecter' : 'Créer un compte';
  $('authError').textContent = '';
}

$('switchLink').onclick = () => setMode(state.mode === 'register' ? 'login' : 'register');

$('authForm').onsubmit = async (e) => {
  e.preventDefault();
  $('authError').textContent = '';
  $('authSubmit').disabled = true;
  try {
    const body = { email: $('email').value, password: $('password').value };
    if (state.mode === 'register') body.name = $('name').value;
    state.user = await api(state.mode === 'register' ? '/api/register' : '/api/login', { json: body });
    $('password').value = '';
    await showApp();
  } catch (err) {
    $('authError').textContent = err.message;
  } finally {
    $('authSubmit').disabled = false;
  }
};

$('logoutBtn').onclick = async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  state.user = null;
  showAuth('login');
};

function showAuth(mode) {
  $('appView').hidden = true;
  $('who').hidden = true;
  $('authView').hidden = false;
  setMode(mode);
}

async function showApp() {
  $('authView').hidden = true;
  $('appView').hidden = false;
  $('who').hidden = false;
  $('whoName').textContent = state.user.name;
  await loadFiches();
}

// ---------- Bibliothèque : classe > matière > cours ----------
async function loadFiches() {
  state.fiches = await api('/api/fiches');
  refreshFilters();
  render();
}

const uniq = (arr) => [...new Set(arr)].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));

function refreshFilters() {
  const fill = (sel, first, values) => {
    const cur = sel.value;
    sel.replaceChildren(el('option', { value: '', textContent: first }), ...values.map((v) => el('option', { value: v, textContent: v })));
    sel.value = values.includes(cur) ? cur : '';
  };
  fill($('fClasse'), 'Toutes les classes', uniq(state.fiches.map((f) => f.classe)));
  fill($('fMatiere'), 'Toutes les matières', uniq(state.fiches.map((f) => f.matiere)));
  const fillList = (id, key) => $(id).replaceChildren(...uniq(state.fiches.map((f) => f[key])).map((v) => el('option', { value: v })));
  fillList('dlClasse', 'classe');
  fillList('dlMatiere', 'matiere');
  fillList('dlCours', 'cours');
}

function group(cls, title, count, open, ...children) {
  const d = el('details', { className: `group ${cls}`, open });
  d.append(el('summary', {}, title, el('span', { className: 'count', textContent: count })), el('div', { className: 'inner' }, ...children));
  return d;
}

const plural = (n) => `${n} fiche${n > 1 ? 's' : ''}`;

function render() {
  const q = $('q').value.trim().toLowerCase();
  const fc = $('fClasse').value;
  const fm = $('fMatiere').value;
  const items = state.fiches.filter(
    (f) =>
      (!fc || f.classe === fc) &&
      (!fm || f.matiere === fm) &&
      (!q || [f.title, f.classe, f.matiere, f.cours].some((s) => s.toLowerCase().includes(q)))
  );
  const list = $('list');
  if (!items.length) {
    list.replaceChildren(
      el('div', { className: 'empty', textContent: state.fiches.length ? 'Aucune fiche ne correspond.' : 'Aucune fiche pour le moment. Ajoute ta première fiche !' })
    );
    return;
  }
  const filtering = !!(q || fc || fm);
  const tree = new Map();
  for (const f of items) {
    if (!tree.has(f.classe)) tree.set(f.classe, new Map());
    const m = tree.get(f.classe);
    if (!m.has(f.matiere)) m.set(f.matiere, new Map());
    const c = m.get(f.matiere);
    if (!c.has(f.cours)) c.set(f.cours, []);
    c.get(f.cours).push(f);
  }
  const nodes = [];
  for (const [classe, matieres] of [...tree].sort((a, b) => a[0].localeCompare(b[0], 'fr', { numeric: true }))) {
    const mNodes = [];
    let nClasse = 0;
    for (const [matiere, courses] of [...matieres].sort((a, b) => a[0].localeCompare(b[0], 'fr'))) {
      const cNodes = [];
      let nMat = 0;
      for (const [cours, fiches] of [...courses].sort((a, b) => a[0].localeCompare(b[0], 'fr'))) {
        nMat += fiches.length;
        cNodes.push(group('cours', `📖 ${cours}`, plural(fiches.length), true, ...fiches.map(ficheRow)));
      }
      nClasse += nMat;
      mNodes.push(group('matiere', matiere, plural(nMat), filtering || matieres.size === 1, ...cNodes));
    }
    nodes.push(group('classe', `🎓 ${classe}`, plural(nClasse), filtering || tree.size === 1, ...mNodes));
  }
  list.replaceChildren(...nodes);
}

function ficheRow(f) {
  const pdf = f.mime === 'application/pdf';
  const meta = el('div', { className: 'meta' });
  const link = el('a', { href: `/api/fiches/${f.id}/file`, target: '_blank', rel: 'noopener', textContent: f.title });
  meta.append(link);
  if (f.shareToken) meta.append(el('span', { className: 'badge', textContent: 'partagée' }));
  meta.append(el('small', { textContent: `${f.originalName} · ${new Date(f.createdAt).toLocaleDateString('fr-FR')}` }));

  const share = el('button', { className: 'small', textContent: '🔗 Partager' });
  share.onclick = () => openShare(f);
  const del = el('button', { className: 'small danger', textContent: 'Supprimer', title: 'Supprimer la fiche' });
  del.onclick = async () => {
    if (!confirm(`Supprimer « ${f.title} » ?`)) return;
    await api(`/api/fiches/${f.id}`, { method: 'DELETE' });
    toast('Fiche supprimée');
    loadFiches();
  };
  return el('div', { className: 'fiche' }, el('span', { className: 'ico', textContent: pdf ? '📄' : '🖼️' }), meta, el('div', { className: 'actions' }, share, del));
}

['q', 'fClasse', 'fMatiere'].forEach((id) => $(id).addEventListener('input', render));

// ---------- Ajout d'une fiche ----------
const addDialog = $('addDialog');
$('addBtn').onclick = () => {
  $('addForm').reset();
  $('picked').textContent = '';
  $('addError').textContent = '';
  addDialog.showModal();
};
$('addCancel').onclick = () => addDialog.close();

function pick(file) {
  if (!file) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  $('file').files = dt.files;
  $('picked').textContent = `✔ ${file.name}`;
  if (!$('title').value) $('title').value = file.name.replace(/\.[^.]+$/, '');
}
$('file').onchange = () => pick($('file').files[0]);
['dragover', 'dragenter'].forEach((ev) => $('drop').addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => $('drop').addEventListener(ev, () => $('drop').classList.remove('over')));
$('drop').addEventListener('drop', (e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); });

$('addForm').onsubmit = async (e) => {
  e.preventDefault();
  $('addError').textContent = '';
  if (!$('file').files[0]) return ($('addError').textContent = 'Ajoute un PDF ou une photo');
  const fd = new FormData();
  fd.append('title', $('title').value);
  fd.append('classe', $('classe').value);
  fd.append('matiere', $('matiere').value);
  fd.append('cours', $('cours').value);
  fd.append('file', $('file').files[0]);
  $('addSubmit').disabled = true;
  try {
    await api('/api/fiches', { method: 'POST', body: fd });
    addDialog.close();
    toast('Fiche ajoutée ✔');
    await loadFiches();
  } catch (err) {
    $('addError').textContent = err.message;
  } finally {
    $('addSubmit').disabled = false;
  }
};

// ---------- Partage par lien ----------
const shareDialog = $('shareDialog');
async function openShare(f) {
  try {
    const { url } = await api(`/api/fiches/${f.id}/share`, { method: 'POST' });
    state.shareId = f.id;
    $('shareUrl').value = url;
    shareDialog.showModal();
    $('shareUrl').select();
    loadFiches();
  } catch (err) {
    toast(err.message);
  }
}
$('copyBtn').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('shareUrl').value);
    toast('Lien copié ✔');
  } catch {
    $('shareUrl').select();
    toast('Copie le lien avec Ctrl+C');
  }
};
$('unshareBtn').onclick = async () => {
  await api(`/api/fiches/${state.shareId}/share`, { method: 'DELETE' });
  shareDialog.close();
  toast('Lien désactivé');
  loadFiches();
};
$('shareClose').onclick = () => shareDialog.close();

// ---------- Démarrage ----------
(async () => {
  try {
    state.user = await api('/api/me');
    await showApp();
  } catch {
    showAuth('register');
  }
})();
