// Onglet « Réviser » : cartes question / réponse, répétition espacée (boîtes de Leitner), mode cartes ou QCM.
import { db } from './firebase.js';
import { collection, doc, query, where, getDocs, setDoc, updateDoc, deleteDoc } from './vendor/firebase.js';
import { $, el, toast, clean, plural, byFr, errMsg, requireOnline, shuffle, remember } from './util.js';
import { state } from './state.js';
import { refreshFilters } from './library.js';

const DAY = 86400000;
// Délai avant de revoir une carte, selon sa boîte (1 = ratée ou nouvelle : dans 10 minutes, 5 = bien sue : 14 jours).
export const DELAYS = [0, 10 * 60 * 1000, 1 * DAY, 3 * DAY, 7 * DAY, 14 * DAY];

export const isDue = (c, now = Date.now()) => c.due <= now;
// Réponse juste : on monte d'une boîte. Réponse fausse : retour à la boîte 1.
export function graded(c, ok, now = Date.now()) {
  const box = ok ? Math.min(5, c.box + 1) : 1;
  return { box, due: now + DELAYS[box], reviews: c.reviews + 1 };
}

let mode = 'cartes'; // 'cartes' | 'qcm'

export async function loadCards() {
  const snap = await getDocs(query(collection(db, 'cards'), where('ownerId', '==', state.user.uid)));
  state.cards = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt - b.createdAt);
  refreshFilters();
  renderReview();
}

const scopeKey = (c) => `${c.classe} › ${c.matiere} › ${c.cours}`;
const inScope = (c, scope) => !scope || scopeKey(c) === scope;

export function renderReview() {
  const cards = state.cards;
  const scopeSel = $('rScope');
  const cur = scopeSel.value;
  const scopes = [...new Set(cards.map(scopeKey))].sort(byFr);
  scopeSel.replaceChildren(el('option', { value: '', textContent: 'Toutes les cartes' }), ...scopes.map((s) => el('option', { value: s, textContent: s })));
  scopeSel.value = scopes.includes(cur) ? cur : '';
  const scope = scopeSel.value;

  const pool = cards.filter((c) => inScope(c, scope));
  const due = pool.filter((c) => isDue(c));
  $('rDue').textContent = String(due.length);
  $('rDueLabel').textContent = due.length > 1 ? 'cartes à réviser aujourd’hui' : 'carte à réviser aujourd’hui';
  $('rTotal').textContent = cards.length ? `${plural(pool.length, 'carte')} au total` : 'Aucune carte pour le moment';
  $('startBtn').disabled = due.length === 0;
  $('startBtn').textContent = due.length ? `Commencer (${due.length})` : 'Rien à réviser';
  $('startAllBtn').disabled = pool.length === 0;

  // répartition dans les 5 boîtes
  const counts = [1, 2, 3, 4, 5].map((b) => pool.filter((c) => c.box === b).length);
  const max = Math.max(1, ...counts);
  $('boxes').replaceChildren(
    ...counts.map((n, i) => {
      const bar = el('div', { className: 'boxbar' }, el('span', { className: 'boxn' + (n ? '' : ' zero'), textContent: String(n) }));
      bar.firstChild.style.setProperty('--h', `${Math.round((n / max) * 100)}%`);
      return el('div', { className: 'box' }, bar, el('span', { className: 'boxl', textContent: i === 0 ? 'À revoir' : i === 4 ? 'Sues' : `Boîte ${i + 1}` }));
    })
  );

  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));

  // liste des cartes, groupées par cours
  const byScope = new Map();
  for (const c of pool) {
    if (!byScope.has(scopeKey(c))) byScope.set(scopeKey(c), []);
    byScope.get(scopeKey(c)).push(c);
  }
  $('cardList').replaceChildren(
    ...(cards.length
      ? [...byScope].sort((a, b) => byFr(a[0], b[0])).map(([k, list]) => {
          const d = el('details', { className: 'group cours' });
          d.append(el('summary', {}, `📖 ${k}`, el('span', { className: 'count', textContent: plural(list.length, 'carte') })));
          d.append(el('div', { className: 'inner' }, ...list.map(cardRow)));
          remember(d, `r:${k}`, byScope.size <= 3);
          return d;
        })
      : [el('div', { className: 'empty', textContent: 'Crée tes premières cartes : une question au recto, la réponse au verso.' })])
  );
}

