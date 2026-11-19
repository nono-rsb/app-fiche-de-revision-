// Teste firestore.rules avec l'émulateur Firebase.
// Lancer : npm run test:rules   (Java requis ; sous Windows/macOS/Linux, avec l'émulateur Firestore)
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where, writeBatch, Bytes } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'revisapp-bcc73',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

const lea = env.authenticatedContext('lea').firestore();
const tom = env.authenticatedContext('tom').firestore();
const anon = env.unauthenticatedContext().firestore();

const fiche = (o = {}) => ({
  ownerId: 'lea', title: 'Pythagore', classe: '3e', matiere: 'Maths', cours: 'Pythagore',
  originalName: 'p.pdf', mime: 'application/pdf', size: 1000, chunks: 2, shared: false, createdAt: Date.now(), ...o,
});
const share = (o = {}) => ({
  ownerId: 'lea', ownerName: 'Léa', title: 'Pythagore', classe: '3e', matiere: 'Maths', cours: 'Pythagore',
  originalName: 'p.pdf', mime: 'application/pdf', chunks: 2, createdAt: Date.now(), ...o,
});
const chunk = (o = {}) => ({ ownerId: 'lea', data: Bytes.fromUint8Array(new Uint8Array(1000)), ...o });
let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`, ++n && '');

// ----- fiches -----
await assertSucceeds(setDoc(doc(lea, 'fiches/f1'), fiche())); ok('Léa crée sa fiche');
await assertFails(setDoc(doc(tom, 'fiches/f2'), fiche())); ok('Tom ne peut pas créer une fiche au nom de Léa');
await assertFails(setDoc(doc(anon, 'fiches/f3'), fiche())); ok('anonyme ne peut pas créer');
await assertFails(setDoc(doc(lea, 'fiches/f4'), fiche({ mime: 'text/html' }))); ok('type HTML refusé');
await assertFails(setDoc(doc(lea, 'fiches/f5'), fiche({ size: 6 * 1024 * 1024 }))); ok('fichier > 5 Mo refusé');
await assertFails(setDoc(doc(lea, 'fiches/f5b'), fiche({ chunks: 99 }))); ok('trop de morceaux refusé');
await assertFails(setDoc(doc(lea, 'fiches/f6'), fiche({ title: '' }))); ok('titre vide refusé');
await assertFails(setDoc(doc(lea, 'fiches/f7'), { ...fiche(), extra: 'x' })); ok('champ inconnu refusé');
await assertSucceeds(getDoc(doc(lea, 'fiches/f1'))); ok('Léa lit sa fiche');
await assertFails(getDoc(doc(tom, 'fiches/f1'))); ok('Tom ne lit pas la fiche de Léa');
await assertFails(getDoc(doc(anon, 'fiches/f1'))); ok('anonyme ne lit pas la fiche');
await assertSucceeds(getDocs(query(collection(lea, 'fiches'), where('ownerId', '==', 'lea')))); ok('Léa liste ses fiches');
await assertFails(getDocs(query(collection(tom, 'fiches'), where('ownerId', '==', 'lea')))); ok('Tom ne peut pas lister celles de Léa');
await assertFails(getDocs(collection(tom, 'fiches'))); ok('liste globale refusée');
await assertFails(updateDoc(doc(tom, 'fiches/f1'), { title: 'piraté' })); ok('Tom ne modifie pas');
await assertFails(updateDoc(doc(lea, 'fiches/f1'), { ownerId: 'tom' })); ok('on ne peut pas changer de propriétaire');

// ----- morceaux du fichier -----
await assertSucceeds(setDoc(doc(lea, 'fiches/f1/chunks/0'), chunk())); ok('Léa envoie le morceau 0');
const b = writeBatch(lea); b.set(doc(lea, 'fiches/f1/chunks/1'), chunk());
await assertSucceeds(b.commit()); ok('Léa envoie le morceau 1 (en lot)');
await assertFails(setDoc(doc(lea, 'fiches/f1/chunks/2'), chunk())); ok('morceau au-delà du nombre annoncé refusé');
await assertFails(setDoc(doc(lea, 'fiches/f1/chunks/abc'), chunk())); ok('numéro de morceau invalide refusé');
await assertFails(setDoc(doc(lea, 'fiches/f1/chunks/0'), chunk())); ok('un morceau ne peut pas être réécrit');
await assertFails(setDoc(doc(tom, 'fiches/f1/chunks/9'), chunk({ ownerId: 'tom' }))); ok('Tom ne peut pas écrire dans la fiche de Léa');
await assertFails(setDoc(doc(lea, 'fiches/inconnue/chunks/0'), chunk())); ok('pas de morceau sans fiche');
await assertFails(setDoc(doc(lea, 'fiches/f1/chunks/x'), { ...chunk(), data: Bytes.fromUint8Array(new Uint8Array(960000)) })); ok('morceau > 950 Ko refusé');
await assertFails(setDoc(doc(lea, 'fiches/f1/chunks/y'), { ...chunk(), extra: 1 })); ok('champ inconnu refusé dans un morceau');
await assertSucceeds(getDoc(doc(lea, 'fiches/f1/chunks/0'))); ok('Léa lit son fichier');
await assertFails(getDoc(doc(tom, 'fiches/f1/chunks/0'))); ok('Tom ne lit pas le fichier non partagé');
await assertFails(getDoc(doc(anon, 'fiches/f1/chunks/0'))); ok('anonyme ne lit pas le fichier non partagé');
await assertFails(getDocs(collection(lea, 'fiches/f1/chunks'))); ok('liste des morceaux refusée');

// ----- partage -----
await assertSucceeds(updateDoc(doc(lea, 'fiches/f1'), { shared: true })); ok('Léa marque la fiche partagée');
await assertSucceeds(setDoc(doc(lea, 'shares/f1'), share())); ok('Léa crée le lien de partage');
await assertFails(setDoc(doc(tom, 'shares/f1'), share({ ownerId: 'tom', ownerName: 'Tom' }))); ok('Tom ne peut pas partager la fiche de Léa');
await assertFails(setDoc(doc(lea, 'shares/inconnue'), share())); ok('pas de partage sans fiche correspondante');
await assertSucceeds(getDoc(doc(anon, 'shares/f1'))); ok('anonyme lit la fiche partagée avec le lien');
await assertSucceeds(getDoc(doc(anon, 'fiches/f1/chunks/0'))); ok('anonyme lit le fichier partagé (morceau 0)');
await assertSucceeds(getDoc(doc(tom, 'fiches/f1/chunks/1'))); ok('un autre utilisateur lit le fichier partagé (morceau 1)');
await assertFails(getDocs(collection(anon, 'shares'))); ok('anonyme ne peut pas lister les partages');
await assertFails(getDoc(doc(anon, 'fiches/f1'))); ok('la fiche elle-même reste privée');
await assertFails(deleteDoc(doc(tom, 'shares/f1'))); ok('Tom ne supprime pas le partage');

await deleteDoc(doc(lea, 'shares/f1'));
await assertFails(getDoc(doc(anon, 'fiches/f1/chunks/0'))); ok('lien désactivé : le fichier n\'est plus lisible');

// ----- champs facultatifs d'une fiche : miniature, favori, dossiers -----
await assertSucceeds(setDoc(doc(lea, 'fiches/f10'), fiche({ thumb: 'data:image/jpeg;base64,AAAA', favorite: true, folders: [] }))); ok('fiche avec miniature, favori et dossiers');
await assertFails(setDoc(doc(lea, 'fiches/f11'), fiche({ thumb: 'x'.repeat(30001) }))); ok('miniature trop grosse refusée');
await assertFails(setDoc(doc(lea, 'fiches/f12'), fiche({ favorite: 'oui' }))); ok('favori non booléen refusé');
await assertFails(setDoc(doc(lea, 'fiches/f13'), fiche({ folders: 'abc' }))); ok('dossiers non liste refusé');
await assertSucceeds(updateDoc(doc(lea, 'fiches/f10'), { favorite: false, title: 'Renommée', classe: '4e' })); ok('Léa modifie titre, classe et favori');
await assertFails(updateDoc(doc(lea, 'fiches/f10'), { classe: '' })); ok('classe vide refusée à la modification');
await assertFails(updateDoc(doc(tom, 'fiches/f10'), { favorite: true })); ok('Tom ne modifie pas un favori');

// ----- partage d'un dossier -----
const folder = (o = {}) => ({
  ownerId: 'lea', ownerName: 'Léa', label: '3e › Maths', classe: '3e', matiere: 'Maths',
  items: [{ id: 'f1', title: 'Pythagore', matiere: 'Maths', cours: 'Pythagore', mime: 'application/pdf' }], createdAt: Date.now(), ...o,
});
await assertSucceeds(setDoc(doc(lea, 'folderShares/tok1'), folder())); ok('Léa partage un dossier');
await assertFails(setDoc(doc(tom, 'folderShares/tok2'), folder())); ok('Tom ne partage pas au nom de Léa');
await assertFails(setDoc(doc(lea, 'folderShares/tok3'), folder({ items: [] }))); ok('dossier vide refusé');
await assertFails(setDoc(doc(lea, 'folderShares/tok4'), folder({ items: Array.from({ length: 101 }, (_, i) => ({ id: 'x' + i })) }))); ok('plus de 100 fiches refusé');
await assertSucceeds(getDoc(doc(anon, 'folderShares/tok1'))); ok('anonyme lit un dossier avec le lien');
await assertFails(getDocs(collection(anon, 'folderShares'))); ok('anonyme ne liste pas les dossiers');
await assertFails(getDocs(collection(tom, 'folderShares'))); ok('Tom ne liste pas non plus');
await assertSucceeds(getDocs(query(collection(lea, 'folderShares'), where('ownerId', '==', 'lea')))); ok('Léa liste ses dossiers partagés');
await assertFails(deleteDoc(doc(tom, 'folderShares/tok1'))); ok('Tom ne supprime pas le dossier');
await assertSucceeds(updateDoc(doc(lea, 'folderShares/tok1'), { label: '3e › Maths (à jour)' })); ok('Léa met à jour son dossier');
await assertSucceeds(deleteDoc(doc(lea, 'folderShares/tok1'))); ok('Léa désactive le lien du dossier');

// ----- cartes de révision -----
const card = (o = {}) => ({
  ownerId: 'lea', classe: '3e', matiere: 'Maths', cours: 'Pythagore', question: 'a² + b² = ?', answer: 'c²',
  box: 1, due: Date.now(), reviews: 0, createdAt: Date.now(), ...o,
});
await assertSucceeds(setDoc(doc(lea, 'cards/c1'), card())); ok('Léa crée une carte');
await assertFails(setDoc(doc(tom, 'cards/c2'), card())); ok('Tom ne crée pas de carte au nom de Léa');
await assertFails(setDoc(doc(anon, 'cards/c3'), card())); ok('anonyme ne crée pas de carte');
await assertFails(setDoc(doc(lea, 'cards/c4'), card({ question: '' }))); ok('question vide refusée');
await assertFails(setDoc(doc(lea, 'cards/c5'), card({ box: 6 }))); ok('boîte 6 refusée');
await assertFails(setDoc(doc(lea, 'cards/c6'), card({ answer: 'x'.repeat(1001) }))); ok('réponse trop longue refusée');
await assertFails(setDoc(doc(lea, 'cards/c7'), { ...card(), extra: 1 })); ok('champ inconnu refusé dans une carte');
await assertSucceeds(getDoc(doc(lea, 'cards/c1'))); ok('Léa lit sa carte');
await assertFails(getDoc(doc(tom, 'cards/c1'))); ok('Tom ne lit pas la carte de Léa');
await assertFails(getDoc(doc(anon, 'cards/c1'))); ok('anonyme ne lit pas la carte');
await assertSucceeds(getDocs(query(collection(lea, 'cards'), where('ownerId', '==', 'lea')))); ok('Léa liste ses cartes');
await assertFails(getDocs(collection(tom, 'cards'))); ok('liste globale des cartes refusée');
await assertSucceeds(updateDoc(doc(lea, 'cards/c1'), { box: 2, due: Date.now() + 86400000, reviews: 1 })); ok('Léa fait avancer sa carte');
await assertFails(updateDoc(doc(tom, 'cards/c1'), { box: 5 })); ok('Tom ne modifie pas la carte');
await assertFails(updateDoc(doc(lea, 'cards/c1'), { ownerId: 'tom' })); ok('on ne peut pas donner sa carte');
await assertFails(deleteDoc(doc(tom, 'cards/c1'))); ok('Tom ne supprime pas la carte');
await assertSucceeds(deleteDoc(doc(lea, 'cards/c1'))); ok('Léa supprime sa carte');

// ----- suppression -----
await assertFails(deleteDoc(doc(tom, 'fiches/f1/chunks/0'))); ok('Tom ne supprime pas un morceau');
const d = writeBatch(lea); d.delete(doc(lea, 'fiches/f1/chunks/0')); d.delete(doc(lea, 'fiches/f1/chunks/1'));
await assertSucceeds(d.commit()); ok('Léa supprime les morceaux');
await assertSucceeds(deleteDoc(doc(lea, 'fiches/f1'))); ok('Léa supprime la fiche');

await env.cleanup();
console.log(`\nOK – ${n} vérifications de règles`);
