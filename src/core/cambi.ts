/**
 * Cambi delle valute estere (conti Revolut in USD, NOK...). L'app ragiona in euro: all'import ogni movimento in
 * valuta viene convertito al cambio del suo giorno (Yahoo Finance, EURUSD=X = dollari per 1 euro) e l'importo
 * originale resta scritto nella descrizione.
 */
import type { MovimentoLetto } from "./tipi";

/** valuta -> giorno -> unità di valuta per 1 euro */
export type Cambi = Record<string, Record<string, number>>;

/** Cambio di quel giorno, o dell'ultimo giorno prima con un cambio (weekend e festivi); se manca, il primo dopo entro una settimana. */
export function tassoDel(serie: Record<string, number> | undefined, data: string): number | null {
  if (!serie) return null;
  const giorni = Object.keys(serie).sort();
  let prima: string | null = null, dopo: string | null = null;
  for (const g of giorni) { if (g <= data) prima = g; else { dopo = g; break; } }
  if (prima && Date.parse(data) - Date.parse(prima) <= 10 * 864e5) return serie[prima];
  if (dopo && Date.parse(dopo) - Date.parse(data) <= 7 * 864e5) return serie[dopo];
  return prima ? serie[prima] : null;
}

/** Valute estere presenti fra i movimenti letti e la data del primo movimento in valuta. */
export function valuteEstere(mov: MovimentoLetto[]): { valute: string[]; dal: string } {
  const v = new Set<string>();
  let dal = "";
  for (const m of mov) if (m.valuta && m.valuta !== "EUR") { v.add(m.valuta); if (!dal || m.data < dal) dal = m.data; }
  return { valute: [...v].sort(), dal };
}

export const formatoValuta = (x: number, valuta: string) =>
  `${x.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${valuta}`;
