/**
 * Stato dell'app: registro dei movimenti, configurazione e prezzi. Ogni modifica viene salvata
 * subito nel telefono/PC (IndexedDB) e, se collegato, su OneDrive.
 * I dati sono tenuti negli stessi file della versione per PC (movimenti.txt, saldi_noti.txt, ...).
 */
import { useSyncExternalStore } from "react";
import * as A from "../core/analisi";
import { normalizza, copia, CONFIG_DEFAULT } from "../core/config";
import { oggi } from "../core/date";
import * as F from "../core/formato";
import { Registro } from "../core/registro";
import type { Config } from "../core/tipi";
import * as archivio from "./archivio";

export const FILE = {
  mov: "movimenti.txt",
  saldi: "saldi_noti.txt",
  imp: "importati.txt",
  cfg: "config.json",
  prezzi: "prezzi_cache.csv",
} as const;
export type Parte = keyof typeof FILE;
export const TUTTE: Parte[] = ["mov", "saldi", "imp", "cfg", "prezzi"];

export interface Stato {
  pronto: boolean;
  reg: Registro;
  cfg: Config;
  prezzi: F.CachePrezzi;
  prezziAggiornati: string | null; // data e ora dell'ultimo aggiornamento
  ticker: Record<string, string>;
  erroriPrezzi: Record<string, string>;
  versione: number;
  note: string[];
}

export const stato: Stato = {
  pronto: false, reg: new Registro(), cfg: copia(CONFIG_DEFAULT), prezzi: {}, prezziAggiornati: null,
  ticker: {}, erroriPrezzi: {}, versione: 0, note: [],
};

// ------------------------------------------------------------------ osservatori
const ascoltatori = new Set<() => void>();
export function iscriviti(f: () => void) { ascoltatori.add(f); return () => ascoltatori.delete(f); }
function notifica() { stato.versione++; for (const f of ascoltatori) f(); }
export function useVersione(): number {
  return useSyncExternalStore(iscriviti, () => stato.versione);
}

type DopoModifica = (parti: Parte[], eliminati: string[]) => void;
const dopoModifica = new Set<DopoModifica>();
export function allaModifica(f: DopoModifica) { dopoModifica.add(f); return () => dopoModifica.delete(f); }

// ------------------------------------------------------------------ conversione da/verso testo
export function testoDi(p: Parte): string {
  switch (p) {
    case "mov": return F.movimentiATesto(stato.reg.mov);
    case "saldi": return F.saldiATesto(stato.reg.saldi);
    case "imp": return F.importatiATesto(stato.reg.importati);
    case "cfg": return JSON.stringify(stato.cfg, null, 2);
    case "prezzi": return F.prezziATesto(stato.prezzi);
  }
}

/** Carica nello stato i file (letti da OneDrive, da un backup o dalla cartella della versione per PC). */
export function applicaTesti(t: Partial<Record<Parte, string>>) {
  const reg = stato.reg;
  if (t.mov !== undefined) reg.mov = F.movimentiDaTesto(t.mov);
  if (t.saldi !== undefined) reg.saldi = F.saldiDaTesto(t.saldi);
  if (t.imp !== undefined) reg.importati = F.importatiDaTesto(t.imp);
  if (t.cfg !== undefined) {
    let letta: any = null;
    try { letta = JSON.parse(t.cfg); } catch { /* file rovinato: si tengono i valori predefiniti */ }
    stato.cfg = normalizza(letta).cfg;
  }
  if (t.prezzi !== undefined) stato.prezzi = F.prezziDaTesto(t.prezzi);
}

// ------------------------------------------------------------------ salvataggio locale
let timer: ReturnType<typeof setTimeout> | null = null;
const daSalvare = new Set<Parte>();
async function salvaOra() {
  timer = null;
  const parti = [...daSalvare];
  daSalvare.clear();
  for (const p of parti) await archivio.scrivi(FILE[p], testoDi(p));
}
export function salvaLocale(parti: Parte[]) {
  parti.forEach((p) => daSalvare.add(p));
  if (timer) clearTimeout(timer);
  timer = setTimeout(salvaOra, 250);
}
export async function salvaSubito() { if (timer) { clearTimeout(timer); await salvaOra(); } }

