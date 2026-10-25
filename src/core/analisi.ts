/** Calcoli: investimenti, saldi dei conti, entrate/uscite per categoria, simulazione (porting di analisi.py). */
import { aggiungiGiorni, fineMese, fineTrimestre, giorniTra, intervallo, lavorativi, oggi as oggiIso, venerdi } from "./date";
import type { Movimento, SaldoNoto, Strumento } from "./tipi";

export interface Serie { giorni: string[]; [k: string]: any; }

// ================================================================== TIR
export function xirr(flussi: [string, number][]): number {
  if (flussi.length < 2) return NaN;
  const d0 = flussi.reduce((m, [d]) => (d < m ? d : m), flussi[0][0]);
  const t = flussi.map(([d, a]) => [giorniTra(d0, d) / 365, a] as const);
  const npv = (r: number) => t.reduce((s, [x, a]) => s + a * Math.pow(1 + r, -x), 0);
  let a = -0.99, b = 10, fa = npv(a), fb = npv(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2, fm = npv(m);
    if (Math.abs(fm) < 1e-9 || b - a < 1e-12) return m;
    if (fa * fm < 0) { b = m; fb = fm; } else { a = m; fa = fm; }
  }
  return (a + b) / 2;
}

// ================================================================== investimenti
export interface SerieStrumento {
  giorni: string[]; quote: number[]; prezzo: number[]; versato: number[]; valore: number[]; flussi: number[]; profitto: number[];
}
export interface RigaInvestimento {
  strumento: string; isin: string; classe: string; dal: string; quote: number; prezzo: number; versato: number;
  valore: number; guadagno: number; guadagnoPct: number; tir: number; twr: number; peso: number;
  obiettivo: number | null; scostamento: number | null;
}
export type FonteSerie = (isin: string, giorni: string[], implicito: Map<string, number>, manuale: number | null | undefined) => [number[], string];

export function serieDaPrezzi(prezzi: Record<string, number> | undefined, giorni: string[], implicito: Map<string, number>,
  manuale: number | null | undefined, fonteCache = "prezzi di mercato"): [number[], string] {
  let punti: [string, number][];
  let fonte: string;
  const dalla = prezzi ? Object.entries(prezzi).filter(([, v]) => Number.isFinite(v)) : [];
  if (dalla.length) { punti = dalla; fonte = fonteCache; }
  else { punti = [...implicito.entries()].filter(([, v]) => Number.isFinite(v)); fonte = "prezzo degli acquisti (prezzi di mercato non disponibili)"; }
  punti.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const out = new Array<number>(giorni.length).fill(NaN);
  let j = 0, ultimo = NaN;
  for (let i = 0; i < giorni.length; i++) {
    while (j < punti.length && punti[j][0] <= giorni[i]) { ultimo = punti[j][1]; j++; }
    out[i] = ultimo;
  }
  const primo = punti.length ? punti[0][1] : NaN; // prima del primo prezzo: il primo (bfill)
  for (let i = 0; i < out.length && Number.isNaN(out[i]); i++) out[i] = primo;
  if (manuale) { out[out.length - 1] = manuale; fonte += " + prezzo attuale manuale"; }
  return [out, fonte];
}

