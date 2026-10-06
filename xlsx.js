// Lazy loaders for the file-reading libraries (Excel, PDF, Word). They load from a CDN only when needed.
const load = (key, src) => new Promise((res, rej) => {
  if (window[key]) return res(window[key]);
  const s = document.createElement('script'); s.src = src; s.onload = () => res(window[key]); s.onerror = () => rej(new Error('Could not load a file reader. Check your internet connection.')); document.head.append(s);
});
export const loadXLSX = () => load('XLSX', 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
export const loadMammoth = () => load('mammoth', 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
export async function loadPdfJs() {
  const lib = await load('pdfjsLib', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return lib;
}
// Plain text out of a PDF (lines rebuilt from the position of each piece of text)
export async function pdfText(file) {
  const pdfjs = await loadPdfJs(); const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise; let out = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const items = (await (await doc.getPage(p)).getTextContent()).items.filter((i) => i.str && i.str.trim() !== '');
    const lines = []; for (const it of items) { const y = Math.round(it.transform[5] / 4); let l = lines.find((x) => Math.abs(x.y - y) <= 1); if (!l) lines.push(l = { y, parts: [] }); l.parts.push({ x: it.transform[4], s: it.str }); }
    lines.sort((a, b) => b.y - a.y).forEach((l) => { out += l.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join('  ') + '\n'; });
  }
  return out;
}
export async function docxText(file) { const m = await loadMammoth(); return (await m.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value; }
export const sheetRows = (XLSX, ws) => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
