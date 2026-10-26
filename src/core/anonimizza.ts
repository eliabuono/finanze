/**
 * Campione anonimo di un estratto conto, per aggiungere il supporto a una banca nuova.
 *
 * Contiene le parole del PDF con la loro posizione sulla pagina (esattamente ciò che usano i lettori),
 * ma con il contenuto stravolto:
 *  - lettere di descrizioni, nomi, indirizzi, IBAN: sostituite a caso (stessa lunghezza e maiuscole);
 *  - parole di struttura (Data, Valuta, Descrizione, Saldo, Totale, mesi...): lasciate leggibili;
 *  - importi: moltiplicati tutti per uno stesso numero casuale (i conti tornano ancora, le cifre vere no);
 *  - date: spostate tutte dello stesso numero di giorni; altri numeri (codici, carte, IBAN): cifre a caso.
 * Lo stesso testo diventa sempre la stessa cosa nello stesso campione, così si riconoscono le ripetizioni.
 */
import { righe, type Pagina, type Parola } from "./pdftext";

export const VERSIONE_CAMPIONE = 1;
const MAX_PAGINE = 15;

type ParolaC = [string, number, number, number, number]; // testo, x0, x1, top, bottom
export interface Campione {
  versione: number;
  creato: string;
  pagine: { w: number; h: number; p: ParolaC[]; p3: ParolaC[] }[];
  pagine_totali: number;
}

const PAROLE_STRUTTURA = `
data date datum fecha valuta val valeur wertstellung operazione operazioni descrizione description beschreibung dettaglio dettagli
causale causali importo importi amount betrag addebiti accrediti addebito accredito dare avere entrate uscite entrata uscita
debit debits credit credits debito credito debiti crediti saldo saldi balance solde iniziale finale contabile disponibile
liquido totale totali total totals totale pagina pagine page pag seite di de del della dei delle degli of the to from al dal
alla allo ai agli a da in il lo la le gli un una per su con e ed o and or estratto estratti conto conti corrente correnti
statement account accounts movimenti movimento transactions transaction periodo period riepilogo sintesi summary eur euro
usd gbp chf iban bic swift abi cab cin cliente intestatario intestato filiale n n° nr no num numero tipo type categoria
category categorie stato status riferimento reference rif commissioni commissione spese spesa imposta imposte bollo interessi
interesse bonifico bonifici pagamento pagamenti prelievo prelievi carta carte card pos atm sepa sdd rid giroconto ricarica
rimborso stipendio canone utenze addebito diretto sepa effettuato presso ore mediante disposto favore ordinante beneficiario
benef mitt cod disp mandato nome quantita quantità prezzo isin titolo titoli acquisto vendita buy sell trade investimento
investimenti dividendo dividendi cedola fondi portafoglio deposito conto-deposito c/c cc ccn libretto dossier contabilizzato
si no lista transazioni transazione sul sulla nel nella dalla verso tua tuo hai approvato approvata rifiutato rifiutata
intesa sanpaolo satispay trade republic revolut fineco unicredit bnl bper mediolanum poste postepay hype n26 ing bancoposta widiba
categoria importo previsto saldo-iniziale saldo-finale apertura chiusura precedente successivo riporto
gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre
gen feb mar apr mag giu lug ago set ott nov dic january february march april may june july august september october november december
jan apr jun jul aug sep sept oct dec januar februar märz mai juni juli august oktober dezember
lunedì martedì mercoledì giovedì venerdì sabato domenica lun mer gio ven sab dom monday tuesday wednesday thursday friday saturday sunday
`.split(/\s+/).filter(Boolean);
const STRUTTURA = new Set(PAROLE_STRUTTURA.map((p) => p.toLowerCase()));

/** Generatore casuale (crypto se disponibile). */
function casuale(): () => number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    return () => (crypto.getRandomValues(buf), buf[0] / 2 ** 32);
  }
  return Math.random;
}

const MAIUSCOLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", MINUSCOLE = "abcdefghijklmnopqrstuvwxyz";