function cardRow(c) {
  const edit = el('button', { className: 'small', textContent: 'Modifier' });
  edit.onclick = () => openCardDialog(c);
  const del = el('button', { className: 'small danger', textContent: 'Supprimer' });
  del.onclick = async () => {
    if (!confirm('Supprimer cette carte ?')) return;
    try {
      await requireOnline();
      await deleteDoc(doc(db, 'cards', c.id));
      await loadCards();
    } catch (err) {
      toast(errMsg(err));
    }
  };
  return el('div', { className: 'fiche card-row' },
    el('div', { className: 'meta' }, el('strong', { textContent: c.question }), el('small', { textContent: `→ ${c.answer}` })),
    el('span', { className: `boxtag b${c.box}`, textContent: `Boîte ${c.box}` }),
    el('div', { className: 'actions' }, edit, del));
}

['rScope'].forEach((id) => $(id).addEventListener('input', renderReview));
document.querySelectorAll('#modeSeg button').forEach((b) => {
  b.onclick = () => { mode = b.dataset.mode; renderReview(); };
});

// ---------- créer / modifier une carte ----------
const cardDialog = $('cardDialog');
let editingCard = null;

export function openCardDialog(c = null) {
  editingCard = c;
  $('cardTitle').textContent = c ? 'Modifier la carte' : 'Nouvelle carte';
  $('cClasse').value = c ? c.classe : $('cClasse').value;
  $('cMatiere').value = c ? c.matiere : $('cMatiere').value;
  $('cCours').value = c ? c.cours : $('cCours').value;
  $('cQuestion').value = c ? c.question : '';
  $('cAnswer').value = c ? c.answer : '';
  $('cardError').textContent = '';
  $('cardAgain').hidden = !!c;
  cardDialog.showModal();
}
$('newCardBtn').onclick = () => openCardDialog();
$('cardCancel').onclick = () => cardDialog.close();

async function saveCard(keepOpen) {
  const f = {
    classe: clean($('cClasse').value), matiere: clean($('cMatiere').value), cours: clean($('cCours').value),
    question: clean($('cQuestion').value, 500), answer: clean($('cAnswer').value, 1000),
  };
  if (!f.classe || !f.matiere || !f.cours) return ($('cardError').textContent = 'Classe, matière et cours sont obligatoires');
  if (!f.question || !f.answer) return ($('cardError').textContent = 'Écris la question et la réponse');
  $('cardSubmit').disabled = $('cardAgain').disabled = true;
  try {
    await requireOnline();
    if (editingCard) {
      await updateDoc(doc(db, 'cards', editingCard.id), f);
    } else {
      const now = Date.now();
      await setDoc(doc(collection(db, 'cards')), { ownerId: state.user.uid, ...f, box: 1, due: now, reviews: 0, createdAt: now });
    }
    await loadCards();
    if (keepOpen) {
      $('cQuestion').value = '';
      $('cAnswer').value = '';
      $('cardError').textContent = '';
      $('cQuestion').focus();
      toast('Carte ajoutée ✔');
    } else {
      cardDialog.close();
      toast(editingCard ? 'Carte modifiée ✔' : 'Carte ajoutée ✔');
    }
  } catch (err) {
    $('cardError').textContent = errMsg(err);
  } finally {
    $('cardSubmit').disabled = $('cardAgain').disabled = false;
  }
}
$('cardForm').onsubmit = (e) => { e.preventDefault(); saveCard(false); };
$('cardAgain').onclick = () => saveCard(true);

// ---------- séance de révision ----------
const sessionDialog = $('sessionDialog');
let session = null; // { queue, i, total, right, wrong, mode }

function startSession(cards) {
  if (!cards.length) return;
  session = { queue: shuffle(cards), i: 0, total: cards.length, right: 0, wrong: 0, mode };
  sessionDialog.showModal();
  showCard();
}
$('startBtn').onclick = () => startSession(state.cards.filter((c) => inScope(c, $('rScope').value) && isDue(c)));
$('startAllBtn').onclick = () => startSession(state.cards.filter((c) => inScope(c, $('rScope').value)));
$('sessionClose').onclick = () => { sessionDialog.close(); renderReview(); };
sessionDialog.addEventListener('close', () => renderReview());

