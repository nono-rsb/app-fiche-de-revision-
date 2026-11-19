// Point d'entrée : compte (inscription, connexion, mot de passe oublié, suppression), onglets, hors connexion.
import { auth, db } from './firebase.js';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile,
  sendPasswordResetEmail, reauthenticateWithCredential, EmailAuthProvider, deleteUser,
  collection, query, where, getDocs, writeBatch, doc,
} from './vendor/firebase.js';
import { $, clean, toast, errMsg, requireOnline } from './util.js';
import { state } from './state.js';
import { loadFiches, loadFolders } from './library.js';
import { loadCards } from './review.js';

state.mode = 'register';
let registering = false;

// ---------- compte ----------
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
  $('forgotLink').hidden = reg;
  $('authError').textContent = '';
  $('authInfo').textContent = '';
}
$('switchLink').onclick = () => setMode(state.mode === 'register' ? 'login' : 'register');

$('forgotLink').onclick = async () => {
  $('authError').textContent = '';
  $('authInfo').textContent = '';
  const email = $('email').value.trim();
  if (!email) return ($('authError').textContent = "Écris d'abord ton e-mail ci-dessus.");
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') return ($('authError').textContent = errMsg(err));
  }
  // même réponse si le compte n'existe pas : on ne révèle pas qui est inscrit
  $('authInfo').textContent = 'Si un compte existe pour cette adresse, un e-mail pour choisir un nouveau mot de passe vient d’être envoyé.';
};

$('authForm').onsubmit = async (e) => {
  e.preventDefault();
  $('authError').textContent = '';
  $('authInfo').textContent = '';
  $('authSubmit').disabled = true;
  const email = $('email').value.trim();
  const password = $('password').value;
  try {
    if (state.mode === 'register') {
      const name = clean($('name').value, 60);
      if (!name) throw new Error('Le prénom est obligatoire');
      if (password.length < 8) throw Object.assign(new Error(), { code: 'auth/weak-password' });
      registering = true;
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      state.user = { uid: cred.user.uid, name, email };
      registering = false;
      $('password').value = '';
      await showApp();
    } else {
      await signInWithEmailAndPassword(auth, email, password); // onAuthStateChanged affiche l'appli
      $('password').value = '';
    }
  } catch (err) {
    registering = false;
    $('authError').textContent = errMsg(err);
  } finally {
    $('authSubmit').disabled = false;
  }
};

function showAuth(mode) {
  $('appView').hidden = true;
  $('tabbar').hidden = true;
  $('who').hidden = true;
  $('authView').hidden = false;
  setMode(mode);
}

async function showApp() {
  $('authView').hidden = true;
  $('appView').hidden = false;
  $('tabbar').hidden = false;
  $('who').hidden = false;
  $('whoName').textContent = state.user.name;
  await Promise.all([loadFiches(), loadFolders(), loadCards()]);
}

// ---------- onglets ----------
function showTab(tab) {
  $('libraryView').hidden = tab !== 'fiches';
  $('reviewView').hidden = tab !== 'reviser';
  document.querySelectorAll('#tabbar button').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('#tabbar button').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

// ---------- mon compte ----------
const accountDialog = $('accountDialog');
$('accountBtn').onclick = () => {
  $('accName').textContent = state.user.name;
  $('accEmail').textContent = auth.currentUser?.email || '';
  $('delBox').hidden = true;
  $('delPassword').value = '';
  $('accError').textContent = '';
  accountDialog.showModal();
};
$('accClose').onclick = () => accountDialog.close();
$('logoutBtn').onclick = async () => {
  accountDialog.close();
  state.mode = 'login'; // après déconnexion, on propose « Se connecter »
  await signOut(auth).catch(() => {});
};
$('delStart').onclick = () => { $('delBox').hidden = false; $('delPassword').focus(); };

// Supprime tout ce qui appartient à l'utilisateur, puis son compte.
async function deleteEverything(uid) {
  const owned = async (col) => (await getDocs(query(collection(db, col), where('ownerId', '==', uid)))).docs;
  const refs = [];
  for (const f of await owned('fiches')) {
    const { chunks, shared, folders = [] } = f.data();
    for (let n = 0; n < chunks; n++) refs.push(doc(db, 'fiches', f.id, 'chunks', String(n)));
    if (shared || folders.length) refs.push(doc(db, 'shares', f.id));
    refs.push(f.ref); // la fiche en dernier : les règles des morceaux la consultent
  }
  for (const d of await owned('folderShares')) refs.push(d.ref);
  for (const d of await owned('cards')) refs.push(d.ref);
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

$('delConfirm').onclick = async () => {
  $('accError').textContent = '';
  const user = auth.currentUser;
  const password = $('delPassword').value;
  if (!password) return ($('accError').textContent = 'Entre ton mot de passe pour confirmer.');
  $('delConfirm').disabled = true;
  try {
    await requireOnline();
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    await deleteEverything(user.uid);
    state.mode = 'register'; // avant la suppression : c'est elle qui déclenche l'écran de départ
    accountDialog.close();
    await deleteUser(user);
    toast('Compte et fiches supprimés');
  } catch (err) {
    $('accError').textContent = errMsg(err);
  } finally {
    $('delConfirm').disabled = false;
  }
};

// ---------- hors connexion ----------
function updateOnline() { $('offlineBar').hidden = navigator.onLine; }
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
updateOnline();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {}); // sans service worker, l'appli marche quand même
}

// ---------- démarrage ----------
onAuthStateChanged(auth, async (user) => {
  if (registering) return; // l'inscription finit d'enregistrer le prénom, puis affiche l'appli
  if (!user) {
    state.user = null;
    return showAuth(state.mode === 'register' ? 'register' : 'login');
  }
  state.user = { uid: user.uid, name: user.displayName || user.email, email: user.email };
  try {
    await showApp();
    showTab('fiches');
  } catch (err) {
    toast(errMsg(err));
  }
});
