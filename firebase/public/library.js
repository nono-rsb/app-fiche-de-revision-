// Onglet « Fiches » : bibliothèque classée par classe › matière › cours, ajout (PDF ou plusieurs photos),
// modification, favoris, miniatures, partage d'une fiche ou d'un dossier par lien.
import { db } from './firebase.js';
import {
  collection, doc, query, where, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, arrayUnion,
} from './vendor/firebase.js';
import { $, el, toast, clean, uniq, plural, byFr, errMsg, requireOnline, remember } from './util.js';
import { state } from './state.js';
import { prepareFiles, saveFile, loadFileBlob, deleteFile, CHUNK_SIZE, MAX_PAGES } from './files.js';
import { openShare } from './sharing.js';

// ---------- chargement ----------
export async function loadFiches() {
  const snap = await getDocs(query(collection(db, 'fiches'), where('ownerId', '==', state.user.uid)));
  const loaded = snap.docs.map((d) => ({ id: d.id, folders: [], ...d.data() }));
  const ids = new Set(loaded.map((f) => f.id));
  const sending = state.fiches.filter((f) => f.pending && !ids.has(f.id)); // pas encore visibles côté serveur
  state.fiches = [...sending, ...loaded].sort((a, b) => b.createdAt - a.createdAt);
  refreshFilters();
  renderLibrary();
}

export async function loadFolders() {
  const snap = await getDocs(query(collection(db, 'folderShares'), where('ownerId', '==', state.user.uid)));
  state.folders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderLibrary();
}

// ---------- listes de choix (classe, matière, cours déjà utilisés) ----------
export function refreshFilters() {
  const fill = (sel, first, values) => {
    const cur = sel.value;
    sel.replaceChildren(el('option', { value: '', textContent: first }), ...values.map((v) => el('option', { value: v, textContent: v })));
    sel.value = values.includes(cur) ? cur : '';
  };
  fill($('fClasse'), 'Toutes les classes', uniq(state.fiches.map((f) => f.classe)));
  fill($('fMatiere'), 'Toutes les matières', uniq(state.fiches.map((f) => f.matiere)));
  const all = [...state.fiches, ...state.cards];
  const fillList = (id, key) => $(id).replaceChildren(...uniq(all.map((f) => f[key])).map((v) => el('option', { value: v })));
  fillList('dlClasse', 'classe');
  fillList('dlMatiere', 'matiere');
  fillList('dlCours', 'cours');
}

// ---------- affichage ----------
function group(cls, key, title, count, open, extra, ...children) {
  const d = el('details', { className: `group ${cls}` });
  const summary = el('summary', {}, title);
  if (extra) summary.append(extra);
  summary.append(el('span', { className: 'count', textContent: count }));
  d.append(summary, el('div', { className: 'inner' }, ...children));
  remember(d, key, open);
  return d;
}

function folderButton(classe, matiere) {
  const b = el('button', { className: 'small icon', title: `Partager « ${matiere ? `${classe} › ${matiere}` : classe} » par un seul lien`, textContent: '🔗' });
  b.setAttribute('aria-label', `Partager le dossier ${classe}${matiere ? ' › ' + matiere : ''}`);
  b.onclick = (e) => {
    e.preventDefault(); // ne pas replier le groupe
    e.stopPropagation();
    openFolderShare(classe, matiere).catch((err) => toast(errMsg(err)));
  };
  return b;
}

