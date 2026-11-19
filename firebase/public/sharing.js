// Fenêtre de partage par lien : adresse à copier, partage natif de l'iPhone, QR code, désactivation.
import { qrcode } from './vendor/firebase.js';
import { $, toast } from './util.js';

const dialog = $('shareDialog');

export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true, alt: 'QR code du lien de partage' });
}

// { title, hint, url, shareText, unshareLabel, onUnshare }
export function openShare({ title, hint, url, shareText, unshareLabel = 'Désactiver le lien', onUnshare }) {
  $('shareTitle').textContent = title;
  $('shareHint').textContent = hint;
  $('shareUrl').value = url;
  $('qr').innerHTML = qrSvg(url); // SVG produit par la bibliothèque à partir de notre adresse
  $('nativeShareBtn').hidden = !navigator.share;
  $('nativeShareBtn').onclick = async () => {
    try {
      await navigator.share({ title: shareText, text: shareText, url });
    } catch {
      /* partage annulé : rien à faire */
    }
  };
  $('unshareBtn').textContent = unshareLabel;
  $('unshareBtn').onclick = async () => {
    try {
      await onUnshare();
      dialog.close();
      toast('Lien désactivé');
    } catch (err) {
      toast(err.message || 'Erreur');
    }
  };
  dialog.showModal();
  $('shareUrl').blur();
}

$('copyBtn').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('shareUrl').value);
    toast('Lien copié ✔');
  } catch {
    $('shareUrl').select();
    toast('Copie le lien avec Ctrl+C');
  }
};
$('shareClose').onclick = () => dialog.close();