export function investimenti(mov: Movimento[], strumenti: Record<string, Strumento>, fonteSerie: FonteSerie, oggi = oggiIso()) {
  const t = mov.filter((m) => m.isin && m.quote !== null && Number.isFinite(m.quote));
  if (!t.length) return null;
  const date = [...new Set(t.map((m) => m.data))];
  const inizio = date.reduce((a, b) => (b < a ? b : a));
  const giorni = [...new Set([...lavorativi(inizio, oggi), ...date])].sort();
  const pos = new Map(giorni.map((d, i) => [d, i]));
  const serie: Record<string, SerieStrumento> = {};
  const righe: RigaInvestimento[] = [];
  const fonti: Record<string, string> = {};
  const isins = [...new Set(t.map((m) => m.isin))];
  for (const isin of isins) {
    const info = strumenti[isin] ?? ({} as Strumento);
    const nome = info.nome || isin;
    const perData = new Map<string, { q: number; v: number }>();
    for (const m of t) if (m.isin === isin) {
      const x = perData.get(m.data) ?? { q: 0, v: 0 };
      x.q += m.quote!; x.v += -m.importo;
      perData.set(m.data, x);
    }
    const implicito = new Map<string, number>();
    for (const [d, x] of perData) if (x.q > 0) implicito.set(d, x.v / x.q);
    const [p, fonte] = fonteSerie(isin, giorni, implicito, info.prezzo_manuale);
    fonti[nome] = fonte;
    const n = giorni.length;
    const s: SerieStrumento = { giorni, quote: [], prezzo: p, versato: [], valore: [], flussi: new Array(n).fill(0), profitto: [] };
    for (const [d, x] of perData) s.flussi[pos.get(d)!] += x.v;
    const flussiQ = new Array(n).fill(0);
    for (const [d, x] of perData) flussiQ[pos.get(d)!] += x.q;
    let q = 0, v = 0;
    for (let i = 0; i < n; i++) {
      q += flussiQ[i]; v += s.flussi[i];
      s.quote.push(q); s.versato.push(v);
      const val = q * (Number.isFinite(p[i]) ? p[i] : 0);
      s.valore.push(val); s.profitto.push(val - v);
    }
    serie[nome] = s;
    const fl: [string, number][] = [...perData.entries()].filter(([, x]) => x.v !== 0).map(([d, x]) => [d, x.v] as [string, number]);
    fl.push([oggi, -s.valore[n - 1]]);
    const dal = [...perData.keys()].sort()[0];
    righe.push({ strumento: nome, isin, classe: info.classe || "Altro", dal, quote: q, prezzo: p[n - 1], versato: v,
      valore: s.valore[n - 1], guadagno: s.valore[n - 1] - v, guadagnoPct: v ? (s.valore[n - 1] - v) / v : NaN,
      tir: xirr(fl), twr: twr(s.valore, s.flussi, giorni), peso: 0, obiettivo: info.obiettivo ?? null, scostamento: null });
  }
  const n = giorni.length;
  const tot: SerieStrumento = { giorni, quote: [], prezzo: [], versato: new Array(n).fill(0), valore: new Array(n).fill(0),
    flussi: new Array(n).fill(0), profitto: [] };
  for (const s of Object.values(serie)) for (let i = 0; i < n; i++) {
    tot.versato[i] += s.versato[i]; tot.valore[i] += s.valore[i]; tot.flussi[i] += s.flussi[i];
  }
  tot.profitto = tot.valore.map((v, i) => v - tot.versato[i]);
  const valTot = righe.reduce((a, r) => a + r.valore, 0);
  for (const r of righe) {
    r.peso = valTot ? r.valore / valTot : NaN;
    r.scostamento = r.obiettivo === null || r.obiettivo === undefined ? null : r.peso - r.obiettivo;
  }
  const flTot: [string, number][] = giorni.map((d, i) => [d, tot.flussi[i]] as [string, number]).filter(([, v]) => v !== 0);
  flTot.push([oggi, -tot.valore[n - 1]]);
  const vT = tot.versato[n - 1], valT = tot.valore[n - 1];
  const totale = { versato: vT, valore: valT, guadagno: valT - vT, guadagnoPct: vT ? (valT - vT) / vT : NaN,
    tir: xirr(flTot), twr: twr(tot.valore, tot.flussi, giorni) };
  return { righe, serie, tot, totale, fonti };
}

/** Rendimento time-weighted annualizzato (flussi a fine giornata). */
export function twr(v: number[], f: number[], giorni: string[]): number {
  let fattore = 1, inizio: string | null = null;
  for (let i = 1; i < v.length; i++) {
    if (v[i - 1] > 0) {
      fattore *= (v[i] - f[i]) / v[i - 1];
      inizio ??= giorni[i - 1];
    }
  }
  if (inizio === null) return NaN;
  const anni = giorniTra(inizio, giorni[giorni.length - 1]) / 365;
  return anni < 1 ? fattore - 1 : Math.pow(fattore, 1 / anni) - 1;
}

/** Indice time-weighted (base 100): l'andamento senza l'effetto dei versamenti. */
export function indiceRendimento(v: number[], f: number[]): number[] {
  const out: number[] = [];
  let livello = 100;
  for (let i = 0; i < v.length; i++) {
    if (i > 0 && v[i - 1] > 0) livello *= (v[i] - f[i]) / v[i - 1];
    out.push(v[i] > 0 ? livello : NaN);
  }
  return out;
}

