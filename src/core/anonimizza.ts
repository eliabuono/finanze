/**
 * Campione anonimo di un estratto conto, per aggiungere il supporto a una banca nuova.
 *
 * Contiene le parole del PDF con la loro posizione sulla pagina (esattamente ciò che usano i lettori),
 * ma con il contenuto cancellato:
 *  - ogni cifra diventa "*"  (1.301,83€ -> *.***,**€; 25 gen 2024 -> ** gen ****);
 *  - ogni lettera diventa "x" o "X" (stessa lunghezza e maiuscole: descrizioni, nomi, indirizzi, IBAN...);
 *  - restano leggibili solo le parole che danno la struttura del documento: intestazioni delle colonne
 *    (Data, Descrizione, Entrate, Uscite, Saldo...), Totale, Pagina, i mesi e il nome delle banche;
 *  - punteggiatura e simboli (€ $ . , / - :) restano, perché servono a riconoscere date e importi.
 */
import { righe, type Pagina, type Parola } from "./pdftext";

export const VERSIONE_CAMPIONE = 2;
const MAX_PAGINE = 15;

type ParolaC = [string, number, number, number, number]; // testo, x0, x1, top, bottom
export interface Campione {
  versione: number;
  creato: string;
  pagine: { w: number; h: number; p: ParolaC[]; p3: ParolaC[] }[];
  pagine_totali: number;
}

// Solo parole di intestazione/struttura: nessuna parola che descriva un tipo di spesa o una controparte.
const PAROLE_STRUTTURA = `
data date datum fecha valuta val valeur wertstellung descrizione description beschreibung dettaglio operazione operazioni
importo importi amount betrag addebiti accrediti addebito accredito dare avere entrate uscite entrata uscita
debit debits credit credits debito credito saldo saldi balance solde iniziale finale contabile disponibile
totale totali total pagina pagine page pag seite di de del della al dal of to from estratto conto corrente statement account
lista elenco compravendita titoli denaro money in out movimenti movimento transazioni transazione transactions transaction periodo period riepilogo summary
eur euro usd gbp chf iban bic swift n n° nr no
categoria category tipo type stato status causale nome name riferimento reference quantità quantita prezzo isin contabilizzato
approvato approvata rifiutato rifiutata annullato annullata completato completata eseguito eseguita completed pending declined reverted si sì
gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre
gen feb mar apr mag giu lug ago set ott nov dic january february march april may june july august september october november december
jan jun jul aug sep sept oct dec januar februar märz mai juni juli oktober dezember
intesa sanpaolo satispay trade republic revolut fineco finecobank unicredit bnl bper mediolanum poste postepay hype n26 ing bancoposta widiba
`.split(/\s+/).filter(Boolean);
const STRUTTURA = new Set(PAROLE_STRUTTURA.map((p) => p.toLowerCase()));

/** Sostituisce ogni cifra con "*" e ogni lettera con x/X, lasciando le parole di struttura. */
export function anonimizzaParola(t: string): string {
  const pulita = t.toLowerCase().replace(/^[(«"']+|[.:,;)»"']+$/g, "");
  if (STRUTTURA.has(pulita)) return t;
  let out = "";
  for (const c of t) {
    if (/\d/.test(c)) out += "*";
    else if (/\p{L}/u.test(c)) out += c === c.toLowerCase() && c !== c.toUpperCase() ? "x" : "X";
    else out += c;
  }
  return out;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function creaCampione(pagine: Pagina[]): Campione {
  const conv = (ws: Parola[]): ParolaC[] => ws.map((w) => [anonimizzaParola(w.text), r2(w.x0), r2(w.x1), r2(w.top), r2(w.bottom)]);
  return {
    versione: VERSIONE_CAMPIONE,
    creato: new Date().toISOString().slice(0, 10),
    pagine_totali: pagine.length,
    pagine: pagine.slice(0, MAX_PAGINE).map((p) => ({ w: r2(p.width), h: r2(p.height), p: conv(p.parole), p3: conv(p.parole3) })),
  };
}

/**
 * Ricostruisce le pagine da un campione, per scrivere e provare il lettore di una banca nuova.
 * Con `cifre: true` gli asterischi tornano cifre plausibili (anni "****" -> 2025, il resto 1),
 * così le espressioni che cercano date e importi funzionano anche sul campione.
 */
export function pagineDaCampione(c: Campione, opz: { cifre?: boolean } = {}): Pagina[] {
  const testo = (t: string) => (!opz.cifre ? t : t.replace(/(?<![*\d])\*{4}(?![*\d])/g, "2025").replace(/\*/g, "1"));
  return c.pagine.map((pg) => {
    const dec = (ws: ParolaC[]): Parola[] => ws.map(([t, x0, x1, top, bottom]) => ({ text: testo(t), x0, x1, top, bottom, y: pg.h - bottom }));
    const parole = dec(pg.p);
    const riga = righe(parole, 2.5).map((r) => r.map((w) => w.text).join(" ")).join("\n");
    return { width: pg.w, height: pg.h, parole, parole3: dec(pg.p3), testo: riga };
  });
}