/** Esegue una modifica, poi salva le parti indicate e avvisa l'interfaccia e la sincronizzazione. */
export function modifica(parti: Parte[], f: () => void) {
  const prima = parti.includes("mov") ? new Set(stato.reg.mov.map((m) => m.id)) : null;
  f();
  let eliminati: string[] = [];
  if (prima) {
    const dopo = new Set(stato.reg.mov.map((m) => m.id));
    eliminati = [...prima].filter((id) => !dopo.has(id));
  }
  calcoli.clear();
  salvaLocale(parti);
  notifica();
  for (const g of dopoModifica) g(parti, eliminati);
}

/** Sostituisce tutto lo stato con dati arrivati da fuori (senza rimandarli indietro alla sincronizzazione). */
export function sostituisci(t: Partial<Record<Parte, string>>) {
  applicaTesti(t);
  calcoli.clear();
  salvaLocale(Object.keys(t) as Parte[]);
  notifica();
}

export async function carica() {
  await archivio.persistente();
  const t: Partial<Record<Parte, string>> = {};
  for (const p of TUTTE) {
    const v = await archivio.leggi(FILE[p]);
    if (typeof v === "string") t[p] = v;
  }
  applicaTesti(t);
  if (t.cfg === undefined) await archivio.scrivi(FILE.cfg, testoDi("cfg"));
  stato.prezziAggiornati = (await archivio.leggi<string>("meta:prezzi_aggiornati")) ?? null;
  stato.ticker = (await archivio.leggi<Record<string, string>>("meta:ticker")) ?? {};
  // correzioni per dati creati con versioni precedenti (anche quelle per PC)
  const note = stato.reg.ripara(stato.cfg);
  if (note.length) {
    stato.note = note;
    salvaLocale(TUTTE);
  }
  stato.pronto = true;
  notifica();
}

export async function salvaMetaPrezzi() {
  await archivio.scrivi("meta:prezzi_aggiornati", stato.prezziAggiornati);
  await archivio.scrivi("meta:ticker", stato.ticker);
}

// ------------------------------------------------------------------ calcoli (in cache fino alla prossima modifica)
const calcoli = new Map<string, unknown>();
function memo<T>(k: string, f: () => T): T {
  if (!calcoli.has(k)) calcoli.set(k, f());
  return calcoli.get(k) as T;
}

export const calcolaSaldi = () => memo("saldi", () => A.saldi(stato.reg.mov, stato.reg.saldi, oggi()));
export const calcolaInvestimenti = () => memo("inv", () => A.investimenti(stato.reg.mov, stato.cfg.strumenti,
  (isin, giorni, impl, man) => A.serieDaPrezzi(stato.prezzi[isin], giorni, impl, man,
    stato.ticker[isin] ? (stato.ticker[isin] === "justETF" ? "justETF" : `Yahoo (${stato.ticker[isin]})`) : "prezzi salvati (Yahoo/justETF)"),
  oggi()));
export const calcolaBuchi = () => memo("buchi", () => A.buchi(stato.reg.mov));
export function invalidaCalcoli() { calcoli.clear(); notifica(); }

/** Tutte le categorie in uso o previste dalle regole. */
export function opzioniCategorie(): string[] {
  const s = new Set<string>(stato.cfg.regole_categorie.map((r) => r[0]));
  for (const m of stato.reg.mov) s.add(m.categoria);
  s.add(stato.cfg.categoria_default_uscite);
  s.add(stato.cfg.categoria_default_entrate);
  s.delete("");
  return [...s].sort((a, b) => a.localeCompare(b, "it"));
}

export const contiNoti = () => [...new Set(stato.reg.mov.map((m) => m.conto))].sort();