export function perClasse(righe: RigaInvestimento[]) {
  const g = new Map<string, { classe: string; valore: number; guadagno: number; obiettivo: number | null }>();
  for (const r of righe) {
    const x = g.get(r.classe) ?? { classe: r.classe, valore: 0, guadagno: 0, obiettivo: null };
    x.valore += r.valore; x.guadagno += r.guadagno;
    if (r.obiettivo !== null && r.obiettivo !== undefined) x.obiettivo = (x.obiettivo ?? 0) + r.obiettivo;
    g.set(r.classe, x);
  }
  const tot = [...g.values()].reduce((a, x) => a + x.valore, 0);
  return [...g.values()].map((x) => ({ ...x, peso: tot ? x.valore / tot : NaN,
    scostamento: x.obiettivo === null ? null : (tot ? x.valore / tot : NaN) - x.obiettivo }))
    .sort((a, b) => a.classe.localeCompare(b.classe));
}

// ================================================================== saldi
export interface ControlloAncora { conto: string; data: string; saldoNoto: number; saldoCalcolato: number; differenza: number; fonte: string; }

/** Saldo giornaliero per conto, allineato ai saldi noti. */
export function saldi(mov: Movimento[], ancore: SaldoNoto[], finoA = oggiIso()) {
  const perConto = new Map<string, Map<string, number>>();
  for (const m of mov) {
    let g = perConto.get(m.conto);
    if (!g) perConto.set(m.conto, (g = new Map()));
    g.set(m.data, (g.get(m.data) ?? 0) + m.importo);
  }
  const conti = [...perConto.keys()].sort();
  let inizioG = "9999", fineG = "0000";
  const risultati: Record<string, Map<string, number>> = {};
  const ctrl: ControlloAncora[] = [];
  for (const conto of conti) {
    const g = perConto.get(conto)!;
    const dd = [...g.keys()].sort();
    const inizio = aggiungiGiorni(dd[0], -1);
    const fine = dd[dd.length - 1] > finoA ? dd[dd.length - 1] : finoA;
    const giorni = intervallo(inizio, fine);
    const cum: number[] = [];
    let c = 0;
    for (const d of giorni) { c += g.get(d) ?? 0; cum.push(c); }
    const asof = (d: string) => {
      if (d < giorni[0]) return NaN;
      const i = Math.min(giorniTra(giorni[0], d), giorni.length - 1);
      return cum[i];
    };
    const a = ancore.filter((x) => x.conto === conto).sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : 0));
    const offAnc: [string, number][] = [];
    let prec: number | null = null;
    for (const r of a) {
      const off = r.saldo - asof(r.data);
      if (Number.isFinite(off)) offAnc.push([r.data, off]);
      const salto = prec === null || !Number.isFinite(off) ? 0 : off - prec;
      ctrl.push({ conto, data: r.data, saldoNoto: r.saldo, saldoCalcolato: r.saldo - salto, differenza: salto, fonte: r.fonte });
      if (Number.isFinite(off)) prec = off;
    }
    // per ogni giorno vale l'ancora più recente (prima della prima: la prima)
    const serie = new Map<string, number>();
    let j = 0, off = offAnc.length ? offAnc[0][1] : 0;
    for (let i = 0; i < giorni.length; i++) {
      while (j < offAnc.length && offAnc[j][0] <= giorni[i]) { off = offAnc[j][1]; j++; }
      serie.set(giorni[i], cum[i] + off);
    }
    risultati[conto] = serie;
    if (inizio < inizioG) inizioG = inizio;
    if (fine > fineG) fineG = fine;
  }
  const giorni = conti.length ? intervallo(inizioG, fineG) : [];
  const valori: Record<string, (number | null)[]> = {};
  for (const conto of conti) valori[conto] = giorni.map((d) => risultati[conto].get(d) ?? null);
  // ultimo valore noto di ogni conto
  const ultimo: Record<string, number> = {};
  for (const conto of conti) {
    const v = valori[conto];
    for (let i = v.length - 1; i >= 0; i--) if (v[i] !== null) { ultimo[conto] = v[i]!; break; }
  }
  return { giorni, conti, valori, ultimo, controllo: ctrl };
}

