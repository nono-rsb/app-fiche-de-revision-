// Stockage des fichiers dans Firestore (pas de Cloud Storage, donc pas de carte bancaire).
// Un fichier = des morceaux de < 1 Mo dans fiches/{id}/chunks/{n}, car un document Firestore est limité à 1 Mo.
import { db } from './firebase.js';
import {
  doc, getDoc, writeBatch, Bytes,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

export const CHUNK_SIZE = 900 * 1000;
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // après réduction des photos
const MAX_SIDE = 1800; // côté max d'une photo, en pixels
const IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Prépare le fichier choisi : PDF tel quel (taille contrôlée), photo réduite et convertie en JPEG.
export async function prepareFile(file) {
  if (!file.size) throw new Error('Ce fichier est vide.');
  if (file.type === 'application/pdf') {
    if (file.size > MAX_FILE_SIZE) throw new Error('PDF trop gros (5 Mo max). Compresse-le ou envoie des photos.');
    return { bytes: new Uint8Array(await file.arrayBuffer()), mime: 'application/pdf' };
  }
  if (!IMAGES.includes(file.type)) throw new Error('Formats acceptés : PDF, JPG, PNG, WEBP, GIF');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Cette image n'a pas pu être lue. Essaie en JPG ou PNG.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // fond blanc pour les PNG transparents
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_FILE_SIZE) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' };
  }
  throw new Error('Image trop lourde, même réduite.');
}

// À appeler une fois le document fiches/{id} créé (les règles vérifient qu'il existe et qu'il t'appartient).
export async function saveFile(id, ownerId, bytes) {
  const batch = writeBatch(db);
  for (let i = 0, n = 0; i < bytes.length; i += CHUNK_SIZE, n++) {
    batch.set(doc(db, 'fiches', id, 'chunks', String(n)), {
      ownerId,
      data: Bytes.fromUint8Array(bytes.subarray(i, i + CHUNK_SIZE)),
    });
  }
  await batch.commit();
}

// Lit tous les morceaux (propriétaire, ou n'importe qui si la fiche est partagée) et recompose le fichier.
export async function loadFileBlob(id, chunks, mime) {
  const snaps = await Promise.all(
    Array.from({ length: chunks }, (_, n) => getDoc(doc(db, 'fiches', id, 'chunks', String(n))))
  );
  if (snaps.some((s) => !s.exists())) throw new Error('Fichier introuvable');
  return new Blob(snaps.map((s) => s.data().data.toUint8Array()), { type: mime });
}

export async function deleteFile(id, chunks) {
  const batch = writeBatch(db);
  for (let n = 0; n < chunks; n++) batch.delete(doc(db, 'fiches', id, 'chunks', String(n)));
  await batch.commit();
}
