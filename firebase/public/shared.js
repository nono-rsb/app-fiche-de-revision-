import { db, storage } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { ref, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

const box = document.getElementById('box');
const id = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');

(async () => {
  try {
    const snap = await getDoc(doc(db, 'shares', id));
    if (!snap.exists()) throw new Error('Lien invalide ou désactivé');
    const f = snap.data();
    const url = await getDownloadURL(ref(storage, `fiches/${f.ownerId}/${id}`));
    document.title = `${f.title} – Révise apps`;
    const h = document.createElement('h2');
    h.textContent = f.title;
    const tags = document.createElement('div');
    tags.className = 'tags';
    for (const t of [f.classe, f.matiere, f.cours]) {
      const s = document.createElement('span');
      s.className = 'tag';
      s.textContent = t;
      tags.append(s);
    }
    const by = document.createElement('p');
    by.style.color = 'var(--muted)';
    by.textContent = `Partagée par ${f.ownerName}`;
    const view = document.createElement('div');
    view.className = 'viewer';
    if (f.mime === 'application/pdf') {
      const i = document.createElement('iframe');
      i.src = url;
      i.title = f.title;
      view.append(i);
    } else {
      const i = document.createElement('img');
      i.src = url;
      i.alt = f.title;
      view.append(i);
    }
    const dl = document.createElement('a');
    dl.className = 'btn';
    dl.href = url;
    dl.target = '_blank';
    dl.rel = 'noopener';
    dl.textContent = 'Ouvrir dans un nouvel onglet';
    dl.style.marginTop = '12px';
    box.replaceChildren(h, tags, by, view, dl);
  } catch (e) {
    box.textContent = e.code === 'permission-denied' || e.code === 'storage/unauthorized' ? 'Lien invalide ou désactivé' : e.message || 'Lien invalide ou désactivé';
  }
})();