// 3 mauvaises réponses prises sur d'autres cartes (de préférence de la même matière)
function distractors(c) {
  const others = state.cards.filter((x) => x.id !== c.id && x.answer !== c.answer);
  const uniqueAnswers = (list) => [...new Map(list.map((x) => [x.answer, x])).values()];
  const same = uniqueAnswers(shuffle(others.filter((x) => x.matiere === c.matiere)));
  const rest = uniqueAnswers(shuffle(others)).filter((x) => !same.some((s) => s.answer === x.answer));
  return [...same, ...rest].slice(0, 3).map((x) => x.answer);
}

function showCard() {
  const s = session;
  const c = s.queue[s.i];
  const area = $('sessionBody');
  if (!c) return finishSession();
  $('sessionProgress').textContent = `${Math.min(s.i + 1, s.queue.length)} / ${s.queue.length}`;
  $('sessionBar').style.setProperty('--p', `${(s.i / s.queue.length) * 100}%`);
  const q = el('p', { className: 'sq', textContent: c.question });
  const where = el('p', { className: 'swhere', textContent: scopeKey(c) });
  const wrong = s.mode === 'qcm' ? distractors(c) : [];

  if (s.mode === 'qcm' && wrong.length === 3) {
    const options = shuffle([c.answer, ...wrong]);
    const next = el('button', { className: 'primary full', textContent: 'Suivant', hidden: true });
    const buttons = options.map((text) => {
      const b = el('button', { className: 'opt', textContent: text });
      b.onclick = () => {
        const ok = text === c.answer;
        buttons.forEach((x) => { x.disabled = true; if (x.textContent === c.answer) x.classList.add('good'); });
        if (!ok) b.classList.add('bad');
        next.hidden = false;
        next.onclick = () => answer(c, ok);
        next.focus();
      };
      return b;
    });
    area.replaceChildren(where, q, el('div', { className: 'opts' }, ...buttons), next);
  } else {
    const a = el('p', { className: 'sa', textContent: c.answer, hidden: true });
    const reveal = el('button', { className: 'primary full', textContent: 'Afficher la réponse' });
    const row = el('div', { className: 'judge', hidden: true });
    const no = el('button', { className: 'danger', textContent: 'Je ne savais pas' });
    const yes = el('button', { className: 'primary', textContent: 'Je savais' });
    no.onclick = () => answer(c, false);
    yes.onclick = () => answer(c, true);
    row.append(no, yes);
    reveal.onclick = () => { a.hidden = false; reveal.hidden = true; row.hidden = false; yes.focus(); };
    area.replaceChildren(where, q, a, reveal, row);
  }
}

function answer(c, ok) {
  const s = session;
  if (c._again) {
    // Seconde chance après une erreur : on s'entraîne, mais la carte reste en boîte 1 pour la prochaine séance.
    s.i++;
    return showCard();
  }
  Object.assign(c, graded(c, ok));
  // Enregistré sans attendre le réseau : hors connexion, l'écriture part dès le retour du réseau.
  updateDoc(doc(db, 'cards', c.id), { box: c.box, due: c.due, reviews: c.reviews }).catch((err) => toast(errMsg(err)));
  if (ok) s.right++;
  else {
    s.wrong++;
    c._again = true;
    s.queue.push(c); // une seconde chance en fin de séance
  }
  s.i++;
  showCard();
}

function finishSession() {
  const s = session;
  state.cards.forEach((c) => delete c._again);
  $('sessionProgress').textContent = 'Terminé';
  $('sessionBar').style.setProperty('--p', '100%');
  $('sessionBody').replaceChildren(
    el('p', { className: 'sdone', textContent: s.wrong ? 'Bien joué, continue !' : 'Sans faute !' }),
    el('p', { className: 'swhere', textContent: `${s.right} ${s.right > 1 ? 'bonnes réponses' : 'bonne réponse'} · ${s.wrong} à revoir` }),
    el('p', { className: 'swhere', textContent: s.wrong ? 'Les cartes ratées reviennent à la prochaine séance.' : 'Reviens demain pour la suite.' })
  );
}
