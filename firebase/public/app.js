import { auth, db } from './firebase.js';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  collection, doc, query, where, getDocs, setDoc, updateDoc, deleteDoc,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { saveFile, loadFileBlob, deleteFile, prepareFile, CHUNK_SIZE } from './files.js';

const $ = (id) => document.getElementById(id);
const state = { user: null, fiches: [], mode: 'register', shareId: null, registering: false };

const clean = (v, max = 100) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, max);

const AUTH_ERRORS = {
  'auth/email-already-in-use': 'Un compte existe déjà avec cet email',
  'auth/invalid-email': 'Email invalide',
  'auth/weak-password': 'Mot de passe : 8 caractères minimum',
  'auth/invalid-credential': 'Email ou mot de passe incorrect',
  'auth/user-not-found': 'Email ou mot de passe incorrect',
  'auth/wrong-password': 'Email ou mot de passe incorrect',
  'auth/too-many-requests': 'Trop de tentatives, réessaie plus tard.',
  'auth/network-request-failed': 'Problème de connexion, réessaie.',
};
const errMsg = (e) => AUTH_ERRORS[e.code] || (e.code === 'permission-denied' ? 'Action non autorisée' : e.message || 'Erreur');

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
  const email = $('email').value.trim();
  const password = $('password').value;
  try {
    if (state.mode === 'register') {
      const name = clean($('name').value, 60);
      if (!name) throw new Error('Le prénom est obligatoire');
      if (password.length < 8) throw Object.assign(new Error(), { code: 'auth/weak-password' });
      state.registering = true;
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      state.user = { uid: cred.user.uid, name };
      state.registering = false;
      $('password').value = '';
      await showApp();
    } else {
      await signInWithEmailAndPassword(auth, email, password); // onAuthStateChanged affiche l'appli
      $('password').value = '';
    }
  } catch (err) {
    state.registering = false;
    $('authError').textContent = errMsg(err);
  } finally {
    $('authSubmit').disabled = false;
  }
};

$('logoutBtn').onclick = async () => {
  state.mode = 'login'; // après déconnexion, on propose « Se connecter »
  await signOut(auth).catch(() => {});
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
  const snap = await getDocs(query(collection(db, 'fiches'), where('ownerId', '==', state.user.uid)));
  state.fiches = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((x, y) => y.createdAt - x.createdAt);
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
  const classes = [...tree].sort((a, b) => a[0].localeCompare(b[0], 'fr', { numeric: true }));
  for (const [i, [classe, matieres]] of classes.entries()) {
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
      mNodes.push(group('matiere', matiere, plural(nMat), true, ...cNodes));
    }
    nodes.push(group('classe', `🎓 ${classe}`, plural(nClasse), filtering || i === 0, ...mNodes));
  }
  list.replaceChildren(...nodes);
}

function ficheRow(f) {
  const pdf = f.mime === 'application/pdf';
  const meta = el('div', { className: 'meta' });
  const link = el('a', { href: '#', textContent: f.title });
  link.onclick = async (e) => {
    e.preventDefault();
    const w = window.open('about:blank', '_blank'); // ouvert tout de suite pour ne pas être bloqué par le navigateur
    try {
      const url = URL.createObjectURL(await loadFileBlob(f.id, f.chunks, f.mime));
      if (w) w.location.href = url;
    } catch (err) {
      if (w) w.close();
      toast(errMsg(err));
    }
  };
  meta.append(link);
  if (f.shared) meta.append(el('span', { className: 'badge', textContent: 'partagée' }));
  meta.append(el('small', { textContent: `${f.originalName} · ${new Date(f.createdAt).toLocaleDateString('fr-FR')}` }));

  const share = el('button', { className: 'small', textContent: '🔗 Partager' });
  share.onclick = () => openShare(f);
  const del = el('button', { className: 'small danger', textContent: 'Supprimer', title: 'Supprimer la fiche' });
  del.onclick = async () => {
    if (!confirm(`Supprimer « ${f.title} » ?`)) return;
    try {
      await deleteFile(f.id, f.chunks); // d'abord le contenu, tant que la fiche existe encore
      if (f.shared) await deleteDoc(doc(db, 'shares', f.id));
      await deleteDoc(doc(db, 'fiches', f.id));
    } catch (err) {
      return toast(errMsg(err));
    }
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
  const classe = clean($('classe').value);
  const matiere = clean($('matiere').value);
  const cours = clean($('cours').value);
  if (!classe || !matiere || !cours) return ($('addError').textContent = 'Classe, matière et cours sont obligatoires');
  $('addSubmit').disabled = true;
  $('addSubmit').textContent = 'Envoi…';
  const uid = state.user.uid;
  const docRef = doc(collection(db, 'fiches'));
  let created = false;
  try {
    const { bytes, mime } = await prepareFile($('file').files[0]); // photo réduite, PDF contrôlé
    await setDoc(docRef, {
      ownerId: uid,
      title: clean($('title').value, 150) || cours,
      classe, matiere, cours,
      originalName: $('file').files[0].name.slice(0, 200),
      mime,
      size: bytes.length,
      chunks: Math.max(1, Math.ceil(bytes.length / CHUNK_SIZE)),
      shared: false,
      createdAt: Date.now(),
    });
    created = true;
    await saveFile(docRef.id, uid, bytes);
    addDialog.close();
    toast('Fiche ajoutée ✔');
    await loadFiches();
  } catch (err) {
    if (created) await deleteDoc(docRef).catch(() => {}); // pas de fiche sans contenu
    $('addError').textContent = errMsg(err);
  } finally {
    $('addSubmit').disabled = false;
    $('addSubmit').textContent = 'Enregistrer';
  }
};

// ---------- Partage par lien ----------
const shareDialog = $('shareDialog');
async function openShare(f) {
  try {
    await setDoc(doc(db, 'shares', f.id), {
      ownerId: f.ownerId,
      ownerName: state.user.name,
      title: f.title, classe: f.classe, matiere: f.matiere, cours: f.cours,
      originalName: f.originalName, mime: f.mime, chunks: f.chunks, createdAt: f.createdAt,
    });
    if (!f.shared) await updateDoc(doc(db, 'fiches', f.id), { shared: true });
    state.shareId = f.id;
    $('shareUrl').value = `${location.origin}/s/${f.id}`;
    shareDialog.showModal();
    $('shareUrl').select();
    loadFiches();
  } catch (err) {
    toast(errMsg(err));
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
  try {
    await deleteDoc(doc(db, 'shares', state.shareId));
    await updateDoc(doc(db, 'fiches', state.shareId), { shared: false });
  } catch (err) {
    return toast(errMsg(err));
  }
  shareDialog.close();
  toast('Lien désactivé');
  loadFiches();
};
$('shareClose').onclick = () => shareDialog.close();

// ---------- Démarrage ----------
onAuthStateChanged(auth, async (user) => {
  if (state.registering) return; // l'inscription finit d'enregistrer le prénom, puis affiche l'appli
  if (!user) {
    state.user = null;
    return showAuth(state.mode === 'register' ? 'register' : 'login');
  }
  state.user = { uid: user.uid, name: user.displayName || user.email };
  try {
    await showApp();
  } catch (err) {
    toast(errMsg(err));
  }
});
