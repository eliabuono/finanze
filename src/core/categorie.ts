/** Categorie: esercente/controparte, regole, apprendimento, controllo dei trasferimenti. */
import { giorniTra } from "./date";
import type { Config, Movimento } from "./tipi";

type MovLike = { descrizione: string; conto: string; tipo?: string; importo: number; isin?: string; categoria?: string };

const PAROLE_VUOTE = new Set(["SRL", "S.R.L.", "SPA", "S.P.A.", "SAS", "S.A.S.", "SNC", "DI", "DEL", "DELLA", "E", "&",
  "IL", "LA", "LO", "LE", "THE", "DA", "A", "IT", "ITA", "ITALIA", "TORINO", "MILANO", "LUXEMBOURG", "INTERNET",
  "WWW", "COM", "IN", "AL", "SU"]);

export const CONTI_SALVADANAIO = ["Intesa Salvadanaio", "Satispay Salvadanaio"];

/** Tiene le prime parole significative, scarta codici (parole con cifre) e simboli. */
export function pulisci(testo: string, maxParole = 4): string {
  const t = testo.toUpperCase().replace(/[*#'".,:;()[\]/\\-]/g, " ");
  const parole: string[] = [];
  for (const p of t.split(/\s+/).filter(Boolean)) {
    if (/\d/.test(p)) {
      if (parole.length) break;
      continue;
    }
    if (p.length <= 1) continue;
    parole.push(p);
    if (parole.length >= maxParole) break;
  }
  return parole.join(" ");
}

/** Nome normalizzato di esercente o controparte, uguale per tutti i movimenti dello stesso soggetto. */
export function chiave(m: MovLike): string {
  const d = String(m.descrizione ?? "");
  const du = d.toUpperCase();
  const conto = m.conto ?? "";
  let x: RegExpMatchArray | null;
  if (conto.startsWith("Intesa")) {
    if ((x = d.match(/PRESSO (.+?)(?: \| |$)/i))) return pulisci(x[1], 3);
    if ((x = d.split(" | ").join(" ").match(/NOME:\s*(.+?)(?:\s*-?\s*MANDATO|$)/i))) return pulisci(x[1], 3);
    if ((x = d.match(/a favore di:? \| (.+?)(?: \| |$)/i))) return "BONIFICO A " + pulisci(x[1], 3);
    if ((x = d.match(/MITT\.: (.+?)(?: \| | COD|$)/i))) return "BONIFICO DA " + pulisci(x[1], 3);
    if ((x = d.match(/Disposto (?:A Favore )?Di (.+?)(?: MANDATO|$)/i))) {
      const pref = du.includes("A FAVORE") && du.includes("BONIFICO") ? "BONIFICO A " : "";
      return pref + pulisci(x[1], 3);
    }
    if ((x = d.match(/Disposto Da (.+)$/i))) return "BONIFICO DA " + pulisci(x[1], 3);
    return pulisci(d.includes(" | ") && !du.includes("PAGAMENTO") ? d.split(" | ")[0] : d, 3);
  }
  if (conto === "Trade Republic") {
    if ((x = d.match(/transfer (?:for|from) (.+?)(?: \(|$)/i)))
      return (du.includes("OUTGOING") ? "BONIFICO A " : "BONIFICO DA ") + pulisci(x[1], 3);
    return pulisci(d, 3);
  }
  if (conto === "Satispay") {
    const nome = d.split(" @")[0];
    return pulisci(nome, 3) || nome.toUpperCase();
  }
  return pulisci(d, 3);
}

// ------------------------------------------------------------------ regole
export const CATEGORIE_INTESA: Record<string, string> = {
  "Generi alimentari e supermercato": "Supermercato", "Ristoranti e bar": "Bar e ristoranti",
  "Trasporti, noleggi, taxi e parcheggi": "Trasporti", "Carburanti": "Trasporti",
  "Stipendi e pensioni": "Stipendio", "TV, Internet, telefono": "Telefono e abbonamenti",
  "Imposte, bolli e commissioni": "Commissioni banca", "Casa varie": "Casa e utenze",
  "Utenze": "Casa e utenze", "Tempo libero varie": "Sport e tempo libero",
  "Abbigliamento e accessori": "Abbigliamento", "Salute e benessere": "Salute",
  "Bonifici ricevuti": "Altre entrate", "Bonifici in uscita": "Altre uscite", "Altre uscite": "Altre uscite",
  "Altre entrate": "Altre entrate", "Prelievi": "Contanti", "Viaggi e vacanze": "Viaggi",
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cacheRe = new Map<string, RegExp>();

/** Ricerca come parola intera ("BAR" non trova "BARCLAYS", "ESSO" non trova "PRESSO"). */
export function contiene(testo: string, parola: string): boolean {
  const p = parola.trim().toUpperCase();
  if (!p) return false;
  let re = cacheRe.get(p);
  if (!re) {
    re = new RegExp("(?<![A-Z0-9])" + escape(p) + "(?![A-Z0-9])");
    cacheRe.set(p, re);
  }
  return re.test(testo);
}

function testoDi(m: MovLike): string {
  const t = ` ${m.descrizione ?? ""} ${m.tipo ?? ""} `.toUpperCase().split(" | ").join(" ");
  return " " + t.split(/\s+/).filter(Boolean).join(" ") + " ";
}

/** Bonifici tra conti intestati a te e ricariche Satispay addebitate in banca (mandato SEPA che inizia con SATO). */
function trasferimentoProprio(testo: string, cfg: Config): boolean {
  if (/MANDATO:?\s*SATO\d/.test(testo)) return true;
  const nome = String(cfg.intestatario ?? "").toUpperCase().split(/\s+/).filter(Boolean);
  if (nome.length < 2) return false;
  const rev = [...nome].reverse();
  const varianti = [nome.join(" "), rev.join(" "), rev.join(", ")];
  const bonifico = ["BONIFICO", "TRANSFER", "GIROCONTO", "MITT.", "A FAVORE DI"].some((w) => testo.includes(w));
  return bonifico && varianti.some((v) => contiene(testo, v));
}

export function categorizza(m: MovLike, cfg: Config): string {
  const testo = testoDi(m);
  if (m.isin) return "Investimenti";
  const appresa = cfg.regole_apprese?.[chiave(m)];
  if (appresa) return appresa;
  const regole = cfg.regole_categorie;
  const speciali = new Set(["Trasferimento interno", "Investimenti"]);
  const commissione = testo.trim().startsWith("COMMISSIONI");
  if (!commissione && trasferimentoProprio(testo, cfg)) return "Trasferimento interno";
  for (const [cat, parole] of regole)
    if (speciali.has(cat) && !commissione && parole.some((p) => contiene(testo, p))) return cat;
  for (const [cat, parole] of regole) {
    if (speciali.has(cat) && !commissione) continue;
    if (parole.some((p) => contiene(testo, p))) return cat;
  }
  if (m.categoria && m.categoria !== cfg.categoria_default_uscite && m.categoria !== cfg.categoria_default_entrate)
    return CATEGORIE_INTESA[m.categoria] ?? m.categoria;
  return m.importo < 0 ? cfg.categoria_default_uscite : cfg.categoria_default_entrate;
}

// ------------------------------------------------------------------ suggerimenti
function token(m: MovLike): string[] {
  return [...new Set(chiave(m).split(/\s+/).filter((p) => p.length > 2 && !PAROLE_VUOTE.has(p)))];
}

export type Modello = Map<string, Map<string, number>>;

/** Per ogni parola dell'esercente conta le categorie già assegnate (escluse quelle di default). */
export function addestra(mov: Movimento[], escluse: Set<string>): Modello {
  const mod: Modello = new Map();
  for (const r of mov) {
    if (escluse.has(r.categoria)) continue;
    const segno = r.importo > 0 ? "+" : "-";
    for (const t of token(r)) {
      const k = t + segno;
      let c = mod.get(k);
      if (!c) mod.set(k, (c = new Map()));
      c.set(r.categoria, (c.get(r.categoria) ?? 0) + 1);
    }
  }
  return mod;
}

export function suggerisci(m: MovLike, mod: Modello): [string, number] {
  const segno = m.importo > 0 ? "+" : "-";
  const voti = new Map<string, number>();
  for (const t of token(m)) {
    const c = mod.get(t + segno);
    if (!c) continue;
    let tot = 0;
    for (const n of c.values()) tot += n;
    for (const [cat, n] of c) voti.set(cat, (voti.get(cat) ?? 0) + n / tot);
  }
  if (!voti.size) return ["", 0];
  let best = "", bv = -1, somma = 0;
  for (const [cat, v] of voti) {
    somma += v;
    if (v > bv) { bv = v; best = cat; }
  }
  return [best, bv / somma];
}

export interface DaClassificare {
  esercente: string; movimenti: number; totale: number; esempio: string; conto: string;
  suggerita: string; fiducia: number;
}

/** Esercenti con movimenti ancora in categoria di default, ordinati per importanza. */
export function daClassificare(mov: Movimento[], def: Set<string>, mod: Modello, maxRighe?: number): DaClassificare[] {
  const gruppi = new Map<string, Movimento[]>();
  for (const m of mov) {
    if (!def.has(m.categoria)) continue;
    const k = chiave(m);
    if (!k) continue;
    let g = gruppi.get(k);
    if (!g) gruppi.set(k, (g = []));
    g.push(m);
  }
  const righe = [...gruppi.entries()].map(([k, g]) => {
    const totale = g.reduce((s, m) => s + m.importo, 0);
    const imp = g.map((m) => m.importo).sort((a, b) => a - b);
    const med = imp.length % 2 ? imp[(imp.length - 1) / 2] : (imp[imp.length / 2 - 1] + imp[imp.length / 2]) / 2;
    return { k, g, totale, med, peso: g.length * Math.sqrt(Math.abs(totale)) };
  });
  righe.sort((a, b) => b.peso - a.peso);
  return righe.slice(0, maxRighe ?? righe.length).map(({ k, g, totale, med }) => {
    const [s, f] = suggerisci({ descrizione: g[0].descrizione, conto: g[0].conto, importo: med }, mod);
    return { esercente: k, movimenti: g.length, totale, esempio: g[0].descrizione, conto: g[0].conto,
      suggerita: s, fiducia: Math.round(f * 100) / 100 };
  });
}

// ------------------------------------------------------------------ trasferimenti
/** Abbina movimenti di segno opposto e stesso importo su conti diversi entro `giorni` giorni. id -> [id controparte, conto]. */
export function coppieTrasferimenti(mov: Movimento[], giorni = 5, minimo = 1): Map<string, [string, string]> {
  const perImporto = new Map<number, Movimento[]>();
  for (const m of mov) {
    if (Math.abs(m.importo) < minimo || CONTI_SALVADANAIO.includes(m.conto)) continue;
    const k = Math.round(Math.abs(m.importo) * 100);
    let g = perImporto.get(k);
    if (!g) perImporto.set(k, (g = []));
    g.push(m);
  }
  const out = new Map<string, [string, string]>();
  const usati = new Set<string>();
  const perData = (a: Movimento, b: Movimento) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0);
  for (const g of perImporto.values()) {
    if (g.length < 2) continue;
    const neg = g.filter((m) => m.importo < 0).sort(perData);
    const pos = g.filter((m) => m.importo > 0).sort(perData);
    for (const a of neg) {
      let best: Movimento | null = null, bd = Infinity;
      for (const p of pos) {
        if (p.conto === a.conto || usati.has(p.id)) continue;
        const d = Math.abs(giorniTra(a.data, p.data));
        if (d <= giorni && d < bd) { bd = d; best = p; }
      }
      if (!best) continue;
      usati.add(a.id); usati.add(best.id);
      out.set(a.id, [best.id, best.conto]);
      out.set(best.id, [a.id, a.conto]);
    }
  }
  return out;
}

export function controlloTrasferimenti(mov: Movimento[]) {
  const cp = coppieTrasferimenti(mov);
  const controparte = (m: Movimento) => cp.get(m.id)?.[1] ?? "";
  const senza = mov.filter((m) => m.categoria === "Trasferimento interno" && !CONTI_SALVADANAIO.includes(m.conto)
    && !controparte(m) && !/SALVADANAIO|RISPARMI/.test(m.descrizione.toUpperCase()));
  const nonMarcate = mov.filter((m) => controparte(m) && m.categoria !== "Trasferimento interno")
    .map((m) => ({ ...m, controparte: controparte(m) }));
  return { senzaControparte: senza, coppieNonMarcate: nonMarcate };
}
