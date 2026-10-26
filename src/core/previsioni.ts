/** Previsioni di entrate/uscite e coefficiente di crescita su finestre mobili. */
import { giorniTra, ms } from "./date";

// ------------------------------------------------------------------ statistica di base
export function regressione(x: number[], y: number[]) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
  const b = sxx ? sxy / sxx : 0, a = my - b * mx;
  const res = y.map((v, i) => v - (a + b * x[i]));
  const sd = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / Math.max(1, n - 2));
  return { a, b, sd, media: my };
}
const media = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const devStd = (v: number[]) => { const m = media(v); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, v.length - 1)); };

// ------------------------------------------------------------------ previsione mensile
export type Metodo = "media" | "tendenza";

/** Mesi interi (AAAA-MM-01) compresi nel periodo [dal, al], senza il mese in corso se non è finito. */
export function mesiInteri(dal: string, al: string, oggi: string): string[] {
  const out: string[] = [];
  let a = +dal.slice(0, 4), m = +dal.slice(5, 7);
  if (dal.slice(8, 10) !== "01") { m++; if (m > 12) { m = 1; a++; } }
  const ultimo = (aa: number, mm: number) => new Date(Date.UTC(aa, mm, 0)).toISOString().slice(0, 10);
  while (true) {
    const fine = ultimo(a, m);
    if (fine > al || fine >= oggi) break;
    out.push(`${a}-${String(m).padStart(2, "0")}-01`);
    if (++m > 12) { m = 1; a++; }
  }
  return out;
}

export interface SerieMensile { periodi: string[]; entrate: number[]; uscite: number[]; }
export interface Proiezione { stima: number[]; basso: number[]; alto: number[]; }

function proietta(y: number[], k: number, metodo: Metodo, nonNegativa: boolean, cumulata = false): Proiezione & { sd: number; pendenza: number; base: number } {
  const n = y.length;
  const x = y.map((_, i) => i);
  const r = metodo === "tendenza" && n >= 3 ? regressione(x, y) : { a: media(y), b: 0, sd: devStd(y), media: media(y) };
  const stima: number[] = [], basso: number[] = [], alto: number[] = [];
  let acc = 0;
  for (let j = 1; j <= k; j++) {
    let v = r.a + r.b * (n - 1 + j);
    if (nonNegativa) v = Math.max(0, v);
    if (cumulata) {
      acc += v;
      const s = r.sd * Math.sqrt(j);
      stima.push(acc); basso.push(acc - s); alto.push(acc + s);
    } else {
      stima.push(v); basso.push(nonNegativa ? Math.max(0, v - r.sd) : v - r.sd); alto.push(v + r.sd);
    }
  }
  return { stima, basso, alto, sd: r.sd, pendenza: r.b, base: r.a + r.b * (n - 1) };
}

/** Proietta entrate, uscite e risparmio cumulato per `k` mesi dopo l'ultimo mese della serie. */
export function previsione(s: SerieMensile, k: number, metodo: Metodo) {
  const ultimo = s.periodi[s.periodi.length - 1];
  const futuri: string[] = [];
  let a = +ultimo.slice(0, 4), m = +ultimo.slice(5, 7);
  for (let j = 0; j < k; j++) { if (++m > 12) { m = 1; a++; } futuri.push(`${a}-${String(m).padStart(2, "0")}-01`); }
  const risparmio = s.entrate.map((e, i) => e - s.uscite[i]);
  return {
    futuri,
    entrate: proietta(s.entrate, k, metodo, true),
    uscite: proietta(s.uscite, k, metodo, true),
    risparmioMensile: proietta(risparmio, k, metodo, false),
    risparmioCumulato: proietta(risparmio, k, metodo, false, true),
  };
}

// ------------------------------------------------------------------ coefficiente di crescita
export interface Crescita { giorni: string[]; valori: (number | null)[]; tendenza: (number | null)[]; pendenzaAnnua: number; media: number; giudizio: "in aumento" | "in diminuzione" | "mediamente costante" | "dati insufficienti"; }

export type ModoCrescita = "annuo" | "periodo" | "euro_mese";

/**
 * Crescita su una finestra mobile di `finestraGiorni`: per ogni giorno confronta il valore con quello di
 * `finestraGiorni` prima. modo "annuo": tasso annuo equivalente; "periodo": variazione % nella finestra;
 * "euro_mese": aumento medio in euro al mese (per il risparmio è la misura più diretta).
 */
export function crescitaMobile(giorni: string[], valori: (number | null)[], finestraGiorni: number, modo: ModoCrescita | boolean = "annuo"): Crescita {
  if (typeof modo === "boolean") modo = modo ? "annuo" : "periodo";
  const euro = modo === "euro_mese";
  const out: (number | null)[] = new Array(giorni.length).fill(null);
  let j = 0;
  for (let i = 0; i < giorni.length; i++) {
    const v = valori[i];
    if (v === null || !Number.isFinite(v) || (!euro && v <= 0)) continue;
    while (j < i && giorniTra(giorni[j + 1], giorni[i]) >= finestraGiorni) j++;
    const d = giorniTra(giorni[j], giorni[i]);
    const v0 = valori[j];
    if (d < finestraGiorni * 0.9 || v0 === null || !Number.isFinite(v0)) continue;
    if (euro) { out[i] = (v - v0) / (d / 30.4375); continue; }
    if (v0 <= 0) continue;
    const rapporto = v / v0;
    out[i] = modo === "annuo" ? Math.pow(rapporto, 365 / d) - 1 : rapporto - 1;
  }
  // tendenza del coefficiente: retta di regressione nel tempo (in anni)
  const xs: number[] = [], ys: number[] = [];
  const t0 = giorni.length ? ms(giorni[0]) : 0;
  out.forEach((v, i) => { if (v !== null && Number.isFinite(v)) { xs.push((ms(giorni[i]) - t0) / (365 * 864e5)); ys.push(v); } });
  if (ys.length < 10) return { giorni, valori: out, tendenza: out.map(() => null), pendenzaAnnua: NaN, media: ys.length ? media(ys) : NaN, giudizio: "dati insufficienti" };
  const r = regressione(xs, ys);
  const tendenza = out.map((v, i) => (v === null ? null : r.a + r.b * ((ms(giorni[i]) - t0) / (365 * 864e5))));
  const durata = xs[xs.length - 1] - xs[0];
  const variazione = r.b * durata; // quanto cambia il coefficiente lungo tutto il periodo, secondo la retta
  const giudizio = Math.abs(variazione) < Math.max(euro ? 1 : 0.005, 0.5 * devStd(ys)) ? "mediamente costante" : variazione > 0 ? "in aumento" : "in diminuzione";
  return { giorni, valori: out, tendenza, pendenzaAnnua: r.b, media: media(ys), giudizio };
}
