// Fichiers des fiches : préparation (photos réduites, PDF assemblé) et stockage dans Firestore
// (pas de Cloud Storage, donc pas de carte bancaire). Un fichier = des morceaux de < 1 Mo dans
// fiches/{id}/chunks/{n}, car un document Firestore est limité à 1 Mo.
import { db } from './firebase.js';
import { doc, getDoc, writeBatch, Bytes } from './vendor/firebase.js';
import { makePdf } from './pdf.js';

export const CHUNK_SIZE = 900 * 1000;
export const MAX_FILE_SIZE = 5 * 1024 * 1024;
export const MAX_PAGES = 30;
const isImage = (f) => (f.type || '').startsWith('image/');

async function decode(file) {
  try {
    return await createImageBitmap(file); // respecte l'orientation de la photo
  } catch {
    throw new Error("Cette image n'a pas pu être lue. Essaie en JPG ou PNG.");
  }
}

async function toJpeg(bitmap, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // fond blanc pour les PNG transparents
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error("Cette image n'a pas pu être convertie.");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}

// Petite image (≈ 5 Ko) rangée dans la fiche, pour la liste.
function thumbOf(bitmap) {
  const scale = Math.min(1, 150 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.6);
}

// Un PDF seul, ou une ou plusieurs photos (plusieurs photos = un seul PDF, une page par photo).
// Renvoie { bytes, mime, thumb, pages, name }.
export async function prepareFiles(files) {
  if (!files.length) throw new Error('Ajoute un PDF ou une photo');
  const pdfs = files.filter((f) => f.type === 'application/pdf');
  if (pdfs.length) {
    if (files.length > 1) throw new Error('Un seul PDF à la fois, ou plusieurs photos.');
    const f = pdfs[0];
    if (!f.size) throw new Error('Ce fichier est vide.');
    if (f.size > MAX_FILE_SIZE) throw new Error('PDF trop gros (5 Mo max). Compresse-le ou envoie des photos.');
    return { bytes: new Uint8Array(await f.arrayBuffer()), mime: 'application/pdf', thumb: null, pages: null, name: f.name };
  }
  if (!files.every(isImage)) throw new Error('Formats acceptés : PDF, JPG, PNG, WEBP, GIF');
  if (files.length > MAX_PAGES) throw new Error(`${MAX_PAGES} pages au maximum par fiche.`);

  const bitmaps = [];
  for (const f of files) bitmaps.push(await decode(f));
  const thumb = thumbOf(bitmaps[0]);

  if (bitmaps.length === 1) {
    for (const [side, q] of [[1600, 0.78], [1400, 0.66], [1200, 0.55], [1000, 0.45]]) { // net pour du texte, léger à envoyer
      const j = await toJpeg(bitmaps[0], side, q);
      if (j.bytes.length <= MAX_FILE_SIZE) return { bytes: j.bytes, mime: 'image/jpeg', thumb, pages: 1, name: files[0].name };
    }
    throw new Error('Image trop lourde, même réduite.');
  }
  for (const [side, q] of [[1600, 0.72], [1400, 0.65], [1200, 0.58], [1000, 0.5], [800, 0.45]]) {
    const pages = [];
    for (const b of bitmaps) pages.push(await toJpeg(b, side, q));
    const pdf = makePdf(pages);
    if (pdf.length <= MAX_FILE_SIZE) return { bytes: pdf, mime: 'application/pdf', thumb, pages: pages.length, name: `${pages.length} photos.pdf` };
  }
  throw new Error('Ces photos sont trop lourdes pour une seule fiche (5 Mo max). Retire-en quelques-unes.');
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
