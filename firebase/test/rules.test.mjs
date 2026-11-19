// Teste firestore.rules et storage.rules avec l'émulateur Firebase.
// Lancer : npx firebase emulators:exec --only firestore,storage "node test/rules.test.mjs"
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

const env = await initializeTestEnvironment({
  projectId: 'demo-revise',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
});

const lea = env.authenticatedContext('lea').firestore();
const leaSt = env.authenticatedContext('lea').storage();
const tom = env.authenticatedContext('tom').firestore();
const tomSt = env.authenticatedContext('tom').storage();
const anon = env.unauthenticatedContext().firestore();
const anonSt = env.unauthenticatedContext().storage();

const fiche = (o = {}) => ({
  ownerId: 'lea', title: 'Pythagore', classe: '3e', matiere: 'Maths', cours: 'Pythagore',
  originalName: 'p.pdf', mime: 'application/pdf', size: 1000, shared: false, createdAt: Date.now(), ...o,
});
const share = (o = {}) => ({
  ownerId: 'lea', ownerName: 'Léa', title: 'Pythagore', classe: '3e', matiere: 'Maths', cours: 'Pythagore',
  originalName: 'p.pdf', mime: 'application/pdf', createdAt: Date.now(), ...o,
});
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
let n = 0;
const ok = (name) => console.log(`  ✓ ${name}`, ++n && '');

// ----- Firestore : fiches -----
await assertSucceeds(setDoc(doc(lea, 'fiches/f1'), fiche())); ok('Léa crée sa fiche');
await assertFails(setDoc(doc(tom, 'fiches/f2'), fiche())); ok('Tom ne peut pas créer une fiche au nom de Léa');
await assertFails(setDoc(doc(anon, 'fiches/f3'), fiche())); ok('anonyme ne peut pas créer');
await assertFails(setDoc(doc(lea, 'fiches/f4'), fiche({ mime: 'text/html' }))); ok('type HTML refusé');
await assertFails(setDoc(doc(lea, 'fiches/f5'), fiche({ size: 30 * 1024 * 1024 }))); ok('fichier > 20 Mo refusé');
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
await assertSucceeds(updateDoc(doc(lea, 'fiches/f1'), { shared: true })); ok('Léa marque la fiche partagée');

// ----- Firestore : partages -----
await assertSucceeds(setDoc(doc(lea, 'shares/f1'), share())); ok('Léa crée le lien de partage');
await assertFails(setDoc(doc(tom, 'shares/f1'), share({ ownerId: 'tom', ownerName: 'Tom' }))); ok('Tom ne peut pas partager la fiche de Léa');
await assertFails(setDoc(doc(lea, 'shares/inconnue'), share())); ok('pas de partage sans fiche correspondante');
await assertSucceeds(getDoc(doc(anon, 'shares/f1'))); ok('anonyme lit un partage avec le lien');
await assertFails(getDocs(collection(anon, 'shares'))); ok('anonyme ne peut pas lister les partages');
await assertFails(deleteDoc(doc(tom, 'shares/f1'))); ok('Tom ne supprime pas le partage');

// ----- Storage -----
await assertSucceeds(uploadBytes(ref(leaSt, 'fiches/lea/f1'), pdf, { contentType: 'application/pdf' })); ok('Léa envoie un PDF');
await assertFails(uploadBytes(ref(leaSt, 'fiches/lea/f9'), pdf, { contentType: 'text/html' })); ok('HTML refusé dans Storage');
await assertFails(uploadBytes(ref(tomSt, 'fiches/lea/f8'), pdf, { contentType: 'application/pdf' })); ok('Tom ne dépose pas chez Léa');
await assertSucceeds(getBytes(ref(leaSt, 'fiches/lea/f1'))); ok('Léa lit son fichier');
await assertSucceeds(getBytes(ref(anonSt, 'fiches/lea/f1'))); ok('anonyme lit le fichier partagé');

await deleteDoc(doc(lea, 'shares/f1'));
await assertFails(getBytes(ref(anonSt, 'fiches/lea/f1'))); ok('lien désactivé : le fichier n\'est plus lisible');
await assertFails(getBytes(ref(tomSt, 'fiches/lea/f1'))); ok('Tom ne lit pas le fichier non partagé');
await assertFails(deleteObject(ref(tomSt, 'fiches/lea/f1'))); ok('Tom ne supprime pas le fichier');
await assertSucceeds(deleteObject(ref(leaSt, 'fiches/lea/f1'))); ok('Léa supprime son fichier');

await env.cleanup();
console.log(`\nOK – ${n} vérifications de règles`);
