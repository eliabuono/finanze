/**
 * Estrazione del testo dai PDF con pdf.js, in "parole" con coordinate (come pdfplumber):
 * x0/x1 in punti dal bordo sinistro, top/bottom in punti dal bordo superiore.
 */
export interface Parola {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  y: number; // linea di base (dal basso), utile per raggruppare
}

export interface Pagina {
  width: number;
  height: number;
  parole: Parola[]; // tolleranza orizzontale 1.5 (come pdfplumber di default nell'app)
  parole3: Parola[]; // tolleranza 3 (usata dall'estratto conto Intesa)
  testo: string;
}

// pdf.js viene passato dall'esterno (browser: build normale con worker; Node: build legacy)
export type PdfJs = {
  getDocument: (src: any) => { promise: Promise<any> };
};

interface Pezzo {
  text: string;
  x0: number;
  x1: number;
  y: number;
  size: number;
  inizioRun: boolean; // primo pezzo del suo run di testo (nessuno spazio prima, dentro il run)
  fineRun: boolean;
}

type Larghezze = Map<string, Record<string, number>>; // font -> carattere -> larghezza in em

/** Larghezze dei glifi per font (da pdf.js), per collocare ogni parola dentro un blocco di testo. */
function larghezzeFont(pagina: any, nomi: string[]): Larghezze {
  const out: Larghezze = new Map();
  for (const n of nomi) {
    try {
      const f = pagina.commonObjs.get(n);
      const mappa: any[] = f?.toUnicode?._map ?? [];
      const scala = f?.fontMatrix?.[0] ?? 0.001;
      const w: Record<string, number> = {};
      mappa.forEach((u, code) => {
        if (u != null && w[u] === undefined) w[u] = (f.widths?.[code] ?? f.defaultWidth ?? 500) * scala;
      });
      if (Object.keys(w).length) out.set(n, w);
    } catch {
      /* font non disponibile: si usa la stima proporzionale */
    }
  }
  return out;
}

function pezziDaItem(it: any, larg: Larghezze): Pezzo[] {
  const s: string = it.str ?? "";
  if (!s.trim()) return [];
  const [, , c, d, e, f] = it.transform;
  const size = Math.hypot(c, d) || it.height || 6;
  const n = s.length;
  const w = it.width || 0;
  // posizione di ogni carattere: larghezze dei glifi, lo spazio residuo diviso tra gli spazi
  const lw = larg.get(it.fontName);
  const pos = new Array<number>(n + 1);
  pos[0] = 0;
  let ok = !!lw && w > 0;
  if (ok) {
    let somma = 0, spazi = 0;
    for (const ch of s) {
      if (ch === " ") spazi++;
      else if (lw![ch] === undefined) { ok = false; break; }
      else somma += lw![ch] * size;
    }
    const resto = w - somma;
    if (ok && (spazi ? resto >= -0.5 : Math.abs(resto) < Math.max(1, w * 0.05))) {
      const fattore = spazi ? 1 : w / (somma || 1);
      const sp = spazi ? Math.max(resto, 0) / spazi : 0;
      for (let i = 0; i < n; i++) pos[i + 1] = pos[i] + (s[i] === " " ? sp : lw![s[i]] * size * fattore);
    } else ok = false;
  }
  if (!ok) for (let i = 0; i <= n; i++) pos[i] = (w * i) / n;
  const out: Pezzo[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const a = m.index;
    const b = a + m[0].length;
    out.push({ text: m[0], x0: e + pos[a], x1: e + pos[b], y: f, size, inizioRun: a === 0, fineRun: b === n });
  }
  return out;
}

function unisci(pezzi: Pezzo[], tolX: number, altezza: number): Parola[] {
  // ordina per linea di base (dall'alto) e poi da sinistra
  const ord = [...pezzi].sort((p, q) => (Math.abs(p.y - q.y) < 1 ? p.x0 - q.x0 : q.y - p.y));
  const out: Parola[] = [];
  let prec: (Pezzo & { parola: Parola }) | null = null;
  for (const p of ord) {
    const stessaRiga = prec && Math.abs(prec.y - p.y) < 1;
    if (prec && stessaRiga && prec.fineRun && p.inizioRun && p.x0 - prec.parola.x1 <= tolX && p.x0 >= prec.parola.x0) {
      prec.parola.text += p.text;
      prec.parola.x1 = Math.max(prec.parola.x1, p.x1);
      prec = { ...p, parola: prec.parola };
      continue;
    }
    const top = altezza - p.y - p.size * 0.85;
    const parola: Parola = { text: p.text, x0: p.x0, x1: p.x1, top, bottom: altezza - p.y + p.size * 0.15, y: p.y };
    out.push(parola);
    prec = { ...p, parola };
  }
  return out;
}

/** Raggruppa parole in righe con tolleranza verticale, ordinate dall'alto e da sinistra. */
export function righe(ws: Parola[], tol = 2.5): Parola[][] {
  const out: Parola[][] = [];
  let cur: Parola[] = [];
  let top: number | null = null;
  for (const w of [...ws].sort((a, b) => a.top - b.top)) {
    if (top === null || w.top - top <= tol) {
      cur.push(w);
      if (top === null) top = w.top;
    } else {
      out.push(cur.sort((a, b) => a.x0 - b.x0));
      cur = [w];
      top = w.top;
    }
  }
  if (cur.length) out.push(cur.sort((a, b) => a.x0 - b.x0));
  return out;
}

export async function leggiPdf(pdfjs: PdfJs, dati: Uint8Array): Promise<Pagina[]> {
  const doc = await pdfjs.getDocument({ data: dati, verbosity: 0, isEvalSupported: false, fontExtraProperties: true }).promise;
  const pagine: Pagina[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    const tc = await p.getTextContent();
    let larg: Larghezze = new Map();
    try {
      await p.getOperatorList(); // carica i font (serve per le larghezze dei glifi)
      larg = larghezzeFont(p, [...new Set<string>(tc.items.map((it: any) => it.fontName))]);
    } catch {
      /* si continua con la stima proporzionale */
    }
    const pezzi = tc.items.flatMap((it: any) => pezziDaItem(it, larg));
    const parole = unisci(pezzi, 1.5, vp.height);
    const parole3 = unisci(pezzi, 3, vp.height);
    const testo = righe(parole, 2.5)
      .map((r) => r.map((w) => w.text).join(" "))
      .join("\n");
    pagine.push({ width: vp.width, height: vp.height, parole, parole3, testo });
    p.cleanup?.();
  }
  await doc.destroy?.();
  return pagine;
}
