// Fabrique un PDF à partir de photos JPEG : une photo par page. Aucune bibliothèque nécessaire.
// pages : [{ bytes: Uint8Array (JPEG), w, h }]  →  Uint8Array (le PDF)
export function makePdf(pages) {
  const enc = new TextEncoder();
  const parts = [];
  let len = 0;
  const offs = [];
  const add = (x) => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    parts.push(b);
    len += b.length;
  };
  const n = pages.length;
  const pageObj = (i) => 3 + i * 3;
  const contObj = (i) => 4 + i * 3;
  const imgObj = (i) => 5 + i * 3;

  add('%PDF-1.4\n');
  add(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  offs[1] = len;
  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offs[2] = len;
  add(`2 0 obj\n<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>\nendobj\n`);

  pages.forEach((p, i) => {
    const W = 595.28; // largeur A4 en points ; la hauteur suit la photo
    const H = +((W * p.h) / p.w).toFixed(2);
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    offs[pageObj(i)] = len;
    add(`${pageObj(i)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${imgObj(i)} 0 R >> >> /Contents ${contObj(i)} 0 R >>\nendobj\n`);
    offs[contObj(i)] = len;
    add(`${contObj(i)} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    offs[imgObj(i)] = len;
    add(`${imgObj(i)} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);
    add(p.bytes);
    add('\nendstream\nendobj\n');
  });

  const total = 3 * n + 3;
  const xref = len;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let k = 1; k < total; k++) x += `${String(offs[k]).padStart(10, '0')} 00000 n \n`;
  add(x);
  add(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let o = 0;
  for (const b of parts) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}