export function renderLibrary() {
  const q = $('q').value.trim().toLowerCase();
  const fc = $('fClasse').value;
  const fm = $('fMatiere').value;
  const items = state.fiches.filter(
    (f) => (!fc || f.classe === fc) && (!fm || f.matiere === fm) && (!q || [f.title, f.classe, f.matiere, f.cours].some((s) => s.toLowerCase().includes(q)))
  );
  const favs = items.filter((f) => f.favorite);
  $('favs').replaceChildren(
    ...(favs.length ? [el('h3', { className: 'sect', textContent: '⭐ Favoris' }), ...favs.map(ficheRow)] : [])
  );

  const list = $('list');
  if (!items.length) {
    list.replaceChildren(el('div', { className: 'empty', textContent: state.fiches.length ? 'Aucune fiche ne correspond.' : 'Aucune fiche pour le moment. Ajoute ta première fiche !' }));
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
  const classes = [...tree].sort((a, b) => byFr(a[0], b[0]));
  const nodes = [];
  for (const [i, [classe, matieres]] of classes.entries()) {
    const mNodes = [];
    let nClasse = 0;
    for (const [matiere, courses] of [...matieres].sort((a, b) => byFr(a[0], b[0]))) {
      const cNodes = [];
      let nMat = 0;
      for (const [cours, fiches] of [...courses].sort((a, b) => byFr(a[0], b[0]))) {
        nMat += fiches.length;
        cNodes.push(group('cours', `u:${classe}|${matiere}|${cours}`, `📖 ${cours}`, plural(fiches.length), true, null, ...fiches.map(ficheRow)));
      }
      nClasse += nMat;
      mNodes.push(group('matiere', `m:${classe}|${matiere}`, matiere, plural(nMat), true, folderButton(classe, matiere), ...cNodes));
    }
    nodes.push(group('classe', `c:${classe}`, `🎓 ${classe}`, plural(nClasse), filtering || i === 0, folderButton(classe, ''), ...mNodes));
  }
  list.replaceChildren(...nodes);
}

function ficheRow(f) {
  const pdf = f.mime === 'application/pdf';
  const meta = el('div', { className: 'meta' });
  const link = el('a', { href: '#', textContent: f.title });
  link.onclick = async (e) => {
    e.preventDefault();
    if (f.pending) return toast('Envoi en cours, encore un instant…');
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
  if (f.pending) meta.append(el('span', { className: 'badge pend', textContent: 'envoi…' }));
  else if (f.shared || (f.folders || []).length) meta.append(el('span', { className: 'badge', textContent: 'partagée' }));
  meta.append(el('small', { textContent: `${f.originalName} · ${new Date(f.createdAt).toLocaleDateString('fr-FR')}` }));

  const ico = f.thumb
    ? el('img', { className: 'thumb', src: f.thumb, alt: '' })
    : el('span', { className: 'ico', textContent: pdf ? '📄' : '🖼️' });

  const star = el('button', { className: 'small icon star' + (f.favorite ? ' on' : ''), textContent: f.favorite ? '★' : '☆', title: f.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris' });
  star.setAttribute('aria-label', star.title);
  star.onclick = () => toggleFavorite(f);
  const share = el('button', { className: 'small', textContent: '🔗 Partager' });
  share.onclick = () => shareFiche(f).catch((err) => toast(errMsg(err)));
  const edit = el('button', { className: 'small', textContent: 'Modifier' });
  edit.onclick = () => openEdit(f);
  const del = el('button', { className: 'small danger', textContent: 'Supprimer', title: 'Supprimer la fiche' });
  del.onclick = () => removeFiche(f);
  if (f.pending) for (const b of [star, share, edit, del]) b.disabled = true;
  return el('div', { className: 'fiche' + (f.pending ? ' pending' : '') }, ico, meta, el('div', { className: 'actions' }, star, share, edit, del));
}

['q', 'fClasse', 'fMatiere'].forEach((id) => $(id).addEventListener('input', renderLibrary));

// ---------- favoris ----------
async function toggleFavorite(f) {
  const next = !f.favorite;
  f.favorite = next; // tout de suite à l'écran, puis enregistré
  renderLibrary();
  try {
    await updateDoc(doc(db, 'fiches', f.id), { favorite: next });
  } catch (err) {
    f.favorite = !next;
    renderLibrary();
    toast(errMsg(err));
  }
}

// ---------- ajout : un PDF, ou une ou plusieurs photos (réunies en un seul PDF) ----------
const addDialog = $('addDialog');
let picked = []; // [{ file, url }]

function renderPicked() {
  $('pageList').replaceChildren(
    ...picked.map((p, i) => {
      const isPdf = p.file.type === 'application/pdf';
      const thumb = isPdf ? el('span', { className: 'ico', textContent: '📄' }) : el('img', { className: 'thumb', src: p.url, alt: '' });
      const up = el('button', { type: 'button', className: 'small icon', textContent: '↑', title: 'Monter', disabled: i === 0 });
      up.onclick = () => { [picked[i - 1], picked[i]] = [picked[i], picked[i - 1]]; renderPicked(); };
      const down = el('button', { type: 'button', className: 'small icon', textContent: '↓', title: 'Descendre', disabled: i === picked.length - 1 });
      down.onclick = () => { [picked[i + 1], picked[i]] = [picked[i], picked[i + 1]]; renderPicked(); };
      const rm = el('button', { type: 'button', className: 'small icon danger', textContent: '✕', title: 'Retirer' });
      rm.onclick = () => { URL.revokeObjectURL(p.url); picked.splice(i, 1); renderPicked(); };
      return el('div', { className: 'pageRow' }, thumb, el('span', { className: 'pname', textContent: isPdf ? p.file.name : `Page ${i + 1} · ${p.file.name}` }), up, down, rm);
    })
  );
  const photos = picked.filter((p) => p.file.type !== 'application/pdf').length;
  $('dropTitle').textContent = picked.length ? '＋ Ajouter une autre page' : '📄 Dépose un PDF ou prends une photo';
  $('picked').textContent = photos > 1 ? `✔ ${photos} photos : elles seront réunies en un seul PDF` : picked.length ? '✔ Fichier prêt' : '';
  if (picked.length && !$('title').value) $('title').value = picked[0].file.name.replace(/\.[^.]+$/, '');
}

function addPicked(files) {
  for (const file of files) {
    if (picked.length >= MAX_PAGES) return toast(`${MAX_PAGES} pages au maximum`);
    picked.push({ file, url: URL.createObjectURL(file) });
  }
  renderPicked();
}

$('addBtn').onclick = () => {
  $('addForm').reset();
  picked.forEach((p) => URL.revokeObjectURL(p.url));
  picked = [];
  renderPicked();
  $('addError').textContent = '';
  addDialog.showModal();
};
$('addCancel').onclick = () => addDialog.close();
$('file').onchange = () => {
  addPicked([...$('file').files]);
  $('file').value = ''; // permet de choisir deux fois la même photo
};
['dragover', 'dragenter'].forEach((ev) => $('drop').addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => $('drop').addEventListener(ev, () => $('drop').classList.remove('over')));
$('drop').addEventListener('drop', (e) => { e.preventDefault(); addPicked([...e.dataTransfer.files]); });

$('addForm').onsubmit = async (e) => {
  e.preventDefault();
  $('addError').textContent = '';
  if (!picked.length) return ($('addError').textContent = 'Ajoute un PDF ou une photo');
  const classe = clean($('classe').value);
  const matiere = clean($('matiere').value);
  const cours = clean($('cours').value);
  if (!classe || !matiere || !cours) return ($('addError').textContent = 'Classe, matière et cours sont obligatoires');
  $('addSubmit').disabled = true;
  $('addSubmit').textContent = 'Préparation…';
  const uid = state.user.uid;
  const docRef = doc(collection(db, 'fiches'));
  try {
    // La vérification du réseau et la réduction des photos se font en même temps.
    const [prep] = await Promise.all([prepareFiles(picked.map((p) => p.file)), requireOnline()]);
    const fiche = {
      ownerId: uid,
      title: clean($('title').value, 150) || cours,
      classe, matiere, cours,
      originalName: clean(prep.name, 200) || 'fiche',
      mime: prep.mime,
      size: prep.bytes.length,
      chunks: Math.max(1, Math.ceil(prep.bytes.length / CHUNK_SIZE)),
      shared: false,
      favorite: false,
      folders: [],
      createdAt: Date.now(),
    };
    if (prep.thumb) fiche.thumb = prep.thumb;
    // La fiche apparaît tout de suite ; l'envoi continue en arrière-plan.
    const local = { id: docRef.id, ...fiche, pending: true };
    state.fiches.unshift(local);
    refreshFilters();
    renderLibrary();
    addDialog.close();
    sendFiche(docRef, fiche, prep.bytes, local);
  } catch (err) {
    $('addError').textContent = errMsg(err);
  } finally {
    $('addSubmit').disabled = false;
    $('addSubmit').textContent = 'Enregistrer';
  }
};

async function sendFiche(docRef, fiche, bytes, local) {
  let created = false;
  try {
    await setDoc(docRef, fiche);
    created = true;
    await saveFile(docRef.id, fiche.ownerId, bytes);
    delete local.pending;
    renderLibrary();
    toast('Fiche ajoutée ✔');
  } catch (err) {
    if (created) await deleteDoc(docRef).catch(() => {}); // pas de fiche sans contenu
    state.fiches = state.fiches.filter((f) => f !== local);
    refreshFilters();
    renderLibrary();
    toast(`L'envoi a échoué : ${errMsg(err)}`);
  }
}

// ---------- modification ----------
const editDialog = $('editDialog');
let editing = null;

function openEdit(f) {
  editing = f;
  $('eTitle').value = f.title;
  $('eClasse').value = f.classe;
  $('eMatiere').value = f.matiere;
  $('eCours').value = f.cours;
  $('editError').textContent = '';
  editDialog.showModal();
}
$('editCancel').onclick = () => editDialog.close();
$('editForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = editing;
  const next = {
    title: clean($('eTitle').value, 150),
    classe: clean($('eClasse').value),
    matiere: clean($('eMatiere').value),
    cours: clean($('eCours').value),
  };
  if (!next.title || !next.classe || !next.matiere || !next.cours) return ($('editError').textContent = 'Tous les champs sont obligatoires');
  $('editSubmit').disabled = true;
  try {
    await requireOnline();
    await updateDoc(doc(db, 'fiches', f.id), next);
    if (f.shared || (f.folders || []).length) await updateDoc(doc(db, 'shares', f.id), next); // le lien montre les nouveaux noms
    editDialog.close();
    toast('Fiche modifiée ✔');
    await loadFiches();
    await syncFolders();
  } catch (err) {
    $('editError').textContent = errMsg(err);
  } finally {
    $('editSubmit').disabled = false;
  }
};

// ---------- suppression ----------
async function removeFiche(f) {
  if (!confirm(`Supprimer « ${f.title} » ?`)) return;
  try {
    await requireOnline();
    await deleteFile(f.id, f.chunks); // d'abord le contenu, tant que la fiche existe encore
    if (f.shared || (f.folders || []).length) await deleteDoc(doc(db, 'shares', f.id));
    await deleteDoc(doc(db, 'fiches', f.id));
  } catch (err) {
    return toast(errMsg(err));
  }
  toast('Fiche supprimée');
  await loadFiches();
  await syncFolders();
}

// ---------- partage d'une fiche ----------
const sharePayload = (f) => ({
  ownerId: f.ownerId,
  ownerName: state.user.name,
  title: f.title, classe: f.classe, matiere: f.matiere, cours: f.cours,
  originalName: f.originalName, mime: f.mime, chunks: f.chunks, createdAt: f.createdAt,
});

async function shareFiche(f) {
  await requireOnline();
  await setDoc(doc(db, 'shares', f.id), sharePayload(f));
  if (!f.shared) await updateDoc(doc(db, 'fiches', f.id), { shared: true });
  await loadFiches();
  openShare({
    title: 'Partager par lien',
    hint: 'Toute personne qui a ce lien peut voir la fiche, sans compte.',
    url: `${location.origin}/s/${f.id}`,
    shareText: `${f.title} – ${f.classe} › ${f.matiere}`,
    onUnshare: async () => {
      await requireOnline();
      if (!(f.folders || []).length) await deleteDoc(doc(db, 'shares', f.id)); // encore partagée via un dossier ? on garde
      await updateDoc(doc(db, 'fiches', f.id), { shared: false });
      await loadFiches();
    },
  });
}

// ---------- partage d'un dossier (une classe, ou une matière) ----------
const itemOf = (f) => ({ id: f.id, title: f.title, matiere: f.matiere, cours: f.cours, mime: f.mime });

async function openFolderShare(classe, matiere) {
  await requireOnline();
  const items = state.fiches.filter((f) => f.classe === classe && (!matiere || f.matiere === matiere));
  if (!items.length) throw new Error('Aucune fiche dans ce dossier');
  if (items.length > 100) throw new Error('100 fiches maximum par lien');
  const label = matiere ? `${classe} › ${matiere}` : classe;
  const existing = state.folders.find((x) => x.classe === classe && (x.matiere || '') === (matiere || ''));
  const token = existing ? existing.id : doc(collection(db, 'folderShares')).id;

  const batch = writeBatch(db);
  for (const f of items) {
    batch.set(doc(db, 'shares', f.id), sharePayload(f)); // chaque fiche du dossier devient lisible avec le lien
    if (!(f.folders || []).includes(token)) batch.update(doc(db, 'fiches', f.id), { folders: arrayUnion(token) });
  }
  batch.set(doc(db, 'folderShares', token), {
    ownerId: state.user.uid, ownerName: state.user.name, label, classe, matiere: matiere || '',
    items: items.map(itemOf), createdAt: existing ? existing.createdAt : Date.now(),
  });
  await batch.commit();
  await loadFiches();
  await loadFolders();

  openShare({
    title: `Partager « ${label} »`,
    hint: `Un seul lien pour ${plural(items.length)}. Les fiches ajoutées plus tard s'ajoutent quand tu rouvres ce partage.`,
    url: `${location.origin}/f/${token}`,
    shareText: `Mes fiches de révision – ${label}`,
    unshareLabel: 'Désactiver le lien du dossier',
    onUnshare: async () => {
      await requireOnline();
      const b = writeBatch(db);
      for (const f of state.fiches.filter((x) => (x.folders || []).includes(token))) {
        const rest = f.folders.filter((t) => t !== token);
        if (!f.shared && rest.length === 0) b.delete(doc(db, 'shares', f.id)); // plus aucun lien ne l'ouvre
        b.update(doc(db, 'fiches', f.id), { folders: rest });
      }
      b.delete(doc(db, 'folderShares', token));
      await b.commit();
      await loadFiches();
      await loadFolders();
    },
  });
}

// Garde la liste des fiches des dossiers partagés à jour après une modification ou une suppression.
export async function syncFolders() {
  for (const fo of state.folders) {
    const items = state.fiches.filter((f) => (f.folders || []).includes(fo.id));
    if (!items.length) await deleteDoc(doc(db, 'folderShares', fo.id));
    else await updateDoc(doc(db, 'folderShares', fo.id), { items: items.map(itemOf) });
  }
  await loadFolders();
}
