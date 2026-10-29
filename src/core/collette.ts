/**
 * Salvadanai di Satispay: quello personale (dove finiscono gli spiccioli) è un conto tuo a parte, mentre le
 * collette (salvadanai condivisi, per esempio per un regalo) no: i soldi che ci metti escono dal tuo Satispay e
 * quelli che prelevi rientrano, e se prelevi più di quanto hai versato la differenza è un'entrata (sono i soldi
 * degli altri), se ne prelevi meno è una spesa.
 */
import type { Config, Movimento } from "./tipi";

export const CAT_COLLETTE = "Collette";
export type TipoSalvadanaio = "personale" | "colletta";

type MovLike = { conto: string; descrizione: string; tipo?: string; importo?: number };

export const nomeSalvadanaio = (descrizione: string) => String(descrizione ?? "").trim().replace(/\s+/g, " ").toUpperCase();

/** Movimento del conto Satispay da o verso un salvadanaio (personale o colletta). */
export function eRisparmioSatispay(m: MovLike): boolean {
  if (m.conto !== "Satispay") return false;
  return nomeSalvadanaio(m.descrizione) === "SALVADANAIO" || String(m.tipo ?? "").toUpperCase().includes("RISPARMI");
}

/** Satispay chiama il salvadanaio personale «Salvadanaio» o «Salvadanaio di Nome»; le collette hanno il loro nome. */
export const pareSalvadanaioPersonale = (nome: string) => /^SALVADANAIO( DI \S+)?$/.test(nome);

export function tipoSalvadanaio(nome: string, cfg?: Partial<Config> | null): TipoSalvadanaio {
  const scelto = cfg?.salvadanai_satispay?.[nome];
  if (scelto === "personale" || scelto === "colletta") return scelto;
  return pareSalvadanaioPersonale(nome) ? "personale" : "colletta";
}

export interface GruppoSalvadanaio {
  nome: string; etichetta: string; tipo: TipoSalvadanaio; scelto: boolean;
  n: number; versato: number; prelevato: number; dal: string; al: string;
}

/** I salvadanai che compaiono nei movimenti Satispay, con quanto hai versato e prelevato da ognuno. */
export function gruppiSalvadanaio(mov: Movimento[], cfg?: Partial<Config> | null): GruppoSalvadanaio[] {
  const g = new Map<string, GruppoSalvadanaio>();
  for (const m of mov) {
    if (!eRisparmioSatispay(m)) continue;
    const nome = nomeSalvadanaio(m.descrizione);
    let x = g.get(nome);
    if (!x) g.set(nome, (x = { nome, etichetta: m.descrizione.trim(), tipo: tipoSalvadanaio(nome, cfg),
      scelto: !!cfg?.salvadanai_satispay?.[nome], n: 0, versato: 0, prelevato: 0, dal: m.data, al: m.data }));
    x.n++;
    if (m.importo < 0) x.versato -= m.importo; else x.prelevato += m.importo;
    if (m.data < x.dal) x.dal = m.data;
    if (m.data > x.al) x.al = m.data;
  }
  return [...g.values()].sort((a, b) => (a.tipo === b.tipo ? b.al.localeCompare(a.al) : a.tipo === "personale" ? -1 : 1));
}

const TOLLERANZA = 0.5;

/** Minimo, giorno per giorno, del saldo dei salvadanai indicati (versato meno prelevato). */
function minimoSaldo(mov: Movimento[], nomi: Set<string>): number {
  const perGiorno = new Map<string, number>();
  for (const m of mov) {
    if (!eRisparmioSatispay(m) || !nomi.has(nomeSalvadanaio(m.descrizione))) continue;
    perGiorno.set(m.data, (perGiorno.get(m.data) ?? 0) - m.importo);
  }
  let s = 0, min = 0;
  for (const d of [...perGiorno.keys()].sort()) { s += perGiorno.get(d)!; if (s < min) min = s; }
  return min;
}

/**
 * Collette scambiate per il salvadanaio personale: se il salvadanaio personale andrebbe in rosso (prelevi più
 * di quanto c'è) e togliendo uno dei suoi nomi non ci va più, quel nome è una colletta.
 * Non tocca i nomi scelti a mano né quello che si chiama solo «Salvadanaio».
 */
export function rilevaCollette(mov: Movimento[], cfg?: Partial<Config> | null): string[] {
  const gruppi = gruppiSalvadanaio(mov, cfg).filter((g) => g.tipo === "personale");
  const pers = new Set(gruppi.map((g) => g.nome));
  if (minimoSaldo(mov, pers) >= -TOLLERANZA) return [];
  const trovate: string[] = [];
  const candidati = gruppi.filter((g) => !g.scelto && g.nome !== "SALVADANAIO" && g.prelevato > g.versato)
    .sort((a, b) => (b.prelevato - b.versato) - (a.prelevato - a.versato));
  for (const g of candidati) {
    const senza = new Set(pers); senza.delete(g.nome);
    if (minimoSaldo(mov, senza) > minimoSaldo(mov, pers)) { pers.delete(g.nome); trovate.push(g.nome); }
    if (minimoSaldo(mov, pers) >= -TOLLERANZA) break;
  }
  return minimoSaldo(mov, pers) >= -TOLLERANZA ? trovate : [];
}

/**
 * Per entrate e uscite ogni colletta conta una volta sola, per la differenza tra prelevato e versato, nel giorno
 * dell'ultimo movimento: positiva è un'entrata, negativa una spesa. I movimenti delle altre categorie restano come sono.
 */
export function nettaCollette(mov: Movimento[]): Movimento[] {
  const out: Movimento[] = [];
  const gruppi = new Map<string, Movimento[]>();
  for (const m of mov) {
    if (m.categoria !== CAT_COLLETTE) { out.push(m); continue; }
    const k = m.conto + "|" + nomeSalvadanaio(m.descrizione);
    const g = gruppi.get(k);
    if (g) g.push(m); else gruppi.set(k, [m]);
  }
  for (const g of gruppi.values()) {
    const netto = Math.round(g.reduce((a, m) => a + m.importo, 0) * 100) / 100;
    if (!netto) continue;
    const ultimo = g.reduce((a, m) => (m.data > a.data ? m : a), g[0]);
    out.push({ ...ultimo, importo: netto });
  }
  return out;
}
