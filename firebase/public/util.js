import { db } from './firebase.js';
import { doc, getDocFromServer } from './vendor/firebase.js';

export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  n.append(...children);
  return n;
}

export function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2400);
}

export const clean = (v, max = 100) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
export const uniq = (arr) => [...new Set(arr)].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
export const plural = (n, word = 'fiche') => `${n} ${word}${n > 1 ? 's' : ''}`;
export const byFr = (a, b) => a.localeCompare(b, 'fr', { numeric: true });

const AUTH_ERRORS = {
  'auth/email-already-in-use': 'Un compte existe déjà avec cet email',
  'auth/invalid-email': 'Email invalide',
  'auth/weak-password': 'Mot de passe : 8 caractères minimum',
  'auth/invalid-credential': 'Email ou mot de passe incorrect',
  'auth/user-not-found': 'Email ou mot de passe incorrect',
  'auth/wrong-password': 'Email ou mot de passe incorrect',
  'auth/too-many-requests': 'Trop de tentatives, réessaie plus tard.',
  'auth/network-request-failed': 'Problème de connexion, réessaie.',
  'auth/requires-recent-login': 'Reconnecte-toi puis réessaie.',
};

export function errMsg(e) {
  if (AUTH_ERRORS[e.code]) return AUTH_ERRORS[e.code];
  if (e.code === 'permission-denied') return 'Action non autorisée';
  if (e.code === 'unavailable') return 'Hors connexion : réessaie quand tu auras du réseau.';
  return e.message || 'Erreur';
}

// Les écritures Firestore restent en attente hors connexion : on les refuse proprement.
// navigator.onLine ne suffit pas (Wi-Fi sans accès, etc.) : on interroge vraiment Firebase.
const OFFLINE = 'Hors connexion : cette action demande du réseau.';
export async function requireOnline() {
  if (!navigator.onLine) throw new Error(OFFLINE);
  try {
    await getDocFromServer(doc(db, 'cards', 'ping')); // le document n'existe pas : on veut seulement savoir si Firebase répond
  } catch (e) {
    if (e.code === 'unavailable') throw new Error(OFFLINE);
  }
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Se souvient des groupes (details) que l'utilisateur a ouverts ou refermés, d'un affichage à l'autre.
const opened = new Map();
export function remember(details, key, defaultOpen) {
  details.open = opened.has(key) ? opened.get(key) : defaultOpen;
  let byUser = false;
  details.firstElementChild.addEventListener('click', () => { byUser = true; });
  details.addEventListener('toggle', () => {
    if (byUser) opened.set(key, details.open);
    byUser = false;
  });
}
