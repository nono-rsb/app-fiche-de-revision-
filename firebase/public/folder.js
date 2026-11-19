// Page d'un dossier partagé : liste des fiches, chacune s'ouvre sur sa page de partage.
import { db } from './firebase.js';
import { doc, getDoc } from './vendor/firebase.js';

const box = document.getElementById('box');
const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');

const node = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  n.append(...kids);
  return n;
};

(async () => {
  try {
    const snap = await getDoc(doc(db, 'folderShares', token));
    if (!snap.exists()) throw new Error('Lien invalide ou désactivé');
    const f = snap.data();
    document.title = `${f.label} – Révise apps`;

    const byCours = new Map();
    for (const it of f.items) {
      const k = `${it.matiere} › ${it.cours}`;
      if (!byCours.has(k)) byCours.set(k, []);
      byCours.get(k).push(it);
    }
    const sections = [...byCours]
      .sort((a, b) => a[0].localeCompare(b[0], 'fr', { numeric: true }))
      .map(([k, items]) =>
        node('div', {},
          node('h3', { className: 'sect', textContent: k }),
          node('div', { className: 'flist' },
            ...items.map((it) =>
              node('a', { className: 'fiche', href: `/s/${encodeURIComponent(it.id)}` },
                node('span', { className: 'ico', textContent: it.mime === 'application/pdf' ? '📄' : '🖼️' }),
                node('div', { className: 'meta' }, node('strong', { textContent: it.title }), node('small', { textContent: 'Ouvrir la fiche' }))
              )
            )
          )
        )
      );
    box.replaceChildren(
      node('h2', { textContent: f.label }),
      node('p', { style: 'color:var(--muted)', textContent: `Partagé par ${f.ownerName} · ${f.items.length} fiche${f.items.length > 1 ? 's' : ''}` }),
      ...sections
    );
  } catch (e) {
    box.textContent = e.code === 'permission-denied' ? 'Lien invalide ou désactivé' : e.message || 'Lien invalide ou désactivé';
  }
})();