export function buchi(mov: Movimento[], giorniMin = 45) {
  const perConto = new Map<string, Set<string>>();
  for (const m of mov) {
    let s = perConto.get(m.conto);
    if (!s) perConto.set(m.conto, (s = new Set()));
    s.add(m.data);
  }
  const out: { conto: string; dal: string; al: string; giorni: number }[] = [];
  for (const [conto, s] of [...perConto.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const d = [...s].sort();
    for (let i = 1; i < d.length; i++) {
      const n = giorniTra(d[i - 1], d[i]);
      if (n > giorniMin) out.push({ conto, dal: d[i - 1], al: d[i], giorni: n });
    }
  }
  return out;
}

// ================================================================== entrate e uscite
export type Frequenza = "M" | "Y";
export const periodoDi = (d: string, f: Frequenza) => (f === "M" ? d.slice(0, 7) + "-01" : d.slice(0, 4) + "-01-01");

/** Tabelle periodo x categoria. compensa: entrate e uscite della stessa categoria nello stesso periodo si compensano. */
export function perCategoria(mov: Movimento[], escluse: string[], freq: Frequenza = "M", compensa = true) {
  const esc = new Set(escluse);
  const m = mov.filter((x) => !esc.has(x.categoria));
  const periodiS = new Set<string>();
  const ent = new Map<string, Map<string, number>>(), usc = new Map<string, Map<string, number>>();
  const add = (t: Map<string, Map<string, number>>, cat: string, p: string, v: number) => {
    let r = t.get(cat);
    if (!r) t.set(cat, (r = new Map()));
    r.set(p, (r.get(p) ?? 0) + v);
  };
  if (compensa) {
    const netto = new Map<string, Map<string, number>>();
    for (const x of m) { const p = periodoDi(x.data, freq); periodiS.add(p); add(netto, x.categoria, p, x.importo); }
    for (const [cat, r] of netto) for (const [p, v] of r) {
      if (v > 0) add(ent, cat, p, v);
      else if (v < 0) add(usc, cat, p, -v);
    }
  } else {
    for (const x of m) {
      const p = periodoDi(x.data, freq);
      periodiS.add(p);
      if (x.importo > 0) add(ent, x.categoria, p, x.importo);
      else if (x.importo < 0) add(usc, x.categoria, p, -x.importo);
    }
  }
  const periodi = [...periodiS].sort();
  const tab = (t: Map<string, Map<string, number>>) => {
    const out: Record<string, number[]> = {};
    for (const [cat, r] of t) {
      const v = periodi.map((p) => r.get(p) ?? 0);
      if (v.some((x) => x > 0)) out[cat] = v;
    }
    return out;
  };
  return { periodi, entrate: tab(ent), uscite: tab(usc) };
}

// ================================================================== simulazione
export function simulazione(tassoAnnuo: number, capitale: number, versamento: number, anni: number, inizio = oggiIso()) {
  const mesi = Math.round(anni * 12);
  const r = Math.pow(1 + tassoAnnuo, 1 / 12) - 1;
  const date: string[] = [], vers = [capitale], mont = [capitale];
  let a = +inizio.slice(0, 4), m = +inizio.slice(5, 7);
  for (let i = 0; i <= mesi; i++) {
    date.push(`${a}-${String(m).padStart(2, "0")}-01`);
    if (++m > 12) { m = 1; a++; }
    if (i < mesi) {
      vers.push(vers[i] + versamento);
      mont.push(mont[i] * (1 + r) + versamento);
    }
  }
  return { date, versato: vers, montante: mont, interesse: mont.map((x, i) => x - vers[i]) };
}

// ================================================================== candele
export const FREQUENZE_CANDELE = { Settimana: venerdi, Mese: fineMese, Trimestre: fineTrimestre } as const;
export type FreqCandela = keyof typeof FREQUENZE_CANDELE;
export interface Candela { data: string; apertura: number; massimo: number; minimo: number; chiusura: number; }

/** Apertura, massimo, minimo e chiusura per periodo da una serie giornaliera (ogni candela parte dalla chiusura precedente). */
export function ohlc(giorni: string[], valori: (number | null)[], freq: FreqCandela = "Settimana"): Candela[] {
  const etichetta = FREQUENZE_CANDELE[freq];
  const out: Candela[] = [];
  let cur: Candela | null = null;
  for (let i = 0; i < giorni.length; i++) {
    const v = valori[i];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const e = etichetta(giorni[i]);
    if (!cur || cur.data !== e) {
      cur = { data: e, apertura: v, massimo: v, minimo: v, chiusura: v };
      out.push(cur);
    } else {
      cur.massimo = Math.max(cur.massimo, v);
      cur.minimo = Math.min(cur.minimo, v);
      cur.chiusura = v;
    }
  }
  for (let i = 1; i < out.length; i++) {
    const c = out[i];
    c.apertura = out[i - 1].chiusura;
    c.massimo = Math.max(c.massimo, c.apertura);
    c.minimo = Math.min(c.minimo, c.apertura);
  }
  return out;
}