export function creaAnonimizzatore(rnd = casuale()) {
  const fattore = 0.55 + rnd() * 1.1; // importi moltiplicati per un numero tra 0,55 e 1,65
  const spostamento = Math.floor(rnd() * 400) - 200; // date spostate di ±200 giorni
  const mappa = new Map<string, string>();
  const lettera = (c: string) => {
    const pool = c === c.toUpperCase() ? MAIUSCOLE : MINUSCOLE;
    return pool[Math.floor(rnd() * 26)];
  };
  const cifra = () => String(Math.floor(rnd() * 10));

  function importo(t: string): string | null {
    // importi con due decimali: 1.234,56  1,234.56  -12,50  12,50-  +3 000,00  € 5,00
    const m = t.match(/^([^\d]*?)(\d[\d.,'’  \x19]*[.,])(\d\d)([^\d]*)$/);
    if (!m) return null;
    const [, pre, intero, dec, post] = m;
    const sepDec = intero.slice(-1);
    const corpo = intero.slice(0, -1);
    const migliaia = corpo.match(/[.,'’  \x19]/)?.[0] ?? "";
    if (migliaia === sepDec) return null; // es. 12.345.67: non è un importo chiaro
    const valore = Number(corpo.replace(/[^\d]/g, "") + "." + dec);
    if (!Number.isFinite(valore)) return null;
    const nuovo = Math.round(valore * fattore * 100) / 100;
    let [i, d] = nuovo.toFixed(2).split(".");
    if (migliaia) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, migliaia);
    return pre + i + sepDec + d + post;
  }

  function data(t: string): string | null {
    let m = t.match(/^(\d{1,2})([./-])(\d{1,2})\2(\d{2}|\d{4})$/);
    let g: number, me: number, a: number, forma: "dma" | "amg" = "dma";
    if (m) { g = +m[1]; me = +m[3]; a = +m[4]; if (m[4].length === 2) a += 2000; }
    else if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { a = +m[1]; me = +m[2]; g = +m[3]; forma = "amg"; }
    else return null;
    if (me < 1 || me > 12 || g < 1 || g > 31) return null;
    const d = new Date(Date.UTC(a, me - 1, g + spostamento));
    const G = String(d.getUTCDate()).padStart(2, "0"), M = String(d.getUTCMonth() + 1).padStart(2, "0"), A = String(d.getUTCFullYear());
    if (forma === "amg") return `${A}-${M}-${G}`;
    const sep = m[2];
    const gg = m[1].length === 1 ? String(+G) : G, mm = m[3].length === 1 ? String(+M) : M;
    return `${gg}${sep}${mm}${sep}${m[4].length === 2 ? A.slice(2) : A}`;
  }

  function token(t: string): string {
    const n = t.toLowerCase().replace(/[.:,;()]+$/g, "").replace(/^[(]+/, "");
    if (STRUTTURA.has(n) || STRUTTURA.has(t.toLowerCase())) return t;
    if (/^\d{1,2}$/.test(t)) return t; // giorni, numeri di pagina
    if (/^(19|20)\d\d$/.test(t)) return t; // anni
    if (/^\d{1,2}:\d\d$/.test(t)) return t; // orari 12:30
    const dd = data(t);
    if (dd) return dd;
    const imp = importo(t);
    if (imp) return imp;
    // tutto il resto: lettere e cifre sostituite, punteggiatura e simboli lasciati
    let out = "";
    for (const c of t) {
      if (/\d/.test(c)) out += cifra();
      else if (/[A-Za-z]/.test(c)) out += lettera(c);
      else if (/\p{L}/u.test(c)) out += lettera(c.toLowerCase() === c ? "a" : "A");
      else out += c;
    }
    return out;
  }

  return {
    fattore, spostamento,
    parola(t: string): string {
      let r = mappa.get(t);
      if (r === undefined) { r = token(t); mappa.set(t, r); }
      return r;
    },
  };
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function creaCampione(pagine: Pagina[], rnd?: () => number): Campione {
  const an = creaAnonimizzatore(rnd);
  const conv = (ws: Parola[]): ParolaC[] => {
    const out: ParolaC[] = ws.map((w) => [an.parola(w.text), r2(w.x0), r2(w.x1), r2(w.top), r2(w.bottom)]);
    // importi spezzati in due parole ("1.234," "56"): si trattano insieme, così anche i decimali cambiano coerentemente
    for (let i = 0; i + 1 < ws.length; i++) {
      const a = ws[i], b = ws[i + 1];
      if (/\d[.,]$/.test(a.text) && /^\d\d(?!\d)/.test(b.text) && Math.abs(a.top - b.top) < 1.5 && b.x0 - a.x1 < 6 && b.x0 > a.x0) {
        const unito = an.parola(a.text + b.text.slice(0, 2));
        const k = unito.search(/[.,]\d\d(?!.*[.,]\d)/);
        if (k > 0) {
          out[i][0] = unito.slice(0, k + 1);
          out[i + 1][0] = unito.slice(k + 1, k + 3) + an.parola(b.text.slice(2) || "") ;
        }
      }
    }
    return out;
  };
  return {
    versione: VERSIONE_CAMPIONE,
    creato: new Date().toISOString().slice(0, 10),
    pagine_totali: pagine.length,
    pagine: pagine.slice(0, MAX_PAGINE).map((p) => ({ w: r2(p.width), h: r2(p.height), p: conv(p.parole), p3: conv(p.parole3) })),
  };
}

/** Ricostruisce le pagine da un campione (per provare i lettori). */
export function pagineDaCampione(c: Campione): Pagina[] {
  return c.pagine.map((pg) => {
    const dec = (ws: ParolaC[]): Parola[] => ws.map(([text, x0, x1, top, bottom]) => ({ text, x0, x1, top, bottom, y: pg.h - bottom }));
    const parole = dec(pg.p);
    const testo = righe(parole, 2.5).map((r) => r.map((w) => w.text).join(" ")).join("\n");
    return { width: pg.w, height: pg.h, parole, parole3: dec(pg.p3), testo };
  });
}
